ALTER TABLE lw_paper
  ADD COLUMN follow_up_reason VARCHAR(1000) NOT NULL DEFAULT ''
  COMMENT '下次业务跟进的由来、目标与待办事项'
  AFTER follow_up_at;
