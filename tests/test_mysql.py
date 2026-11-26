"""Opt-in integration tests using a disposable MySQL server, never the installed service.

PowerShell: $env:RUN_MYSQL_TESTS='1'; python -m unittest discover -s tests -p test_mysql.py -v
Set MYSQL_TEST_BIN to the directory containing mysqld, mysql and mysqladmin if needed.
"""
import base64
import os
import pathlib
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import urllib.error
import uuid

from test_system import ApiTestCase, ROOT
import test_system
import test_business
import test_files
import test_follow_up
import test_follow_up_tasks
import test_authors
import test_writer_payments
import test_customer_types
import test_termination
import test_financial_rules
import test_publication_fees
import test_logic_audit
import test_cost_ledger


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


@unittest.skipUnless(os.environ.get('RUN_MYSQL_TESTS') == '1', 'Set RUN_MYSQL_TESTS=1 for isolated MySQL tests')
class MysqlTest(ApiTestCase):
    today = test_cost_ledger.CostLedgerTest.today
    cost_paper = test_cost_ledger.CostLedgerTest.cost_paper
    cost_transaction = test_cost_ledger.CostLedgerTest.cost_transaction
    test_cost_resubmission = test_cost_ledger.CostLedgerTest.test_resubmission_never_reuses_old_payment_and_final_loss_counts_in_profit
    test_cost_refund = test_cost_ledger.CostLedgerTest.test_refunds_and_reversal_limits_stay_inside_their_own_journal
    test_cost_reversal = test_cost_ledger.CostLedgerTest.test_reversal_is_immutable_audited_and_reentry_is_linked
    test_cost_receipt = test_cost_ledger.CostLedgerTest.test_receipts_are_separate_encrypted_and_survive_backup_and_restart
    test_audit_duplicate_journal_entry_points = test_logic_audit.LogicAuditTest.test_paper_editor_cannot_bypass_duplicate_journal_validation
    test_audit_submission_date_entry_points = test_logic_audit.LogicAuditTest.test_paper_progress_changes_require_actual_submission_dates_atomically
    test_audit_initial_publication_dates = test_logic_audit.LogicAuditTest.test_new_published_papers_initialize_publication_dates_and_duration
    test_publication_resubmission = test_publication_fees.PublicationFeesTest.test_resubmission_reconfirms_fees_preserves_payments_and_updates_profit
    publication_paper = test_publication_fees.PublicationFeesTest.publication_paper
    publication_tx = test_publication_fees.PublicationFeesTest.publication_tx
    publication_terms = test_publication_fees.PublicationFeesTest.publication_terms
    test_publication_profit = test_publication_fees.PublicationFeesTest.test_included_fee_is_cost_once_and_cash_is_not_profit_until_settled
    test_publication_author = test_publication_fees.PublicationFeesTest.test_author_free_and_pending_modes_never_create_our_page_fee_expense
    test_publication_validation = test_publication_fees.PublicationFeesTest.test_payment_confirmation_limits_edits_and_stale_versions_are_atomic
    test_publication_termination = test_publication_fees.PublicationFeesTest.test_termination_requires_page_fee_settlement_and_unknown_fee_confirmation
    test_publication_persistence = test_publication_fees.PublicationFeesTest.test_fees_and_ledger_survive_restore_restart_and_are_account_isolated

    def test_publication_upgrade_and_cascade_preserve_existing_records(self):
        self.setup_account();paper=self.create()
        self.process.terminate();self.process.wait(timeout=10)
        self.sql('DROP TABLE lw_paper_publication_fee')
        self.sql('DELETE FROM lw_schema_version WHERE version=9')
        for attempt in range(2):
            self.reset_client();self.start_server()
            self.csrf=self.call('POST','/api/login',{'username':'test-user','password':'Test-password-2026'})['csrf']
            restored=self.call('GET','/api/papers/'+paper['id'])
            self.assertEqual(paper['title'],restored['title'])
            self.assertEqual('pending',restored['publicationFeeMode']);self.assertIsNone(restored['estimatedProfitCents'])
            self.assertEqual('1',self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=9'))
            if attempt==0:
                self.process.terminate();self.process.wait(timeout=10)
                self.sql('DELETE FROM lw_schema_version WHERE version=9')
        restored=self.publication_terms(restored,publicationFeeMode='included',publicationFeeAmount='100')
        self.call('DELETE','/api/papers/'+restored['id'],{'version':restored['version']})
        self.assertEqual('0',self.sql('SELECT COUNT(*) FROM lw_paper_publication_fee'))
        self.assertEqual('0',self.sql('SELECT COUNT(*) FROM lw_financial_transaction'))
        self.assertEqual([],self.call('GET','/api/papers'))

    finance_paper = test_financial_rules.FinancialRulesTest.finance_paper
    finance_tx = test_financial_rules.FinancialRulesTest.finance_tx
    test_financial_amount_limits = test_financial_rules.FinancialRulesTest.test_receipts_and_direct_writer_payments_cannot_exceed_remaining_agreement
    test_financial_cent_limits = test_financial_rules.FinancialRulesTest.test_zero_unspecified_installments_still_cap_totals_and_cents
    test_financial_term_changes = test_financial_rules.FinancialRulesTest.test_contract_changes_cannot_hide_recorded_receipts_and_failed_edits_are_atomic
    test_financial_concurrent_receipts = test_financial_rules.FinancialRulesTest.test_concurrent_or_retried_receipts_record_only_one_payment
    test_financial_legacy_compatibility = test_financial_rules.FinancialRulesTest.test_reversing_receipt_reopens_balance_and_legacy_overpayments_remain_readable
    termination_paper = test_termination.TerminationTest.termination_paper
    termination_tx = test_termination.TerminationTest.termination_tx
    termination_input = test_termination.TerminationTest.termination_input
    test_termination_ledger = test_termination.TerminationTest.test_termination_keeps_editorial_history_and_settles_refund_and_writer_recovery
    test_termination_validation = test_termination.TerminationTest.test_termination_rejects_duplicate_stale_invalid_and_normal_workflow_changes
    test_termination_persistence = test_termination.TerminationTest.test_termination_adjustments_and_cash_validation_backup_restart_isolation
    test_termination_half = test_termination.TerminationTest.test_half_termination_needs_no_writer_and_never_changes_original_contract

    def test_termination_schema_upgrade_and_repeat_start_preserve_existing_papers(self):
        self.setup_account()
        paper = self.create()
        self.process.terminate(); self.process.wait(timeout=10)
        self.sql('DROP TABLE lw_paper_service_termination')
        self.sql('DELETE FROM lw_schema_version WHERE version=8')
        for attempt in range(2):
            self.reset_client(); self.start_server()
            self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
            restored = self.call('GET', '/api/papers/' + paper['id'])
            self.assertEqual(paper['title'], restored['title'])
            self.assertEqual('active', restored['serviceStatus'])
            self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=8'))
            if attempt == 0:
                self.process.terminate(); self.process.wait(timeout=10)
                self.sql('DELETE FROM lw_schema_version WHERE version=8')
    test_customer_types_validation = test_customer_types.CustomerTypeTest.test_customer_types_roundtrip_updates_and_validation
    test_customer_types_backup = test_customer_types.CustomerTypeTest.test_customer_types_backup_restore_and_restart
    test_customer_types_legacy = test_customer_types.CustomerTypeTest.test_customer_types_legacy_backup_remains_unclassified

    def test_customer_types_schema_upgrade_preserves_customers_and_resumes_partial_ddl(self):
        self.setup_account()
        customer = self.call('POST', '/api/customers', {'name': '升级前客户', 'phone': '13800000000'}, expected=201)
        paper = self.call('POST', '/api/papers', {
            'title': '保留关联论文', 'serviceType': 'half', 'customerId': customer['id'], 'contractAmount': '500'}, expected=201)
        self.process.terminate()
        self.process.wait(timeout=10)
        self.sql('ALTER TABLE lw_customer DROP COLUMN referrer, DROP COLUMN customer_type')
        self.sql('DELETE FROM lw_schema_version WHERE version=7')
        for attempt in range(3):
            self.reset_client()
            self.start_server()
            self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
            restored = self.call('GET', '/api/customers/' + customer['id'])
            self.assertEqual(customer['name'], restored['name'])
            self.assertEqual(customer['phone'], restored['phone'])
            self.assertEqual(paper['id'], restored['papers'][0]['id'])
            self.assertEqual(50000, restored['contractCents'])
            self.assertEqual('' if attempt == 0 else '他人介绍', restored['customerType'])
            self.assertEqual('', restored['referrer'])
            self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=7'))
            if attempt == 0:
                self.call('PUT', '/api/customers/' + customer['id'], {
                    'version': restored['version'], 'customerType': '他人介绍', 'referrer': '测试介绍人'})
                self.process.terminate()
                self.process.wait(timeout=10)
                self.sql('ALTER TABLE lw_customer DROP COLUMN referrer')
                self.sql('DELETE FROM lw_schema_version WHERE version=7')
            elif attempt == 1:
                self.process.terminate()
                self.process.wait(timeout=10)

    payment = staticmethod(test_writer_payments.WriterPaymentTest.payment)
    paper = test_writer_payments.WriterPaymentTest.paper
    test_writer_terms = test_writer_payments.WriterPaymentTest.test_terms_alone_do_not_pay_and_confirmed_deposit_and_balance_settle_once
    test_writer_create_retry = test_writer_payments.WriterPaymentTest.test_create_with_payment_cannot_duplicate_paper_or_payment_on_retry
    test_writer_atomic_failure = test_writer_payments.WriterPaymentTest.test_bad_payment_batch_rolls_back_terms_and_every_payment
    test_writer_precision = test_writer_payments.WriterPaymentTest.test_partial_payments_precision_and_version_prevent_double_counting
    test_writer_reduction = test_writer_payments.WriterPaymentTest.test_fee_reductions_cannot_erase_recorded_payments_and_half_has_no_payments
    test_writer_ledger_restore = test_writer_payments.WriterPaymentTest.test_shortcut_payments_and_existing_ledger_share_calculation_after_restore
    test_author_counts = test_authors.AuthorRelationsTest.test_account_and_customer_author_counts_deduplicate_by_name
    test_author_coauthored_papers = test_authors.AuthorRelationsTest.test_coauthors_do_not_multiply_paper_publication_or_customer_fees
    test_author_updates = test_authors.AuthorRelationsTest.test_author_updates_deletes_and_customer_moves_recompute_associations
    test_author_isolation = test_authors.AuthorRelationsTest.test_authors_remain_isolated_between_login_accounts
    test_author_backup = test_authors.AuthorRelationsTest.test_author_associations_survive_old_backups_and_restart_without_new_records
    test_follow_up_roundtrip = test_follow_up.FollowUpTest.test_follow_up_context_roundtrip_updates_backup_and_restart
    test_follow_up_validation = test_follow_up.FollowUpTest.test_new_plan_requires_context_and_failed_updates_are_atomic
    test_follow_up_legacy = test_follow_up.FollowUpTest.test_legacy_backup_keeps_date_and_allows_context_to_be_added
    save_task = test_follow_up_tasks.FollowUpTasksTest.save_task
    test_follow_up_tasks_roundtrip = test_follow_up_tasks.FollowUpTasksTest.test_complete_new_request_and_reopen_preserve_history_backup_and_restart
    test_follow_up_tasks_validation = test_follow_up_tasks.FollowUpTasksTest.test_atomic_validation_concurrent_edits_and_task_ownership
    test_follow_up_tasks_legacy_editor = test_follow_up_tasks.FollowUpTasksTest.test_old_editor_edits_next_task_without_losing_completed_tasks
    test_follow_up_tasks_after_publication = test_follow_up_tasks.FollowUpTasksTest.test_new_requests_can_be_followed_after_publication_or_service_termination

    def test_follow_up_tasks_upgrade_retry_and_delete_cascade(self):
        self.setup_account()
        paper = self.create(followUpAt='2030-01-12', followUpReason='升级前计划')
        self.process.terminate()
        self.process.wait(timeout=10)
        self.sql('DROP TABLE lw_follow_up_history')
        self.sql('DROP TABLE lw_follow_up')
        self.sql('DELETE FROM lw_schema_version WHERE version=13')
        self.reset_client()
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        paper = self.call('GET', '/api/papers/' + paper['id'])
        self.assertEqual('升级前计划', paper['followUps'][0]['content'])
        paper = self.save_task(paper, paper['followUps'][0], note='继续处理')
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_follow_up'))
        self.assertEqual('2', self.sql('SELECT COUNT(*) FROM lw_follow_up_history'))
        self.process.terminate()
        self.process.wait(timeout=10)
        self.sql('DELETE FROM lw_schema_version WHERE version=13')
        self.reset_client()
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        restored = self.call('GET', '/api/papers/' + paper['id'])
        self.assertEqual(paper['followUps'], restored['followUps'])
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=13'))
        self.call('DELETE', '/api/papers/' + paper['id'], {'version': restored['version']})
        self.assertEqual('0', self.sql('SELECT COUNT(*) FROM lw_follow_up'))
        self.assertEqual('0', self.sql('SELECT COUNT(*) FROM lw_follow_up_history'))

    def test_follow_up_schema_upgrade_preserves_old_dates_and_recovers_after_ddl(self):
        self.setup_account()
        paper = self.call('POST', '/api/papers', {
            'title': '升级前跟进计划', 'followUpAt': '2030-01-12', 'followUpReason': '原事项'}, expected=201)
        self.process.terminate()
        self.process.wait(timeout=10)
        self.sql('ALTER TABLE lw_paper DROP COLUMN follow_up_reason')
        self.sql('DELETE FROM lw_schema_version WHERE version=6')
        for attempt in range(2):
            self.reset_client()
            self.start_server()
            self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
            path = '/api/papers/' + paper['id']
            old = self.call('GET', path)
            self.assertEqual('2030-01-12', old['followUpAt'])
            self.assertEqual('' if attempt == 0 else '联系客户确认修改意见', old['followUpReason'])
            self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=6'))
            if attempt == 0:
                self.call('PUT', path, {'version': old['version'], 'followUpReason': '联系客户确认修改意见'})
                self.process.terminate()
                self.process.wait(timeout=10)
                self.sql('DELETE FROM lw_schema_version WHERE version=6')
    JAVA_OPTIONS = test_files.AttachmentTest.JAVA_OPTIONS
    binary = test_files.AttachmentTest.binary
    upload = test_files.AttachmentTest.upload
    restore_archive = test_files.AttachmentTest.restore_archive
    download_file = test_files.AttachmentTest.download_file
    test_file_revisions = test_files.AttachmentTest.test_revisions_keep_originals_and_submission_binding_after_restart
    test_file_validation = test_files.AttachmentTest.test_invalid_uploads_and_stale_edits_leave_no_files
    test_file_backup_isolation = test_files.AttachmentTest.test_account_isolation_and_portable_backup_restores_independent_files
    test_file_restore_atomicity = test_files.AttachmentTest.test_restore_is_atomic_for_damaged_missing_extra_and_duplicate_entries
    test_file_password_change = test_files.AttachmentTest.test_password_change_and_legacy_restore_preserve_expected_files
    test_file_retry = test_files.AttachmentTest.test_retrying_completed_upload_does_not_duplicate_versions

    def test_file_schema_upgrade_is_repeatable_and_keeps_existing_papers(self):
        self.setup_account()
        paper = self.create()
        self.process.terminate()
        self.process.wait(timeout=10)
        self.sql('DROP TABLE lw_paper_file')
        self.sql('ALTER TABLE lw_submission DROP COLUMN manuscript_id')
        self.sql('DELETE FROM lw_schema_version WHERE version=5')
        for attempt in range(2):
            self.reset_client()
            self.start_server()
            self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
            existing = self.call('GET', f"/api/papers/{paper['id']}")
            self.assertEqual(paper['title'], existing['title'])
            self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=5'))
            if attempt == 0:
                paper = self.upload(existing)
                self.process.terminate()
                self.process.wait(timeout=10)
                self.sql('DELETE FROM lw_schema_version WHERE version=5')
        self.assertEqual(test_files.PDF, self.download_file(paper))

    def test_file_archive_can_cross_between_mysql_and_file_storage(self):
        self.setup_account()
        paper = self.upload(self.create())
        archive = self.call('GET', '/api/backup', raw=True)
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        ApiTestCase.start_server(self)
        self.setup_account(username='file-account')
        self.restore_archive(archive)
        local = self.call('GET', '/api/papers')[0]
        self.assertEqual(test_files.PDF, self.download_file(local))
        archive = self.call('GET', '/api/backup', raw=True)
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.restore_archive(archive)
        restored = self.call('GET', '/api/papers')[0]
        self.assertEqual(test_files.PDF, self.download_file(restored))

    def test_file_legacy_import_keeps_manuscripts_and_original_vault(self):
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        ApiTestCase.start_server(self)
        self.setup_account()
        paper = self.upload(self.create())
        original = (self.data / 'papers.vault').read_bytes()
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        restored = self.call('GET', f"/api/papers/{paper['id']}")
        self.assertEqual(paper['files'], restored['files'])
        self.assertEqual(test_files.PDF, self.download_file(restored))
        self.assertEqual(original, (self.data / 'papers.vault').read_bytes())

    def test_file_whole_backup_refuses_a_running_application(self):
        self.setup_account()
        self.upload(self.create())
        options = self.data / 'backup-client.cnf'
        options.write_text('[client]\nhost=127.0.0.1\nport={}\nuser=root\n'.format(self.mysql_port), encoding='utf-8')
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/backup_mysql.py'), '--database', self.database,
                                 '--defaults-file', str(options), '--key-file', str(self.data / 'database.key'),
                                 '--output', str(self.data / 'snapshots'), '--mysqldump', str(self.bin / 'mysqldump.exe')],
                                cwd=ROOT, capture_output=True, encoding='utf-8')
        self.assertNotEqual(0, result.returncode)
        self.assertIn('Stop Paper Desk', result.stderr)
        self.assertFalse(list((self.data / 'snapshots').glob('*.tar.gz')))
        self.assertTrue(self.call('GET', '/api/session')['authenticated'])
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        configured = os.environ.get('MYSQL_TEST_BIN')
        candidates = [pathlib.Path(configured)] if configured else list(pathlib.Path('C:/Program Files/MySQL').glob('*/bin'))
        cls.bin = next((p for p in candidates if (p/'mysqld.exe').exists()), None)
        if cls.bin is None:
            raise RuntimeError('Set MYSQL_TEST_BIN to a MySQL 8.0+ bin directory')
        if not list((ROOT/'lib').glob('mysql-connector-j-*.jar')):
            raise RuntimeError('MySQL JDBC driver is required in lib/')
        (ROOT/'.test-data').mkdir(exist_ok=True)
        cls.mysql_temp = tempfile.TemporaryDirectory(prefix='mysql-', dir=ROOT/'.test-data')
        cls.addClassCleanup(cls.mysql_temp.cleanup)
        cls.mysql_data = pathlib.Path(cls.mysql_temp.name)
        cls.mysql_port = free_port()
        options = [str(cls.bin/'mysqld.exe'), '--no-defaults', f'--basedir={cls.bin.parent}',
                   f'--datadir={cls.mysql_data}', f'--log-error={cls.mysql_data / "mysql.log"}']
        subprocess.run([*options, '--initialize-insecure'], check=True, capture_output=True, timeout=60)
        cls.mysql_process = subprocess.Popen([*options, f'--port={cls.mysql_port}', '--bind-address=127.0.0.1',
                                              '--mysqlx=OFF', '--skip-log-bin', '--innodb-buffer-pool-size=32M'],
                                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.addClassCleanup(cls.stop_mysql)
        for _ in range(200):
            ping = subprocess.run([str(cls.bin/'mysqladmin.exe'), '--no-defaults', '--host=127.0.0.1',
                                   f'--port={cls.mysql_port}', '--user=root', '--connect-timeout=1', 'ping'],
                                  capture_output=True)
            if ping.returncode == 0:
                return
            if cls.mysql_process.poll() is not None:
                break
            time.sleep(.1)
        raise RuntimeError((cls.mysql_data/'mysql.log').read_text(errors='replace'))

    @classmethod
    def stop_mysql(cls):
        if cls.mysql_process.poll() is None:
            subprocess.run([str(cls.bin/'mysqladmin.exe'), '--no-defaults', '--host=127.0.0.1',
                            f'--port={cls.mysql_port}', '--user=root', 'shutdown'], capture_output=True, timeout=20)
            try:
                cls.mysql_process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                cls.mysql_process.terminate()
                cls.mysql_process.wait(timeout=10)

    def start_server(self):
        if not hasattr(self, 'databases'):
            self.databases = {}
        self.database = self.databases.setdefault(str(self.data), 'lw_test_' + uuid.uuid4().hex)
        self.process = subprocess.Popen(['java', *self.JAVA_OPTIONS, '-Dapp.storage=mysql', f'-Dapp.port={self.port}',
                                         f'-Dapp.data={self.data}', f'-Ddb.name={self.database}',
                                         '-Ddb.host=127.0.0.1', f'-Ddb.port={self.mysql_port}',
                                         '-Ddb.username=root', '-Ddb.password=', '-Ddb.sslMode=DISABLED',
                                         '-Ddb.allowPublicKeyRetrieval=true', f'-Ddb.keyFile={self.data / "database.key"}',
                                         '-cp', os.pathsep.join(['out', 'lib/*']), 'Main'], cwd=ROOT,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(160):
            if self.process.poll() is not None:
                self.fail('MySQL application server exited during startup')
            try:
                self.call('GET', '/api/session')
                return
            except (OSError, urllib.error.URLError):
                time.sleep(.05)
        self.process.terminate()
        self.process.wait(timeout=10)
        self.fail('MySQL application server did not start')

    def sql(self, statement):
        result = subprocess.run([str(self.bin/'mysql.exe'), '--no-defaults', '--host=127.0.0.1',
                                 f'--port={self.mysql_port}', '--user=root', '--default-character-set=utf8mb4',
                                 '--batch', '--skip-column-names', self.database, '-e', statement],
                                check=True, capture_output=True, encoding='utf-8')
        return result.stdout.strip()

    test_access_setup_and_request_protection = test_system.SystemTest.test_access_setup_and_request_protection
    test_registration_allows_new_accounts_and_rejects_only_duplicate_names = test_system.SystemTest.test_registration_allows_new_accounts_and_rejects_only_duplicate_names
    test_home_password_change_is_unavailable_and_preserves_credentials = test_system.SystemTest.test_home_password_change_is_unavailable_and_preserves_credentials
    test_password_change_and_login_share_rate_limit = test_system.SystemTest.test_password_change_and_login_share_rate_limit
    test_accounts_have_independent_data_and_survive_switching_and_restart = test_system.SystemTest.test_accounts_have_independent_data_and_survive_switching_and_restart
    test_password_changes_revoke_only_the_matching_accounts_sessions = test_system.SystemTest.test_password_changes_revoke_only_the_matching_accounts_sessions
    test_backup_restore_is_scoped_to_the_current_account = test_system.SystemTest.test_backup_restore_is_scoped_to_the_current_account
    test_restore_preserves_target_account = test_system.SystemTest.test_setup_validates_account_and_restore_preserves_current_account
    test_finance_credentials_history_and_conflicts = test_system.SystemTest.test_finance_credentials_history_and_conflicts
    test_validation_and_failed_changes_are_atomic = test_system.SystemTest.test_validation_and_failed_changes_are_atomic
    test_other_expenses_do_not_settle_balances = test_system.SystemTest.test_other_expenses_do_not_settle_writer_or_customer_balances
    test_login_rate_limiting = test_system.SystemTest.test_failed_login_attempts_are_rate_limited
    test_restart_backup_restore_and_password_change = test_system.SystemTest.test_encryption_restart_backup_restore_and_password_change
    test_static_routes_and_json_rejection = test_system.SystemTest.test_static_routes_and_json_rejection
    test_business_relationships = test_business.BusinessTest.test_customer_writing_submission_finance_relationships
    test_delivery_status = test_business.BusinessTest.test_delivery_date_synchronizes_status_and_stops_overdue
    test_legacy_delivery_status = test_business.BusinessTest.test_legacy_delivered_writing_records_are_consistent_in_every_view
    test_resubmission_journal_history_is_persistent_and_scoped_to_each_paper = test_business.BusinessTest.test_resubmission_journal_history_is_persistent_and_scoped_to_each_paper
    test_submission_validation_and_hidden_password = test_business.BusinessTest.test_submission_version_validation_and_preserve_hidden_password
    test_submission_edit_identity = test_business.BusinessTest.test_submission_edits_keep_identity_count_and_current_pointer
    test_duplicate_journal_guard = test_business.BusinessTest.test_duplicate_journal_creation_is_atomic_and_existing_edits_still_work
    test_reopening_submission_guard = test_business.BusinessTest.test_reopening_an_old_attempt_cannot_duplicate_an_active_attempt
    test_writing_validation_and_customer_reassignment = test_business.BusinessTest.test_writing_validation_customer_identity_and_reassignment
    test_customer_cooperation_date_persistence_validation_and_backup = test_business.BusinessTest.test_customer_cooperation_date_persistence_validation_and_backup
    test_full_and_half_workflows = test_business.BusinessTest.test_full_and_half_service_types_persist_with_independent_workflows
    test_service_type_validation = test_business.BusinessTest.test_service_type_validation_prevents_accidental_writing_data_loss
    test_schema2_backup_without_service_type = test_business.BusinessTest.test_schema2_backup_without_service_type_preserves_writing
    test_customer_deposit_terms_persist_without_creating_payments = test_business.BusinessTest.test_customer_deposit_terms_persist_without_creating_payments

    def test_customer_deposit_schema_upgrade_preserves_existing_data(self):
        self.setup_account()
        paper = self.call('POST', '/api/papers', {'title': '升级前的客户费用', 'contractAmount': '3000'}, expected=201)
        self.process.terminate()
        self.process.wait(timeout=10)
        self.sql('ALTER TABLE lw_paper DROP CHECK ck_paper_contract_deposit, DROP COLUMN contract_deposit_cents')
        self.sql('DELETE FROM lw_schema_version WHERE version=4')
        self.reset_client()
        self.csrf = ''
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        path = f"/api/papers/{paper['id']}"
        old = self.call('GET', path)
        self.assertEqual(0, old['contractDepositCents'])
        self.assertEqual(300000, old['contractBalanceCents'])
        paper = self.call('PUT', path, {'version': old['version'], 'contractDepositAmount': '1000'})
        self.assertEqual('100000', self.sql(f"SELECT contract_deposit_cents FROM lw_paper WHERE id='{paper['id']}'"))
        with self.assertRaises(subprocess.CalledProcessError):
            self.sql(f"UPDATE lw_paper SET contract_deposit_cents=300001 WHERE id='{paper['id']}'")
        self.process.terminate()
        self.process.wait(timeout=10)
        # Retry after DDL completed but before the version was recorded.
        self.sql('DELETE FROM lw_schema_version WHERE version=4')
        self.reset_client()
        self.csrf = ''
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual(100000, self.call('GET', path)['contractDepositCents'])
        self.assertEqual(200000, self.call('GET', path)['contractBalanceCents'])
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=4'))

    def test_delete_paper_preserves_customer_and_other_papers_after_restart(self):
        test_business.BusinessTest.test_delete_paper_preserves_customer_and_other_papers_after_restart(self)
        for table in ('lw_paper', 'lw_writing_task', 'lw_submission', 'lw_financial_transaction',
                      'lw_paper_history', 'lw_paper_current_submission'):
            column = 'id' if table == 'lw_paper' else 'paper_id'
            expected={'lw_submission':2,'lw_financial_transaction':2}.get(table,1)
            actual=int(self.sql(f"SELECT COUNT(*) FROM {table} WHERE {column}='{self.deleted_paper_id}'"))
            self.assertGreaterEqual(actual,expected,table)
        ids = ','.join("'" + value + "'" for value in self.deleted_submission_ids)
        self.assertEqual('2', self.sql(f"SELECT COUNT(*) FROM lw_submission_credential WHERE submission_id IN ({ids})"))
        self.assertGreaterEqual(int(self.sql(f"SELECT COUNT(*) FROM lw_financial_audit WHERE paper_id='{self.deleted_paper_id}'")),2)

    def test_half_papers_have_no_writing_task_and_schema_upgrade_preserves_old_tasks(self):
        self.setup_account()
        full = self.call('POST', '/api/papers', {'title': '已有写作论文', 'writer': '原写作人'}, expected=201)
        self.process.terminate()
        self.process.wait(timeout=10)
        self.sql('ALTER TABLE lw_paper DROP COLUMN service_type')
        self.sql('DELETE FROM lw_schema_version WHERE version=3')
        self.reset_client()
        self.csrf = ''
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        old = self.call('GET', f"/api/papers/{full['id']}")
        self.assertEqual('full', old['serviceType'])
        self.assertEqual('原写作人', old['writer'])
        half = self.call('POST', '/api/papers', {'title': '半包不产生写作任务', 'serviceType': 'half'}, expected=201)
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_writing_task'))
        self.assertEqual('0', self.sql(f"SELECT COUNT(*) FROM lw_writing_task WHERE paper_id='{half['id']}'"))
        self.assertEqual('half', self.sql(f"SELECT service_type FROM lw_paper WHERE id='{half['id']}'"))
        self.process.terminate()
        self.process.wait(timeout=10)
        # Simulate an interrupted upgrade after DDL but before recording its checksum.
        self.sql('DELETE FROM lw_schema_version WHERE version=3')
        self.reset_client()
        self.csrf = ''
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual('half', self.call('GET', f"/api/papers/{half['id']}")['serviceType'])
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=3'))

    def test_customer_cooperation_date_schema_upgrade_and_repeat_start(self):
        self.setup_account()
        customer = self.call('POST', '/api/customers', {'name': '已有客户'}, expected=201)
        self.process.terminate()
        self.process.wait(timeout=10)
        # Recreate the deployed V001 shape, preserving the existing customer and account.
        self.sql('ALTER TABLE lw_customer DROP COLUMN cooperation_started_at')
        self.sql('DELETE FROM lw_schema_version WHERE version=2')
        self.start_server()
        self.reset_client()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        path = f"/api/customers/{customer['id']}"
        self.assertEqual('', self.call('GET', path)['cooperationStartedAt'])
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_customer WHERE cooperation_started_at IS NULL'))
        customer = self.call('PUT', path, {'version': customer['version'], 'cooperationStartedAt': '2026-01-12'})
        self.assertEqual('2026-01-12', self.sql('SELECT cooperation_started_at FROM lw_customer'))
        self.process.terminate()
        self.process.wait(timeout=10)
        self.start_server()
        self.reset_client()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual('2026-01-12', self.call('GET', path)['cooperationStartedAt'])
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=2'))

    def test_customer_cooperation_date_upgrade_recovers_after_ddl(self):
        self.setup_account()
        customer = self.call('POST', '/api/customers', {'name': '已记录合作日期', 'cooperationStartedAt': '2026-01-12'}, expected=201)
        self.process.terminate()
        self.process.wait(timeout=10)
        # Simulate a crash after ALTER TABLE committed but before the version was recorded.
        self.sql('DELETE FROM lw_schema_version WHERE version=2')
        self.start_server()
        self.reset_client()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual('2026-01-12', self.call('GET', f"/api/customers/{customer['id']}")['cooperationStartedAt'])
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=2'))

    def test_full_database_and_key_backup_restores_all_accounts(self):
        self.setup_account()
        first = self.upload(self.create(title='云端迁移的第一账号论文'))
        self.reset_client()
        self.csrf = self.register_account({'username': 'second-user', 'password': 'Second-password-2026'})['csrf']
        second = self.upload(self.create(title='云端迁移的第二账号论文'))
        options = self.data / 'backup-client.cnf'
        options.write_text('[client]\nhost=127.0.0.1\nport={}\nuser=root\n'.format(self.mysql_port), encoding='utf-8')
        options.chmod(0o600)
        self.process.terminate()
        self.process.wait(timeout=10)
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/backup_mysql.py'), '--database', self.database,
                                 '--defaults-file', str(options), '--key-file', str(self.data / 'database.key'),
                                 '--output', str(self.data / 'snapshots'), '--mysqldump', str(self.bin / 'mysqldump.exe')],
                                cwd=ROOT, check=True, capture_output=True, encoding='utf-8')
        archive = pathlib.Path(result.stdout.strip())
        subprocess.run([sys.executable, str(ROOT / 'scripts/backup_mysql.py'), '--verify', str(archive)],
                       cwd=ROOT, check=True, capture_output=True)
        with tarfile.open(archive, 'r:gz') as stream:
            sql = stream.extractfile('database.sql').read()
            key = stream.extractfile('database.key').read()
            for name in stream.getnames():
                if name.startswith('attachments/'):
                    target = self.data / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(stream.extractfile(name).read())
        self.assertEqual((self.data / 'database.key').read_bytes(), key)
        self.assertIn(b'second-user', sql)
        self.assertNotIn(b'Test-password-2026', sql)
        self.assertNotIn(b'Second-password-2026', sql)
        self.assertNotIn(b'private-secret-42', sql)
        self.process.terminate()
        self.process.wait(timeout=10)
        # This is the class's disposable server/database, never the installed MySQL service.
        self.assertRegex(self.database, r'^lw_test_[a-f0-9]{32}$')
        command = [str(self.bin / 'mysql.exe'), '--no-defaults', '--host=127.0.0.1',
                   '--port={}'.format(self.mysql_port), '--user=root', '--default-character-set=utf8mb4']
        subprocess.run([*command, '-e', 'DROP DATABASE `{}`'.format(self.database)], check=True, capture_output=True)
        subprocess.run(command, input=sql, check=True, capture_output=True)
        (self.data / 'database.key').write_bytes(key)
        self.reset_client()
        self.csrf = ''
        self.start_server()
        for username, password, expected in [('test-user', 'Test-password-2026', first),
                                              ('second-user', 'Second-password-2026', second)]:
            self.reset_client()
            self.csrf = self.call('POST', '/api/login', {'username': username, 'password': password})['csrf']
            self.assertEqual([expected['id']], [p['id'] for p in self.call('GET', '/api/papers')])
            self.assertEqual(test_files.PDF, self.download_file(expected))
            self.assertEqual('private-secret-42', self.call('POST', '/api/papers/{}/credentials'.format(expected['id']))['password'])

    def test_relational_storage_and_encryption(self):
        self.setup_account()
        paper = self.create()
        self.assertEqual('mysql', self.call('GET', '/api/session')['storage'])
        self.assertFalse((self.data/'papers.vault').exists())
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_writing_task'))
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_submission'))
        self.assertTrue(self.sql('SELECT password_hash FROM lw_user').startswith('pbkdf2_sha256$'))
        encrypted = self.sql('SELECT password_ciphertext FROM lw_submission_credential')
        self.assertTrue(encrypted)
        self.assertNotIn('private-secret-42', encrypted)
        self.assertEqual('800010', self.sql('SELECT contract_cents FROM lw_paper'))
        self.assertEqual(paper['customerId'], self.sql('SELECT customer_id FROM lw_paper'))
        # Ciphertext is authenticated against its own submission UUID.
        other = self.create(title='另一篇论文')
        self.sql(f"UPDATE lw_submission_credential SET password_ciphertext='{encrypted}' WHERE submission_id='{other['activeSubmissionId']}'")
        self.call('POST', f"/api/papers/{other['id']}/credentials", expected=500)

    def test_legacy_import_is_atomic_and_keeps_original(self):
        self.process.terminate()
        self.process.wait(timeout=10)
        subprocess.run(['javac', '-encoding', 'UTF-8', '--release', '17', '-d', 'out',
                        *[str(p) for p in (ROOT/'src').glob('*.java')], str(ROOT/'tests/LegacyFixture.java')],
                       cwd=ROOT, check=True, capture_output=True)
        subprocess.run(['java', '-cp', 'out', 'LegacyFixture', str(self.data)], cwd=ROOT, check=True, capture_output=True)
        original = (self.data/'papers.vault').read_bytes()
        self.start_server()
        self.assertTrue(self.call('GET', '/api/session')['initialized'])
        self.call('POST', '/api/setup', {'username':'test-user','password':'Test-password-2026'}, expected=409)
        self.call('POST', '/api/login', {'username':'wrong-user','password':'Test-password-2026'}, expected=401)
        self.assertEqual('0', self.sql('SELECT COUNT(*) FROM lw_user'))
        self.csrf = self.call('POST', '/api/login', {'username':'test-user','password':'Test-password-2026'})['csrf']
        paper = self.call('GET', '/api/papers')[0]
        self.assertEqual('旧写作题目', paper['title'])
        self.assertEqual(120000, paper['paidCents'])
        self.assertEqual('legacy-private-password', self.call('POST', f"/api/papers/{paper['id']}/credentials")['password'])
        self.assertEqual(original, (self.data/'papers.vault').read_bytes())
        saved = list((self.data/'backups').glob('pre-mysql-*.vault'))
        self.assertEqual(1, len(saved))
        self.assertEqual(original, saved[0].read_bytes())
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_storage_meta WHERE legacy_import_sha256 IS NOT NULL'))
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username':'test-user','password':'Test-password-2026'})['csrf']
        self.assertEqual(1, len(self.call('GET', '/api/papers')))
        self.assertEqual(1, len(list((self.data/'backups').glob('pre-mysql-*.vault'))))

    def test_restore_reassigns_retained_paper_and_deletes_previous_customer(self):
        self.setup_account()
        first = self.call('POST', '/api/customers', {'name':'原客户'}, expected=201)
        paper = self.create(customerId=first['id'])
        backup = self.call('GET', '/api/backup', raw=True)
        second = self.call('POST', '/api/customers', {'name':'后来客户'}, expected=201)
        self.call('PUT', f"/api/papers/{paper['id']}", {'version':paper['version'], 'customerId':second['id']})
        self.call('DELETE', f"/api/customers/{first['id']}", {'version':first['version']})
        self.call('POST', '/api/restore', {'backup':base64.b64encode(backup).decode(), 'password':'Test-password-2026'})
        self.assertEqual(first['id'], self.call('GET', '/api/papers')[0]['customerId'])
        self.assertEqual([first['id']], [c['id'] for c in self.call('GET', '/api/customers')])

    def test_mysql_backup_can_be_restored_in_file_mode(self):
        self.setup_account()
        paper = self.create()
        backup = self.call('GET', '/api/backup', raw=True)
        self.process.terminate()
        self.process.wait(timeout=10)
        ApiTestCase.start_server(self)
        self.setup_account(username='local-account')
        self.call('POST', '/api/restore', {'backup':base64.b64encode(backup).decode(), 'password':'Test-password-2026'})
        self.assertEqual('local-account', self.call('GET', '/api/session')['username'])
        self.assertEqual(paper['id'], self.call('GET', '/api/papers')[0]['id'])
        self.assertEqual('private-secret-42', self.call('POST', f"/api/papers/{paper['id']}/credentials")['password'])
