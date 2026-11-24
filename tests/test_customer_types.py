"""Customer classification, validation and compatibility against the real server."""
import base64
import subprocess
from test_system import ApiTestCase, ROOT


class CustomerTypeTest(ApiTestCase):
    def test_customer_types_roundtrip_updates_and_validation(self):
        self.setup_account()
        for customer_type in ('同行', '终端客户（自主开发）', '他人介绍'):
            customer = self.call('POST', '/api/customers', {
                'name': customer_type + '客户', 'customerType': customer_type,
                'referrer': '  介绍人甲  ' if customer_type == '他人介绍' else ''}, expected=201)
            path = '/api/customers/' + customer['id']
            self.assertEqual(customer_type, customer['customerType'])
            self.assertEqual('介绍人甲' if customer_type == '他人介绍' else '', customer['referrer'])
            customer = self.call('PUT', path, {'version': customer['version'], 'organization': '研究所'})
            self.assertEqual(customer_type, customer['customerType'])
            self.assertEqual(customer_type, self.call('GET', path)['customerType'])
            for invalid in ({'customerType': '其他'}, {'customerType': 123},
                            {'customerType': '长' * 21}, {'referrer': 123}, {'referrer': '长' * 201}):
                self.call('PUT', path, {'version': customer['version'], **invalid}, expected=400)
                self.assertEqual(customer['version'], self.call('GET', path)['version'])
        self.assertEqual(3, len(self.call('GET', '/api/customers')))
        paper = self.call('POST', '/api/papers', {
            'title': '分类变更保留关联', 'serviceType': 'half', 'customerId': customer['id'],
            'contractAmount': '500'}, expected=201)
        customer = self.call('PUT', path, {'version': customer['version'], 'customerType': '终端客户（自主开发）'})
        self.assertEqual(1, customer['paperCount'])
        self.assertEqual(50000, customer['contractCents'])
        self.assertEqual(paper['id'], customer['papers'][0]['id'])
        self.assertEqual(customer['id'], self.call('GET', '/api/papers/' + paper['id'])['customerId'])
        self.call('PUT', path, {'version': customer['version'] - 1, 'customerType': '同行'}, expected=409)

    def test_customer_types_backup_restore_and_restart(self):
        self.setup_account()
        expected = {}
        for customer_type in ('同行', '终端客户（自主开发）', '他人介绍'):
            customer = self.call('POST', '/api/customers', {
                'name': customer_type + '备份', 'customerType': customer_type,
                'referrer': '介绍人乙' if customer_type == '他人介绍' else ''}, expected=201)
            expected[customer['id']] = (customer_type, customer['referrer'])
        backup = self.call('GET', '/api/backup', raw=True)
        for customer in self.call('GET', '/api/customers'):
            self.call('PUT', '/api/customers/' + customer['id'], {
                'version': customer['version'], 'customerType': '', 'referrer': ''})
        self.call('POST', '/api/restore', {
            'backup': base64.b64encode(backup).decode(), 'password': 'Test-password-2026'})
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        restored = self.call('GET', '/api/customers')
        self.assertEqual(expected, {c['id']: (c['customerType'], c['referrer']) for c in restored})

    def test_customer_types_legacy_backup_remains_unclassified(self):
        self.setup_account()
        customer = self.call('POST', '/api/customers', {
            'name': '旧客户', 'phone': '13800000000', 'customerType': '同行'}, expected=201)
        paper = self.call('POST', '/api/papers', {
            'title': '旧客户关联论文', 'serviceType': 'half', 'customerId': customer['id']}, expected=201)
        archive = self.data / 'legacy-customer-types.vault'
        archive.write_bytes(self.call('GET', '/api/backup', raw=True))
        helper = self.data / 'customer-type-fixture'
        helper.mkdir()
        subprocess.run(['javac', '-encoding', 'UTF-8', '--release', '17', '-d', str(helper),
                        *[str(p) for p in (ROOT / 'src').glob('*.java')],
                        str(ROOT / 'tests/CustomerTypeFixture.java')], cwd=ROOT, check=True, capture_output=True)
        subprocess.run(['java', '-cp', str(helper), 'CustomerTypeFixture',
                        str(archive), 'Test-password-2026'], cwd=ROOT, check=True, capture_output=True)
        self.call('POST', '/api/restore', {
            'backup': base64.b64encode(archive.read_bytes()).decode(), 'password': 'Test-password-2026'})
        path = '/api/customers/' + customer['id']
        restored = self.call('GET', path)
        self.assertEqual('', restored['customerType'])
        self.assertEqual('', restored['referrer'])
        self.assertEqual(customer['phone'], restored['phone'])
        self.assertEqual(paper['id'], restored['papers'][0]['id'])
        restored = self.call('PUT', path, {'version': restored['version'], 'notes': '保留旧客户'})
        self.assertEqual('', restored['customerType'])
        restored = self.call('PUT', path, {
            'version': restored['version'], 'customerType': '他人介绍', 'referrer': '介绍人丙'})
        self.assertEqual('他人介绍', restored['customerType'])
        self.assertEqual('介绍人丙', restored['referrer'])

