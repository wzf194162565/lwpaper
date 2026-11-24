"""Cross-module invariants that must hold through every editing entry point."""
import datetime

from test_system import ApiTestCase


class LogicAuditTest(ApiTestCase):
    def test_paper_editor_cannot_bypass_duplicate_journal_validation(self):
        self.setup_account()
        paper = self.call('POST', '/api/papers', {
            'title': '跨入口期刊校验', 'serviceType': 'half', 'journal': 'Journal A'}, expected=201)
        path = '/api/papers/' + paper['id']
        paper = self.call('POST', path + '/submissions', {
            'version': paper['version'], 'journal': 'Journal B',
            'status': '审稿中', 'submittedAt': datetime.date.today().isoformat()}, expected=201)
        paper = self.call('GET', path)
        for journal in ['Journal A', ' journal a ', 'Ｊｏｕｒｎａｌ　Ａ']:
            self.call('PUT', path, {'version': paper['version'], 'journal': journal}, expected=409)
            self.assertEqual(paper, self.call('GET', path))
        original = paper['submissions'][0]
        paper = self.call('PUT', path + '/submissions/' + original['id'], {
            'version': original['version'], 'status': '已拒稿',
            'submittedAt': datetime.date.today().isoformat()})
        active = paper['activeSubmissionId']
        paper = self.call('PUT', path, {'version': paper['version'], 'journal': 'Journal A'})
        self.assertEqual(active, paper['activeSubmissionId'])
        self.assertEqual(2, len(paper['submissions']))

    def test_paper_progress_changes_require_actual_submission_dates_atomically(self):
        self.setup_account()
        for status in ['已投稿', '审稿中', '已录用', '已发表']:
            self.call('POST', '/api/papers', {
                'title': '缺少投稿日期', 'journal': '日期期刊', 'status': status}, expected=400)
        self.assertEqual([], self.call('GET', '/api/papers'))
        paper = self.call('POST', '/api/papers', {
            'title': '日期联动校验', 'journal': '日期期刊'}, expected=201)
        path = '/api/papers/' + paper['id']
        paper = self.call('GET', path)
        self.call('PUT', path, {'version': paper['version'], 'status': '审稿中'}, expected=400)
        self.assertEqual(paper, self.call('GET', path))
        paper = self.call('PUT', path, {'version': paper['version'], 'status': '审稿中',
                                     'submittedAt': datetime.date.today().isoformat()})
        paper = self.call('GET', path)
        self.call('PUT', path, {'version': paper['version'], 'submittedAt': ''}, expected=400)
        self.assertEqual(paper, self.call('GET', path))

    def test_new_published_papers_initialize_publication_dates_and_duration(self):
        self.setup_account()
        today = datetime.date.today()
        paper = self.call('POST', '/api/papers', {
            'title': '发表日期联动', 'journal': '发表期刊', 'status': '已发表',
            'submittedAt': (today - datetime.timedelta(days=7)).isoformat()}, expected=201)
        submission = paper['submissions'][0]
        self.assertEqual(today.isoformat(), submission['endedAt'])
        self.assertEqual(today.isoformat(), submission['publishedAt'])
        self.assertEqual(7, submission['durationDays'])
