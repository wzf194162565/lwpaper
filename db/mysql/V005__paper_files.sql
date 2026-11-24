CREATE TABLE IF NOT EXISTS lw_paper_file (
  id CHAR(36) NOT NULL COMMENT '不可覆盖的稿件文件 UUID',
  workspace_id CHAR(36) NOT NULL,
  paper_id CHAR(36) NOT NULL,
  filename VARCHAR(200) NOT NULL COMMENT '原始下载文件名',
  size_bytes BIGINT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  revision BIGINT NOT NULL COMMENT '论文内连续稿件版本号',
  note VARCHAR(1000) NOT NULL DEFAULT '',
  uploaded_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_file_revision (workspace_id,paper_id,revision),
  CONSTRAINT fk_file_paper FOREIGN KEY (workspace_id,paper_id) REFERENCES lw_paper(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT ck_file_size CHECK (size_bytes > 0 AND size_bytes <= 209715200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='稿件文件元数据，正文加密存储在私有附件目录';
