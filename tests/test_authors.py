"""Customer/author associations are derived from paper names, scoped to the account."""
import base64
from test_system import ApiTestCase


class AuthorRelationsTest(ApiTestCase):
    def test_coauthors_do_not_multiply_paper_publication_or_customer_fees(self):
        self.setup_account()
        customer = self.call('POST', '/api/customers', {'name': '合著论文客户'}, expected=201)
        paper = self.call('POST', '/api/papers', {'title': '两位作者共同署名', 'customerId': customer['id'],
                          'authors': '丁妹、丁懿', 'contractAmount': '3000'}, expected=201)
        self.call('POST', '/api/papers/' + paper['id'] + '/submissions', {
            'version': paper['version'], 'journal': '合著期刊', 'status': '已发表',
            'submittedAt': '2026-01-03', 'endedAt': '2026-02-03', 'publishedAt': '2026-03-03'}, expected=201)
        summary = self.call('GET', '/api/customers/' + customer['id'])
        self.assertEqual((2, 1, 1, 300000), (summary['authorCount'], summary['paperCount'],
                         summary['publishedPaperCount'], summary['contractCents']))
        self.assertEqual(1, len(summary['papers']))
        self.assertEqual(1, self.call('GET', '/api/account/authors')['paperCount'])
        self.call('POST', '/api/papers', {'title': '另一篇合著论文', 'customerId': customer['id'],
                  'authors': '丁懿、王五', 'contractAmount': '1000'}, expected=201)
        summary = self.call('GET', '/api/customers/' + customer['id'])
        self.assertEqual((3, 2, 1, 400000), (summary['authorCount'], summary['paperCount'],
                         summary['publishedPaperCount'], summary['contractCents']))

    def test_account_and_customer_author_counts_deduplicate_by_name(self):
        self.call('GET', '/api/account/authors', expected=401)
        self.setup_account()
        self.assertEqual(0, self.call('GET', '/api/account/authors')['authorCount'])
        first = self.call('POST', '/api/customers', {'name': 'A客户'}, expected=201)
        second = self.call('POST', '/api/customers', {'name': 'A客户'}, expected=201)
        self.call('POST', '/api/papers', {'title': '合作作者论文', 'customerId': first['id'],
                  'authors': '张三、 李四,张三；王五\r\nＡｌｉｃｅ　Ｓｍｉｔｈ;alice smith'}, expected=201)
        self.call('POST', '/api/papers', {'title': '同一作者的另一篇论文', 'customerId': first['id'],
                  'authors': ' 张三 '}, expected=201)
        self.call('POST', '/api/papers', {'title': '另一个客户的论文', 'customerId': second['id'],
                  'authors': '张三'}, expected=201)
        self.call('POST', '/api/papers', {'title': '未填写作者的论文'}, expected=201)
        own = self.call('GET', '/api/account/authors')
        self.assertEqual('test-user', own['username'])
        self.assertEqual((4, 4, 1), (own['paperCount'], own['authorCount'], own['unassignedAuthorPaperCount']))
        self.assertEqual({'张三': 3, '李四': 1, '王五': 1, 'Alice Smith': 1},
                         {a['name']: a['paperCount'] for a in own['linkedAuthors']})
        customer = self.call('GET', '/api/customers/' + first['id'])
        self.assertEqual(4, customer['authorCount'])
        self.assertEqual(2, next(a for a in customer['linkedAuthors'] if a['name'] == '张三')['paperCount'])
        summaries = {c['id']: c for c in self.call('GET', '/api/customers')}
        self.assertEqual(4, summaries[first['id']]['authorCount'])
        self.assertEqual([{'name': '张三', 'paperCount': 1}], summaries[second['id']]['linkedAuthors'])

    def test_author_updates_deletes_and_customer_moves_recompute_associations(self):
        self.setup_account()
        first = self.call('POST', '/api/customers', {'name': '客户甲'}, expected=201)
        second = self.call('POST', '/api/customers', {'name': '客户乙'}, expected=201)
        paper = self.call('POST', '/api/papers', {'title': '原论文', 'customerId': first['id'], 'authors': '张三、李四'}, expected=201)
        path = '/api/papers/' + paper['id']
        paper = self.call('PUT', path, {'version': paper['version'], 'authors': '李四、王五', 'customerId': second['id']})
        self.assertEqual(0, self.call('GET', '/api/customers/' + first['id'])['authorCount'])
        self.assertEqual(2, self.call('GET', '/api/customers/' + second['id'])['authorCount'])
        self.assertEqual({'李四', '王五'}, {a['name'] for a in self.call('GET', '/api/account/authors')['linkedAuthors']})
        self.call('DELETE', path, {'version': paper['version']})
        self.assertEqual([], self.call('GET', '/api/account/authors')['linkedAuthors'])
        self.assertEqual(0, self.call('GET', '/api/customers/' + second['id'])['authorCount'])

    def test_authors_remain_isolated_between_login_accounts(self):
        self.setup_account()
        self.call('POST', '/api/papers', {'title': 'A客户论文', 'authors': '张三、李四'}, expected=201)
        first_client, first_csrf = self.client, self.csrf
        self.reset_client()
        self.csrf = self.register_account({'username': 'customer-b', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual([], self.call('GET', '/api/account/authors')['linkedAuthors'])
        self.call('POST', '/api/papers', {'title': 'B客户论文', 'authors': '张三、王五'}, expected=201)
        self.assertEqual({'张三', '王五'}, {a['name'] for a in self.call('GET', '/api/account/authors')['linkedAuthors']})
        self.client, self.csrf = first_client, first_csrf
        self.assertEqual({'张三', '李四'}, {a['name'] for a in self.call('GET', '/api/account/authors')['linkedAuthors']})

    def test_author_associations_survive_old_backups_and_restart_without_new_records(self):
        self.setup_account()
        paper = self.call('POST', '/api/papers', {'title': '原有论文', 'authors': '张三、李四'}, expected=201)
        expected = self.call('GET', '/api/account/authors')
        backup = self.call('GET', '/api/backup', raw=True)
        self.call('PUT', '/api/papers/' + paper['id'], {'version': paper['version'], 'authors': ''})
        self.assertEqual(0, self.call('GET', '/api/account/authors')['authorCount'])
        self.call('POST', '/api/restore', {'backup': base64.b64encode(backup).decode(), 'password': 'Test-password-2026'})
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual(expected, self.call('GET', '/api/account/authors'))
        self.assertEqual([], self.call('GET', '/api/customers'))
