-- 登录账号的密码找回邮箱；旧账号保留空值，登录后可补绑。
ALTER TABLE lw_user ADD COLUMN recovery_email VARCHAR(254) NOT NULL DEFAULT '' COMMENT '找回登录密码的绑定邮箱，不是投稿或客户邮箱';
