import datetime
from test_system import ApiTestCase

class PaperCodesTest(ApiTestCase):
    def test_daily_numbers_service_types_and_unchanged_relationship_keys(self):
        self.setup_account();year=datetime.date.today().year
        def create(service,date):
            return self.call('POST','/api/papers',{'title':'编号测试','serviceType':service,'submittedAt':date},expected=201)
        first=create('full','2026-01-01');second=create('full','2026-01-01');half=create('half','2026-01-01');other=create('full','2026-01-02')
        self.assertEqual(f'LW-{year}-QB2026010101',first['code'])
        self.assertEqual(f'LW-{year}-QB2026010102',second['code'])
        self.assertEqual(f'LW-{year}-DF2026010101',half['code'])
        self.assertEqual(f'LW-{year}-QB2026010201',other['code'])
        changed=self.call('PUT','/api/papers/'+first['id'],{'version':first['version'],'title':'改题目'})
        self.assertEqual(first['id'],changed['id']);self.assertEqual(first['code'],changed['code'])
        self.process.terminate();self.process.wait(timeout=10);self.reset_client();self.start_server()
        self.csrf=self.call('POST','/api/login',{'username':'test-user','password':'Test-password-2026'})['csrf']
        self.assertEqual(first['code'],self.call('GET','/api/papers/'+first['id'])['code'])

    def test_no_submission_date_uses_creation_date(self):
        self.setup_account();today=datetime.date.today()
        p=self.call('POST','/api/papers',{'title':'未投稿','serviceType':'half'},expected=201)
        self.assertEqual(f'LW-{today.year}-DF{today:%Y%m%d}01',p['code'])
