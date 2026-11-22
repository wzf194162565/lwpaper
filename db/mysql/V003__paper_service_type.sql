-- 旧论文保留原写作流程，新建时明确区分全包和客户供稿的半包。
ALTER TABLE lw_paper
  ADD COLUMN service_type VARCHAR(20) NOT NULL DEFAULT 'full' COMMENT '服务类型：full 全包（含写作），half 半包（客户供稿）' AFTER authors;
