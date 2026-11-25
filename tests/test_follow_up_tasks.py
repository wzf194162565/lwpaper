"""Independent follow-up lifecycle, concurrency, history and persistence."""
import base64
from datetime import date
from test_system import ApiTestCase


class FollowUpTasksTest(ApiTestCase):
    def save_task(self, paper, task=None, expected=200, **changes):
        path = '/api/papers/' + paper['id'] + '/followups'
        if task:
            path += '/' + task['id']
        return self.call('PUT' if task else 'POST', path,
                         {'version': paper['version'], **changes}, expected=expected)

    def test_complete_new_request_and_reopen_preserve_history_backup_and_restart(self):
        self.setup_account()
        for service in ('full', 'half'):
            paper = self.call('POST', '/api/papers', {
                'title': service + '跟进事项', 'serviceType': service,
                'followUpAt': '2030-01-12', 'followUpReason': '联系客户确认修改意见'}, expected=201)
            task = paper['followUps'][0]
            paper = self.save_task(paper, task, status='in_progress', note='已联系，等待回复')
            self.assertEqual('in_progress', paper['followUps'][0]['status'])
            paper = self.save_task(paper, task, status='completed', note='客户已确认，周五交稿')
            completed = paper['followUps'][0]
            self.assertTrue(completed['closedAt'])
            self.assertEqual('', paper['followUpAt'])
            self.assertEqual('待投稿', paper['status'])
            paper = self.save_task(paper, expected=201, content='作者新增图表修改要求',
                                   date='2030-01-15', note='新增两张图')
            self.assertEqual(2, len(paper['followUps']))
            self.assertEqual(completed, paper['followUps'][0])
            new_task = paper['followUps'][1]
            paper = self.save_task(paper, task, status='pending', note='客户补充说明，原事项需再确认')
            reopened = paper['followUps'][0]
            self.assertEqual('', reopened['closedAt'])
            self.assertEqual('2030-01-12', paper['followUpAt'])
            self.assertEqual(new_task, paper['followUps'][1])
            snapshots = [e for e in paper['followUpHistory'] if e['taskId'] == task['id']]
            self.assertEqual(['pending', 'in_progress', 'completed', 'pending'],
                             [e['status'] for e in snapshots])
            self.assertEqual('客户已确认，周五交稿', snapshots[2]['note'])
            self.assertEqual(completed['closedAt'], snapshots[2]['closedAt'])
        backup = self.call('GET', '/api/backup', raw=True)
        before = self.call('GET', '/api/papers/' + paper['id'])
        self.save_task(paper, task, status='cancelled', note='临时取消')
        self.call('POST', '/api/restore', {'backup': base64.b64encode(backup).decode(),
                                         'password': 'Test-password-2026'})
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user',
                                                    'password': 'Test-password-2026'})['csrf']
        after = self.call('GET', '/api/papers/' + paper['id'])
        self.assertEqual(before['followUps'], after['followUps'])
        self.assertEqual(before['followUpHistory'], after['followUpHistory'])
        self.assertEqual(200, self.client.open(self.base + '/followups.js').code)

    def test_atomic_validation_concurrent_edits_and_task_ownership(self):
        self.setup_account()
        paper = self.create()
        original = paper
        for changes in ({'content': '', 'date': '2030-01-12'},
                        {'content': '新要求', 'date': ''},
                        {'content': '新要求', 'date': '2030-02-30'},
                        {'content': '新要求', 'date': '2030-01-12', 'status': '已发表'},
                        {'content': '新要求', 'date': '2030-01-12', 'note': 12},
                        {'content': '长' * 1001, 'date': '2030-01-12'}):
            self.save_task(paper, expected=400, **changes)
            self.assertEqual(original, self.call('GET', '/api/papers/' + paper['id']))
        paper = self.save_task(paper, expected=201, content='新要求', date='2030-01-12')
        task = paper['followUps'][0]
        self.save_task(original, task, expected=409, status='completed')
        other = self.create(title='另一篇论文')
        self.save_task(other, task, expected=404, status='completed')
        paper = self.save_task(paper, task, status='completed', note='已处理')
        closed_at = paper['followUps'][0]['closedAt']
        paper = self.save_task(paper, task, note='补充处理说明')
        self.assertEqual(closed_at, paper['followUps'][0]['closedAt'])
        self.assertEqual('completed', paper['followUps'][0]['status'])

    def test_old_editor_edits_next_task_without_losing_completed_tasks(self):
        self.setup_account()
        paper = self.create(followUpAt='2030-01-12', followUpReason='旧计划')
        task = paper['followUps'][0]
        paper = self.save_task(paper, task, status='completed', note='已处理')
        paper = self.save_task(paper, expected=201, content='后续计划', date='2030-01-15')
        completed = paper['followUps'][0]
        path = '/api/papers/' + paper['id']
        paper = self.call('PUT', path, {'version': paper['version'], 'followUpAt': '2030-01-16',
                                       'followUpReason': '后续沟通'})
        self.assertEqual(completed, paper['followUps'][0])
        self.assertEqual('后续沟通', paper['followUps'][1]['content'])
        paper = self.call('PUT', path, {'version': paper['version'], 'followUpAt': '', 'followUpReason': ''})
        self.assertEqual('cancelled', paper['followUps'][1]['status'])
        self.assertEqual(completed, paper['followUps'][0])

    def test_new_requests_can_be_followed_after_publication_or_service_termination(self):
        self.setup_account()
        for status in ('已发表', '已撤稿'):
            paper = self.create(status=status, submittedAt=date.today().isoformat())
            paper = self.save_task(paper, expected=201, content='发表后作者提出新要求', date='2030-01-12')
            self.assertEqual(status, paper['status'])
            self.assertEqual('pending', paper['followUps'][0]['status'])
        paper = self.create()
        paper = self.call('POST', '/api/papers/' + paper['id'] + '/termination', {
            'version': paper['version'], 'terminatedAt': date.today().isoformat(),
            'terminationReason': '客户终止', 'customerSettlement': '0', 'writerSettlement': '0', 'confirmTermination': True})
        paper = self.save_task(paper, expected=201, content='终止后补充沟通', date='2030-01-12')
        self.assertEqual('pending', paper['followUps'][0]['status'])
