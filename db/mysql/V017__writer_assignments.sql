CREATE TABLE IF NOT EXISTS lw_writer_assignment (
 id CHAR(36) NOT NULL PRIMARY KEY,
 workspace_id CHAR(36) NOT NULL,
 paper_id CHAR(36) NOT NULL,
 writer_id CHAR(36) NOT NULL DEFAULT '',
 writer_name VARCHAR(200) NOT NULL DEFAULT '',
 fee_cents BIGINT NOT NULL DEFAULT 0,
 deposit_cents BIGINT NOT NULL DEFAULT 0,
 final_cents BIGINT NOT NULL DEFAULT 0,
 status VARCHAR(20) NOT NULL DEFAULT '',
 start_at DATE NULL,
 due_at DATE NULL,
 delivered_at DATE NULL,
 reason TEXT NOT NULL,
 closed_at VARCHAR(40) NOT NULL DEFAULT '',
 created_at DATETIME(6) NOT NULL,
 KEY ix_writer_assignment (workspace_id,writer_id,paper_id),
 CONSTRAINT fk_writer_assignment_paper FOREIGN KEY (workspace_id,paper_id) REFERENCES lw_paper(workspace_id,id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE lw_writing_task ADD COLUMN writer_id CHAR(36) NOT NULL DEFAULT '';
ALTER TABLE lw_writing_task ADD COLUMN writer_assignment_id CHAR(36) NOT NULL DEFAULT '';
ALTER TABLE lw_financial_transaction ADD COLUMN writer_id CHAR(36) NOT NULL DEFAULT '';
ALTER TABLE lw_financial_transaction ADD COLUMN writer_assignment_id CHAR(36) NOT NULL DEFAULT '';
ALTER TABLE lw_financial_transaction ADD COLUMN writer_name VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE lw_financial_audit ADD COLUMN writer_id CHAR(36) NOT NULL DEFAULT '';
ALTER TABLE lw_financial_audit ADD COLUMN writer_assignment_id CHAR(36) NOT NULL DEFAULT '';
ALTER TABLE lw_financial_audit ADD COLUMN writer_name VARCHAR(200) NOT NULL DEFAULT '';
