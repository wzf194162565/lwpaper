"""Backup publication, failure handling and integrity checks, without touching installed databases."""
import io
import json
import pathlib
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from scripts.backup_mysql import backup, verify_backup

ROOT = pathlib.Path(__file__).resolve().parents[1]


class BackupTest(unittest.TestCase):
    def setUp(self):
        (ROOT / '.test-data').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.test-data')
        self.addCleanup(self.temp.cleanup)
        self.folder = pathlib.Path(self.temp.name)
        self.options = self.folder / 'mysql.cnf'
        self.options.write_text('[client]\npassword=private-database-password\n', encoding='utf-8')
        self.options.chmod(0o600)
        self.key = self.folder / 'database.key'
        self.key.write_bytes(b'private-matching-key')
        self.output = self.folder / 'backups'

    def test_successful_backup_includes_only_database_key_and_manifest(self):
        def dump(command, stdout, stderr):
            self.assertTrue(command[1].startswith('--defaults-file='))
            self.assertIn('--single-transaction', command)
            self.assertNotIn('private-database-password', ' '.join(command))
            stdout.write('CREATE DATABASE lunwen; -- 中文业务数据\n'.encode())
            return type('Result', (), {'returncode': 0})()

        with patch('scripts.backup_mysql.subprocess.run', side_effect=dump):
            archive = backup('lunwen', self.options, self.key, self.output)
        metadata = verify_backup(archive)
        self.assertEqual('all-accounts-and-workspaces', metadata['scope'])
        self.assertEqual('lunwen', metadata['database'])
        with tarfile.open(archive, 'r:gz') as stream:
            self.assertEqual(self.key.read_bytes(), stream.extractfile('database.key').read())
            self.assertEqual({'database.sql', 'database.key', 'MANIFEST.json'}, set(stream.getnames()))
            self.assertNotIn('private-database-password', stream.extractfile('MANIFEST.json').read().decode())
        self.assertEqual([archive], list(self.output.iterdir()))

    def test_failed_export_never_publishes_partial_backup_or_reveals_credentials(self):
        result = type('Result', (), {'returncode': 2, 'stderr': b'password=private-database-password'})()
        with patch('scripts.backup_mysql.subprocess.run', return_value=result):
            with self.assertRaises(RuntimeError) as raised:
                backup('lunwen', self.options, self.key, self.output)
        self.assertNotIn('private-database-password', str(raised.exception))
        self.assertEqual([], list(self.output.iterdir()))

    def test_verification_rejects_modified_contents_and_unsafe_entries(self):
        for name in ('database.sql', '../database.sql'):
            archive = self.folder / ('unsafe-' + str(len(name)) + '.tar.gz')
            with tarfile.open(archive, 'w:gz') as stream:
                files = {name: b'modified', 'database.key': b'key', 'MANIFEST.json': json.dumps({
                    'format': 'paper-desk-mysql-backup-v1', 'files': {'database.sql': {}, 'database.key': {}}
                }).encode()}
                for filename, data in files.items():
                    item = tarfile.TarInfo(filename)
                    item.size = len(data)
                    stream.addfile(item, io.BytesIO(data))
            with self.assertRaises(ValueError):
                verify_backup(archive)


if __name__ == '__main__':
    unittest.main()
