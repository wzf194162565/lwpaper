-- 客户的实际合作开始日期独立记录，原客户不推断日期，保留为空供补录。
ALTER TABLE lw_customer
  ADD COLUMN cooperation_started_at DATE NULL COMMENT '客户实际合作开始日期，可为空，不等于档案创建时间' AFTER status;
