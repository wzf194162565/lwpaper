CREATE TABLE IF NOT EXISTS lw_paper_publication_fee (
  paper_id CHAR(36) NOT NULL COMMENT '关联论文 UUID',
  workspace_id CHAR(36) NOT NULL COMMENT '所属工作空间 UUID',
  mode VARCHAR(16) NOT NULL COMMENT 'pending 待确认，included 我方承担，free 无版面费，author 作者自理',
  amount_cents BIGINT NOT NULL DEFAULT 0 COMMENT '我方承担的版面费合计，人民币分，作者自理不计入',
  updated_at DATETIME(6) NOT NULL COMMENT '最近更新时间，UTC',
  PRIMARY KEY (paper_id),
  CONSTRAINT ck_publication_fee_amount CHECK (amount_cents BETWEEN 0 AND 100000000),
  CONSTRAINT ck_publication_fee_mode CHECK ((mode='included' AND amount_cents>0) OR (mode IN ('pending','free','author') AND amount_cents=0)),
  CONSTRAINT fk_publication_fee_paper FOREIGN KEY (workspace_id,paper_id) REFERENCES lw_paper(workspace_id,id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='论文版面费承担方式及成本约定，实际收付记录在流水表';
