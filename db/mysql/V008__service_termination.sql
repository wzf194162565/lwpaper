CREATE TABLE IF NOT EXISTS lw_paper_service_termination (
  paper_id CHAR(36) NOT NULL COMMENT '关联论文 UUID，一篇论文一条服务终止结算',
  workspace_id CHAR(36) NOT NULL COMMENT '所属工作空间 UUID',
  terminated_at DATE NOT NULL COMMENT '终止服务日期，与期刊撤稿无关',
  reason VARCHAR(1000) NOT NULL COMMENT '终止原因',
  customer_cents BIGINT NOT NULL COMMENT '客户最终应承担服务费，人民币分',
  writer_cents BIGINT NOT NULL COMMENT '写作者最终应得稿酬，人民币分',
  updated_at DATETIME(6) NOT NULL COMMENT '最近结算约定时间，UTC',
  PRIMARY KEY (paper_id),
  CONSTRAINT ck_termination_customer CHECK (customer_cents BETWEEN 0 AND 100000000),
  CONSTRAINT ck_termination_writer CHECK (writer_cents BETWEEN 0 AND 100000000),
  CONSTRAINT fk_termination_paper FOREIGN KEY (workspace_id,paper_id) REFERENCES lw_paper(workspace_id,id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='服务终止及结算约定，原稿件、投稿和收支保留';
