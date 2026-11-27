CREATE TABLE IF NOT EXISTS lw_writer (
 id CHAR(36) NOT NULL,
 workspace_id CHAR(36) NOT NULL,
 name VARCHAR(200) NOT NULL,
 phone VARCHAR(200) NOT NULL DEFAULT '',
 email VARCHAR(200) NOT NULL DEFAULT '',
 wechat VARCHAR(200) NOT NULL DEFAULT '',
 specialties TEXT NOT NULL,
 notes TEXT NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'active',
 version BIGINT NOT NULL DEFAULT 1,
 created_at DATETIME(6) NOT NULL,
 updated_at DATETIME(6) NOT NULL,
 PRIMARY KEY (id),
 UNIQUE KEY uk_writer_workspace (workspace_id,id),
 KEY ix_writer_name (workspace_id,name),
 CONSTRAINT fk_writer_workspace FOREIGN KEY (workspace_id) REFERENCES lw_workspace(id) ON DELETE CASCADE,
 CONSTRAINT ck_writer_status CHECK (status IN ('active','paused','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
