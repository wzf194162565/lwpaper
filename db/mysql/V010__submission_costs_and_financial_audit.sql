CREATE TABLE IF NOT EXISTS lw_publication_account (
  id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  paper_id CHAR(36) NOT NULL,
  submission_id CHAR(36) NULL,
  journal VARCHAR(200) NOT NULL DEFAULT '',
  mode VARCHAR(16) NOT NULL,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  settlement_status VARCHAR(16) NOT NULL DEFAULT 'open',
  final_cents BIGINT NOT NULL DEFAULT 0,
  legacy VARCHAR(3) NOT NULL DEFAULT '',
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_publication_submission(workspace_id,paper_id,submission_id),
  CONSTRAINT fk_publication_account_paper FOREIGN KEY(workspace_id,paper_id) REFERENCES lw_paper(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT ck_publication_account CHECK (mode IN ('pending','included','free','author') AND amount_cents BETWEEN 0 AND 100000000 AND final_cents BETWEEN 0 AND 100000000 AND settlement_status IN ('open','confirmed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='按投稿分别保存版面费约定与最终成本，历史不明归属保留独立账户';
CREATE TABLE IF NOT EXISTS lw_financial_audit (
  id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  paper_id CHAR(36) NOT NULL,
  action VARCHAR(16) NOT NULL,
  actor VARCHAR(64) NOT NULL,
  event_at DATETIME(6) NOT NULL,
  transaction_id CHAR(36) NULL,
  reversal_of CHAR(36) NULL,
  corrects_transaction_id CHAR(36) NULL,
  publication_account_id CHAR(36) NULL,
  file_id CHAR(36) NULL,
  type VARCHAR(40) NOT NULL DEFAULT '',
  amount_cents BIGINT NOT NULL DEFAULT 0,
  occurred_at DATE NULL,
  method VARCHAR(80) NOT NULL DEFAULT '',
  note VARCHAR(1000) NOT NULL DEFAULT '',
  reason VARCHAR(1000) NOT NULL DEFAULT '',
  PRIMARY KEY(id),
  KEY ix_financial_audit_paper(workspace_id,paper_id,event_at),
  CONSTRAINT fk_financial_audit_paper FOREIGN KEY(workspace_id,paper_id) REFERENCES lw_paper(workspace_id,id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收支、冲销、凭证和费用核对的不可覆盖操作快照';
ALTER TABLE lw_financial_transaction ADD COLUMN actor VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE lw_financial_transaction ADD COLUMN reversal_of CHAR(36) NULL;
ALTER TABLE lw_financial_transaction ADD COLUMN reversal_reason VARCHAR(1000) NOT NULL DEFAULT '';
ALTER TABLE lw_financial_transaction ADD COLUMN corrects_transaction_id CHAR(36) NULL;
ALTER TABLE lw_financial_transaction ADD COLUMN publication_account_id CHAR(36) NULL;
ALTER TABLE lw_financial_transaction ADD UNIQUE KEY uk_financial_reversal(workspace_id,paper_id,reversal_of);
ALTER TABLE lw_paper_file ADD COLUMN purpose VARCHAR(16) NOT NULL DEFAULT 'manuscript';
ALTER TABLE lw_paper_file ADD COLUMN transaction_id CHAR(36) NULL;
ALTER TABLE lw_paper_file ADD COLUMN uploaded_by VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE lw_paper_file ADD UNIQUE KEY uk_file_revision_kind(workspace_id,paper_id,purpose,revision);
ALTER TABLE lw_paper_file DROP INDEX uk_file_revision;
INSERT INTO lw_publication_account(id,workspace_id,paper_id,submission_id,journal,mode,amount_cents,settlement_status,final_cents,legacy,created_at,updated_at)
SELECT UUID(),p.workspace_id,p.id,
 CASE WHEN (SELECT COUNT(*) FROM lw_submission s WHERE s.workspace_id=p.workspace_id AND s.paper_id=p.id)>1 THEN NULL ELSE c.submission_id END,
 CASE WHEN (SELECT COUNT(*) FROM lw_submission s WHERE s.workspace_id=p.workspace_id AND s.paper_id=p.id)>1 THEN '历史汇总（待核对归属）' ELSE COALESCE(s.journal,'') END,
 COALESCE(f.mode,'pending'),COALESCE(f.amount_cents,0),'open',0,
 CASE WHEN (SELECT COUNT(*) FROM lw_submission s WHERE s.workspace_id=p.workspace_id AND s.paper_id=p.id)>1 THEN 'yes' ELSE '' END,
 p.created_at,p.updated_at
FROM lw_paper p LEFT JOIN lw_paper_publication_fee f ON f.workspace_id=p.workspace_id AND f.paper_id=p.id
 LEFT JOIN lw_paper_current_submission c ON c.workspace_id=p.workspace_id AND c.paper_id=p.id
 LEFT JOIN lw_submission s ON s.workspace_id=c.workspace_id AND s.id=c.submission_id
WHERE NOT EXISTS(SELECT 1 FROM lw_publication_account a WHERE a.workspace_id=p.workspace_id AND a.paper_id=p.id);
UPDATE lw_financial_transaction t JOIN lw_publication_account a ON a.workspace_id=t.workspace_id AND a.paper_id=t.paper_id
SET t.publication_account_id=a.id WHERE t.type IN ('outgoing_publication','incoming_publication_refund') AND t.publication_account_id IS NULL;
