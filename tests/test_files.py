"""Real HTTP manuscript lifecycle, isolation, authenticated backups and failure atomicity."""
import base64
import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

from test_system import ApiTestCase

PDF = b'%PDF-1.7\nprivate-manuscript-content\n%%EOF\n'


class AttachmentTest(ApiTestCase):
    JAVA_OPTIONS = ['-Dapp.fileMaxMb=1']
    def test_backup_and_attachment_download_names_preserve_extensions(self):
        self.setup_account()
        with self.client.open(self.base + '/api/backup') as response:
            self.assertIn('.vault', response.headers['Content-Disposition'])
        paper = self.upload(self.create())
        with self.client.open(self.base + '/api/backup') as response:
            disposition = response.headers['Content-Disposition']
            self.assertIn('filename=paper-desk-download.zip;', disposition)
            self.assertIn("filename*=UTF-8''paper-desk-", disposition)
            self.assertTrue(response.read().startswith(b'PK'))
        with self.client.open(f"{self.base}/api/papers/{paper['id']}/files/{paper['files'][0]['id']}") as response:
            self.assertIn('filename=paper-desk-download.pdf;', response.headers['Content-Disposition'])
            self.assertEqual(PDF, response.read())

    def binary(self, path, content, headers=None, expected=201, raw=False):
        request = urllib.request.Request(self.base + path, data=content, method='POST', headers={
            'Content-Type': 'application/octet-stream', 'X-CSRF-Token': self.csrf, **(headers or {})})
        try:
            response = self.client.open(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read()
        self.assertEqual(expected, response.code, body[:300])
        return body if raw else json.loads(body)

    def upload(self, paper, content=PDF, name='论文初稿.pdf', note='', expected=201, **headers):
        return self.binary(f"/api/papers/{paper['id']}/files", content, {
            'X-Paper-Version': str(paper['version']), 'X-File-Name': urllib.parse.quote(name),
            'X-File-Note': urllib.parse.quote(note), **headers}, expected=expected)

    def restore_archive(self, data, password='Test-password-2026', expected=200):
        return self.binary('/api/restore-archive', data,
                           {'X-Backup-Password': urllib.parse.quote(password)}, expected=expected)

    def download_file(self, paper, index=0, expected=200):
        return self.call('GET', f"/api/papers/{paper['id']}/files/{paper['files'][index]['id']}",
                         raw=True, expected=expected)

    def test_revisions_keep_originals_and_submission_binding_after_restart(self):
        self.setup_account()
        paper = self.upload(self.create(), note='初稿')
        first = paper['files'][0]
        paper = self.call('POST', f"/api/papers/{paper['id']}/submissions", {
            'version': paper['version'], 'journal': '测试期刊', 'manuscriptId': first['id']}, expected=201)
        submitted = paper['submissions'][-1]
        paper = self.upload(paper, content=PDF + b'revised', note='审稿修改版')
        self.assertEqual([1, 2], [f['revision'] for f in paper['files']])
        self.assertEqual(submitted['manuscriptId'], paper['submissions'][-1]['manuscriptId'])
        self.assertEqual(PDF, self.download_file(paper))
        self.assertEqual(PDF + b'revised', self.download_file(paper, 1))
        self.assertEqual('论文初稿.pdf', paper['files'][1]['filename'])
        path = f"/api/papers/{paper['id']}"
        refreshed = self.call('GET', path)
        listed = next(item for item in self.call('GET', '/api/papers') if item['id'] == paper['id'])
        self.assertEqual(refreshed['files'], listed['files'])
        self.assertEqual([first['id'], paper['files'][1]['id']], [file['id'] for file in listed['files']])
        paper = self.call('PUT', path, {'version': refreshed['version'], 'title': '编辑后保留原稿和修改稿'})
        self.assertEqual(refreshed['files'], paper['files'])
        self.assertEqual(PDF + b'revised', self.download_file(paper, 1))
        for blob in self.data.rglob('*.bin'):
            self.assertNotIn(b'private-manuscript-content', blob.read_bytes())
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        restored = self.call('GET', f"/api/papers/{paper['id']}")
        self.assertEqual(paper['files'], restored['files'])
        self.assertEqual(PDF, self.download_file(restored))

    def test_retrying_completed_upload_does_not_duplicate_versions(self):
        self.setup_account()
        paper = self.create()
        token = '22222222-2222-4222-8222-222222222222'
        saved = self.upload(paper, **{'X-Upload-Id': token})
        retried = self.upload(paper, **{'X-Upload-Id': token})
        self.assertEqual(saved['files'], retried['files'])
        self.assertEqual(saved['version'], retried['version'])
        self.assertEqual(PDF, self.download_file(retried))
        self.assertEqual(1, len(list(self.data.rglob('*.bin'))))

    def test_invalid_uploads_and_stale_edits_leave_no_files(self):
        self.setup_account()
        paper = self.create()
        for name, data in [('bad.exe', PDF), ('../bad.pdf', PDF), ('bad.pdf', b'fake'),
                           ('empty.pdf', b''), ('bad.docx', b'PK-fake')]:
            self.upload(paper, name=name, content=data, expected=400)
        self.upload(paper, expected=403, **{'X-CSRF-Token': 'wrong'})
        self.upload(paper, expected=403, **{'Origin': 'https://foreign.example'})
        self.upload(paper, content=PDF + b'x' * (1024 * 1024), expected=413)
        saved = self.upload(paper)
        self.upload(paper, expected=409)
        self.assertEqual(1, len(list(self.data.rglob('*.bin'))))
        self.assertFalse(list(self.data.rglob('*.tmp')))
        fake = '11111111-1111-1111-1111-111111111111'
        self.call('POST', f"/api/papers/{saved['id']}/submissions", {
            'version': saved['version'], 'journal': '期刊', 'manuscriptId': fake}, expected=404)
        docx = io.BytesIO()
        with zipfile.ZipFile(docx, 'w') as archive:
            archive.writestr('[Content_Types].xml', '<Types/>')
            archive.writestr('word/document.xml', '<document/>')
        saved = self.upload(saved, content=docx.getvalue(), name='修改稿.docx')
        self.assertEqual(docx.getvalue(), self.download_file(saved, 1))
        other = self.upload(self.create(title='其他论文'))
        self.call('POST', f"/api/papers/{saved['id']}/submissions", {
            'version': saved['version'], 'journal': '期刊', 'manuscriptId': other['files'][0]['id']}, expected=404)

    def test_account_isolation_and_portable_backup_restores_independent_files(self):
        self.setup_account()
        paper = self.upload(self.create())
        paper = self.call('POST', f"/api/papers/{paper['id']}/submissions", {
            'version': paper['version'], 'journal': '备份期刊', 'manuscriptId': paper['files'][0]['id']}, expected=201)
        backup = self.call('GET', '/api/backup', raw=True)
        self.assertTrue(backup.startswith(b'PK'))
        self.assertNotIn(b'private-manuscript-content', backup)
        self.assertNotIn('论文初稿'.encode(), backup)
        self.restore_archive(backup, password='wrong-password', expected=400)
        self.assertEqual(PDF, self.download_file(paper))
        old_client, old_csrf = self.client, self.csrf
        self.reset_client()
        self.csrf = ''
        self.download_file(paper, expected=401)
        self.csrf = self.register_account({'username': 'second-user', 'password': 'Other-password-2026'})['csrf']
        self.download_file(paper, expected=404)
        self.upload(paper, expected=404)
        self.restore_archive(backup)
        restored = self.call('GET', '/api/papers')[0]
        self.assertNotEqual(paper['files'][0]['id'], restored['files'][0]['id'])
        self.assertEqual(restored['files'][0]['id'], restored['submissions'][-1]['manuscriptId'])
        self.assertEqual(PDF, self.download_file(restored))
        self.call('DELETE', f"/api/papers/{restored['id']}", {'version': restored['version']})
        self.client, self.csrf = old_client, old_csrf
        self.assertEqual(PDF, self.download_file(paper))

    def test_restore_is_atomic_for_damaged_missing_extra_and_duplicate_entries(self):
        self.setup_account()
        paper = self.upload(self.create())
        backup = self.call('GET', '/api/backup', raw=True)
        with zipfile.ZipFile(io.BytesIO(backup)) as archive:
            entries = {name: archive.read(name) for name in archive.namelist()}
        file_entry = next(name for name in entries if name.startswith('files/'))
        for mode in ('missing', 'damaged', 'extra'):
            changed = dict(entries)
            if mode == 'missing':
                del changed[file_entry]
            elif mode == 'damaged':
                content = bytearray(changed[file_entry]); content[-1] ^= 1
                changed[file_entry] = bytes(content)
            else:
                changed['../escape'] = b'unsafe'
            data = io.BytesIO()
            with zipfile.ZipFile(data, 'w') as archive:
                for name, content in changed.items():
                    archive.writestr(name, content)
            self.restore_archive(data.getvalue(), expected=400)
            self.assertEqual(paper['files'], self.call('GET', f"/api/papers/{paper['id']}")['files'])
            self.assertEqual(PDF, self.download_file(paper))
            # The client can receive the last byte before the handler's finally block runs.
            deadline = time.monotonic() + 1
            while list(self.data.rglob('*.tmp')) and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertFalse(list(self.data.rglob('*.tmp')))
        self.restore_archive(backup)
        restored = self.call('GET', '/api/papers')[0]
        self.assertEqual(PDF, self.download_file(restored))
        self.assertEqual(1, len(list(self.data.rglob('*.bin'))))
        self.call('DELETE', f"/api/papers/{restored['id']}", {'version': restored['version']})
        self.assertEqual([], list(self.data.rglob('*.bin')))

    def test_password_change_and_legacy_restore_preserve_expected_files(self):
        self.setup_account()
        paper = self.create()
        legacy = self.call('GET', '/api/backup', raw=True)
        paper = self.upload(paper)
        backup = self.call('GET', '/api/backup', raw=True)
        result = self.call('POST', '/api/password', {'currentPassword': 'Test-password-2026', 'newPassword': 'Changed-password-2026'})
        self.csrf = result['csrf']
        self.assertEqual(PDF, self.download_file(paper))
        self.restore_archive(backup)
        restored = self.call('GET', '/api/papers')[0]
        self.assertEqual(PDF, self.download_file(restored))
        self.call('POST', '/api/restore', {'backup': base64.b64encode(legacy).decode(), 'password': 'Test-password-2026'})
        self.assertEqual([], self.call('GET', '/api/papers')[0]['files'])
        self.assertEqual([], list(self.data.rglob('*.bin')))


    def test_delete_paper_removes_manuscripts_receipts_and_ledger_but_keeps_other_files(self):
        self.setup_account()
        paper=self.upload(self.create())
        path=f"/api/papers/{paper['id']}"
        paper=self.call('POST',path+'/transactions',{'version':paper['version'],'type':'incoming_deposit','amount':'100','date':'2026-01-01'},expected=201)
        transaction=paper['transactions'][0]
        paper=self.upload(paper,name='receipt.pdf',**{'X-Transaction-Id':transaction['id']})
        paper=self.call('POST',path+'/submissions',{'version':paper['version'],'journal':'待删除期刊','submissionPassword':'disposable'},expected=201)
        other=self.upload(self.create(title='保留论文'),content=PDF+b'keep')
        deleted_files=[file['id'] for file in paper['files']]
        before={blob.stem for blob in self.data.rglob('*.bin')}
        self.assertTrue(set(deleted_files)<=before)
        self.call('DELETE',path,{'version':paper['version']})
        self.call('GET',path,expected=404)
        for file_id in deleted_files:
            self.call('GET',path+'/files/'+file_id,expected=404)
        self.assertFalse(set(deleted_files)&{blob.stem for blob in self.data.rglob('*.bin')})
        self.assertEqual(PDF+b'keep',self.download_file(other))
        self.assertEqual({other['id']},{p['id'] for p in self.call('GET','/api/papers')})
        self.process.terminate();self.process.wait(timeout=10);self.reset_client();self.start_server()
        self.csrf=self.call('POST','/api/login',{'username':'test-user','password':'Test-password-2026'})['csrf']
        self.call('GET',path,expected=404)
        self.assertEqual(PDF+b'keep',self.download_file(other))
