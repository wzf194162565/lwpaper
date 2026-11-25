CREATE TABLE IF NOT EXISTS lw_follow_up (
  id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  paper_id CHAR(36) NOT NULL,
  content VARCHAR(1000) NOT NULL DEFAULT '',
  follow_up_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL,
  note TEXT NOT NULL,
  closed_at VARCHAR(40) NOT NULL DEFAULT '',
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_follow_up_workspace (workspace_id,id),
  KEY ix_follow_up_due (workspace_id,status,follow_up_date),
  CONSTRAINT fk_follow_up_paper FOREIGN KEY (workspace_id,paper_id) REFERENCES lw_paper(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT ck_follow_up_status CHECK (status IN ('pending','in_progress','completed','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lw_follow_up_history (
  id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  paper_id CHAR(36) NOT NULL,
  content VARCHAR(1000) NOT NULL DEFAULT '',
  follow_up_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL,
  note TEXT NOT NULL,
  closed_at VARCHAR(40) NOT NULL DEFAULT '',
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  task_id CHAR(36) NOT NULL,
  event_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_follow_up_history (workspace_id,task_id,event_at),
  CONSTRAINT fk_follow_up_history_paper FOREIGN KEY (workspace_id,paper_id) REFERENCES lw_paper(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_follow_up_history_task FOREIGN KEY (workspace_id,task_id) REFERENCES lw_follow_up(workspace_id,id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
