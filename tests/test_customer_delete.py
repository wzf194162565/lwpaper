"""Customer deletion removes linked records and files without touching other customers."""
from test_files import AttachmentTest, PDF


class CustomerCascadeDeleteTest(AttachmentTest):
    def test_customer_cascade_delete_requires_confirmation_and_preserves_other_data(self):
        self.setup_account()
        customer = self.call('POST', '/api/customers', {'name': 'Delete customer'}, expected=201)
        other = self.call('POST', '/api/customers', {'name': 'Keep customer'}, expected=201)
        paper = self.upload(self.create(customerId=customer['id'], followUpAt='2030-01-01', followUpReason='Follow up'))
        second = self.create(customerId=customer['id'])
        kept = self.upload(self.create(customerId=other['id']))
        paper = self.call('POST', f"/api/papers/{paper['id']}/transactions",
                          {'version': paper['version'], 'type': 'incoming_deposit', 'amount': '100', 'date': '2026-01-01'}, expected=201)
        target = f"/api/customers/{customer['id']}"
        self.call('DELETE', target, {'version': customer['version']}, expected=409)
        self.call('DELETE', target, {'version': customer['version'] + 1, 'confirmCascadeDelete': True}, expected=409)
        self.assertEqual(3, len(self.call('GET', '/api/papers')))
        self.call('DELETE', target, {'version': customer['version'], 'confirmCascadeDelete': True})
        self.assertEqual([kept['id']], [p['id'] for p in self.call('GET', '/api/papers')])
        self.assertEqual([other['id']], [c['id'] for c in self.call('GET', '/api/customers')])
        for deleted in (paper, second):
            self.call('GET', f"/api/papers/{deleted['id']}", expected=404)
        self.call('GET', target, expected=404)
        self.assertEqual(PDF, self.download_file(kept))
        self.assertEqual(1, len(list(self.data.rglob('*.bin'))))
