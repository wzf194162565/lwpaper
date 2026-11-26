ALTER TABLE lw_user ADD COLUMN password_ciphertext VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '登录密码的 AES-256-GCM 加密副本，绑定用户 UUID；旧账号成功登录后补存';
