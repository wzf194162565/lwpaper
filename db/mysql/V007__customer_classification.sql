ALTER TABLE lw_customer
  ADD COLUMN customer_type VARCHAR(20) NOT NULL DEFAULT ''
  COMMENT '客户类型：同行、终端客户（自主开发）、他人介绍；空字符串为未分类'
  AFTER status;

ALTER TABLE lw_customer
  ADD COLUMN referrer VARCHAR(200) NOT NULL DEFAULT ''
  COMMENT '介绍人姓名或来源说明，可留空'
  AFTER customer_type;
