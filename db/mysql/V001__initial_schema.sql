-- 知序 MySQL 初始结构。只创建本系统的 lw_ 前缀表，不删除已有数据库或业务表。
-- 金额统一为人民币整数分，业务日期为 DATE，时间统一为 UTC DATETIME(6)。

CREATE TABLE IF NOT EXISTS lw_schema_version (
  version INT NOT NULL COMMENT '数据库结构版本号',
  description VARCHAR(200) NOT NULL COMMENT '本次结构迁移说明',
  checksum CHAR(64) NOT NULL COMMENT '迁移脚本 SHA-256，用于检测已执行脚本被修改',
  installed_at DATETIME(6) NOT NULL COMMENT '结构迁移执行时间，UTC',
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据库结构迁移版本记录';

CREATE TABLE IF NOT EXISTS lw_workspace (
  id CHAR(36) NOT NULL COMMENT '工作空间 UUID，作为业务数据归属边界',
  name VARCHAR(200) NOT NULL COMMENT '工作空间名称',
  state_revision BIGINT NOT NULL DEFAULT 0 COMMENT '业务事务修订号，写操作通过行锁串行化',
  created_at DATETIME(6) NOT NULL COMMENT '创建时间，UTC',
  updated_at DATETIME(6) NOT NULL COMMENT '最近业务写入时间，UTC',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工作空间及业务事务控制';

CREATE TABLE IF NOT EXISTS lw_storage_meta (
  workspace_id CHAR(36) NOT NULL COMMENT '所属工作空间 UUID',
  key_fingerprint CHAR(64) NOT NULL COMMENT '投稿凭据独立加密密钥的 SHA-256 指纹，不保存密钥本身',
  business_schema INT NOT NULL DEFAULT 2 COMMENT '业务备份与导入的数据格式版本',
  legacy_import_sha256 CHAR(64) NULL COMMENT '已导入旧加密文件的 SHA-256，用于避免重复迁移',
  created_at DATETIME(6) NOT NULL COMMENT '存储初始化时间，UTC',
  PRIMARY KEY (workspace_id),
  CONSTRAINT fk_storage_workspace FOREIGN KEY (workspace_id) REFERENCES lw_workspace(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='存储密钥校验与旧数据迁移标识';

CREATE TABLE IF NOT EXISTS lw_user (
  id CHAR(36) NOT NULL COMMENT '系统用户 UUID，与客户档案分别管理',
  username VARCHAR(64) COLLATE utf8mb4_0900_as_cs NOT NULL COMMENT '登录账号，区分大小写且全局唯一',
  password_hash VARCHAR(255) NOT NULL COMMENT 'PBKDF2-HMAC-SHA256 密码哈希，含算法、轮数和随机盐，不保存明文密码',
  status VARCHAR(20) NOT NULL DEFAULT 'enabled' COMMENT '账号状态：enabled 启用，disabled 停用',
  version BIGINT NOT NULL DEFAULT 1 COMMENT '用户资料乐观锁版本号',
  created_at DATETIME(6) NOT NULL COMMENT '账号创建时间，UTC',
  updated_at DATETIME(6) NOT NULL COMMENT '账号最近修改时间，UTC',
  PRIMARY KEY (id), UNIQUE KEY uk_user_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统登录用户与不可逆密码哈希';

CREATE TABLE IF NOT EXISTS lw_workspace_member (
  id CHAR(36) NOT NULL COMMENT '工作空间成员 UUID',
  workspace_id CHAR(36) NOT NULL COMMENT '所属工作空间 UUID',
  user_id CHAR(36) NOT NULL COMMENT '关联的系统用户 UUID',
  status VARCHAR(20) NOT NULL DEFAULT 'enabled' COMMENT '成员状态：enabled 启用，disabled 停用',
  created_at DATETIME(6) NOT NULL COMMENT '加入工作空间时间，UTC',
  PRIMARY KEY (id), UNIQUE KEY uk_member_workspace_user (workspace_id,user_id), UNIQUE KEY uk_member_scope (workspace_id,id),
  CONSTRAINT fk_member_workspace FOREIGN KEY (workspace_id) REFERENCES lw_workspace(id),
  CONSTRAINT fk_member_user FOREIGN KEY (user_id) REFERENCES lw_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户与工作空间关联，为后续团队成员管理预留';

CREATE TABLE IF NOT EXISTS lw_role (
  code VARCHAR(40) NOT NULL COMMENT '预设角色编码，如 administrator、writer、finance',
  name VARCHAR(100) NOT NULL COMMENT '角色中文名称',
  description VARCHAR(500) NOT NULL COMMENT '角色职责说明，业务细分权限尚未启用',
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预设角色字典，当前仅启用单管理员使用方式';

CREATE TABLE IF NOT EXISTS lw_permission (
  code VARCHAR(80) NOT NULL COMMENT '权限编码，采用资源.操作形式',
  name VARCHAR(150) NOT NULL COMMENT '权限中文说明',
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='细粒度权限字典，为后续服务端鉴权预留';

CREATE TABLE IF NOT EXISTS lw_role_permission (
  role_code VARCHAR(40) NOT NULL COMMENT '角色编码',
  permission_code VARCHAR(80) NOT NULL COMMENT '该角色对应的权限编码',
  PRIMARY KEY (role_code,permission_code),
  CONSTRAINT fk_role_permission_role FOREIGN KEY (role_code) REFERENCES lw_role(code),
  CONSTRAINT fk_role_permission_permission FOREIGN KEY (permission_code) REFERENCES lw_permission(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色与权限多对多关联，预设方案不代表已启用多人权限';

CREATE TABLE IF NOT EXISTS lw_member_role (
  member_id CHAR(36) NOT NULL COMMENT '工作空间成员 UUID',
  role_code VARCHAR(40) NOT NULL COMMENT '成员分配的角色编码',
  PRIMARY KEY (member_id,role_code),
  CONSTRAINT fk_member_role_member FOREIGN KEY (member_id) REFERENCES lw_workspace_member(id),
  CONSTRAINT fk_member_role_role FOREIGN KEY (role_code) REFERENCES lw_role(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='成员与角色关联，导入的现有账号归为管理员';

CREATE TABLE IF NOT EXISTS lw_customer (
  id CHAR(36) NOT NULL COMMENT '客户 UUID，允许不同客户使用相同姓名',
  workspace_id CHAR(36) NOT NULL COMMENT '所属工作空间 UUID',
  name VARCHAR(200) NOT NULL COMMENT '客户姓名或名称',
  phone VARCHAR(200) NOT NULL DEFAULT '' COMMENT '客户联系电话',
  email VARCHAR(200) NOT NULL DEFAULT '' COMMENT '客户电子邮箱',
  wechat VARCHAR(200) NOT NULL DEFAULT '' COMMENT '客户微信号',
  organization VARCHAR(200) NOT NULL DEFAULT '' COMMENT '客户单位或机构',
  address VARCHAR(300) NOT NULL DEFAULT '' COMMENT '客户联系地址',
  status VARCHAR(20) NOT NULL COMMENT '合作状态：待合作、合作中、已归档',
  notes TEXT NOT NULL COMMENT '客户备注，不应填写投稿密码',
  owner_member_id CHAR(36) NULL COMMENT '客户负责人，为后续按负责人授权预留',
  version BIGINT NOT NULL COMMENT '客户乐观锁版本号',
  created_at DATETIME(6) NOT NULL COMMENT '客户档案创建时间，UTC',
  updated_at DATETIME(6) NOT NULL COMMENT '客户档案最近修改时间，UTC',
  PRIMARY KEY (id), UNIQUE KEY uk_customer_scope (workspace_id,id),
  KEY ix_customer_name (workspace_id,name), KEY ix_customer_updated (workspace_id,updated_at),
  CONSTRAINT fk_customer_workspace FOREIGN KEY (workspace_id) REFERENCES lw_workspace(id),
  CONSTRAINT fk_customer_owner FOREIGN KEY (workspace_id,owner_member_id) REFERENCES lw_workspace_member(workspace_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户基本档案，费用和发表成果通过关联论文汇总';

CREATE TABLE IF NOT EXISTS lw_paper (
  id CHAR(36) NOT NULL COMMENT '论文 UUID，贯穿客户、写作、投稿及收支关联',
  workspace_id CHAR(36) NOT NULL COMMENT '所属工作空间 UUID',
  customer_id CHAR(36) NULL COMMENT '关联客户 UUID，可为空，不使用客户姓名作为外键',
  code VARCHAR(40) NOT NULL COMMENT '论文展示编号，同一空间内唯一',
  title VARCHAR(300) NOT NULL COMMENT '写作文章题目，各次投稿题目在投稿表单独保存',
  authors VARCHAR(200) NOT NULL DEFAULT '' COMMENT '论文作者，多个作者可用顿号分隔',
  contract_cents BIGINT NOT NULL DEFAULT 0 COMMENT '约定向客户收取的服务费总额，单位人民币分，多次投稿不重复计算',
  follow_up_at DATE NULL COMMENT '下次业务跟进日期，空表示尚未安排',
  notes TEXT NOT NULL COMMENT '论文及写作业务备注',
  owner_member_id CHAR(36) NULL COMMENT '论文业务负责人，为后续数据权限预留',
  version BIGINT NOT NULL COMMENT '论文及关联写操作的乐观锁版本号',
  created_at DATETIME(6) NOT NULL COMMENT '论文档案创建时间，UTC',
  updated_at DATETIME(6) NOT NULL COMMENT '论文及关联记录最近修改时间，UTC',
  PRIMARY KEY (id), UNIQUE KEY uk_paper_scope (workspace_id,id), UNIQUE KEY uk_paper_code (workspace_id,code),
  KEY ix_paper_customer (workspace_id,customer_id), KEY ix_paper_followup (workspace_id,follow_up_at),
  CONSTRAINT ck_paper_contract CHECK (contract_cents BETWEEN 0 AND 100000000),
  CONSTRAINT fk_paper_workspace FOREIGN KEY (workspace_id) REFERENCES lw_workspace(id),
  CONSTRAINT fk_paper_customer FOREIGN KEY (workspace_id,customer_id) REFERENCES lw_customer(workspace_id,id),
  CONSTRAINT fk_paper_owner FOREIGN KEY (workspace_id,owner_member_id) REFERENCES lw_workspace_member(workspace_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='论文主档案及客户服务费用约定';

CREATE TABLE IF NOT EXISTS lw_writing_task (
  id CHAR(36) NOT NULL COMMENT '写作任务 UUID，当前一篇论文对应一项写作任务',
  workspace_id CHAR(36) NOT NULL COMMENT '所属工作空间 UUID',
  paper_id CHAR(36) NOT NULL COMMENT '关联论文 UUID，同一论文唯一',
  writer_name VARCHAR(200) NOT NULL DEFAULT '' COMMENT '写作人或外部合作人姓名',
  assigned_member_id CHAR(36) NULL COMMENT '系统内写作人员，为后续任务分配权限预留',
  status VARCHAR(20) NOT NULL COMMENT '写作状态：待分配、写作中、待修改、已交稿、已完成、已取消',
  start_at DATE NULL COMMENT '写作开始日期',
  due_at DATE NULL COMMENT '预计交稿日期',
  delivered_at DATE NULL COMMENT '实际交稿日期，未交稿为空',
  fee_cents BIGINT NOT NULL DEFAULT 0 COMMENT '约定写作稿酬总额，单位人民币分',
  deposit_cents BIGINT NOT NULL DEFAULT 0 COMMENT '约定写作定金，单位人民币分，约定尾款为稿酬减定金',
  version BIGINT NOT NULL COMMENT '与当前论文一致的乐观锁版本号',
  created_at DATETIME(6) NOT NULL COMMENT '任务创建时间，UTC',
  updated_at DATETIME(6) NOT NULL COMMENT '任务最近修改时间，UTC',
  PRIMARY KEY (id), UNIQUE KEY uk_writing_paper (workspace_id,paper_id),
  KEY ix_writing_status_due (workspace_id,status,due_at), KEY ix_writing_assignee (workspace_id,assigned_member_id),
  CONSTRAINT ck_writing_fee CHECK (fee_cents BETWEEN 0 AND 100000000 AND deposit_cents BETWEEN 0 AND fee_cents),
  CONSTRAINT fk_writing_paper FOREIGN KEY (workspace_id,paper_id) REFERENCES lw_paper(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_writing_assignee FOREIGN KEY (workspace_id,assigned_member_id) REFERENCES lw_workspace_member(workspace_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='写作任务、时间节点与稿酬定金尾款约定';

CREATE TABLE IF NOT EXISTS lw_submission (
  id CHAR(36) NOT NULL COMMENT '单次投稿 UUID，改投时新增，不覆盖旧投稿',
  workspace_id CHAR(36) NOT NULL COMMENT '所属工作空间 UUID',
  paper_id CHAR(36) NOT NULL COMMENT '关联论文 UUID',
  title VARCHAR(300) NOT NULL COMMENT '本次投稿题目，可与写作题目不同',
  journal VARCHAR(200) NOT NULL DEFAULT '' COMMENT '本次投稿期刊名称，旧数据可能待补录',
  system_name VARCHAR(200) NOT NULL DEFAULT '' COMMENT '投稿系统名称，如 ScholarOne、Editorial Manager',
  system_url VARCHAR(200) NOT NULL DEFAULT '' COMMENT '投稿系统网址，仅允许 HTTP 或 HTTPS',
  status VARCHAR(20) NOT NULL COMMENT '投稿状态：草稿、待投稿、已投稿、审稿中、修改中、已录用、已发表、已拒稿、已撤稿',
  submitted_at DATE NULL COMMENT '实际投稿日期，投稿时长的起点',
  ended_at DATE NULL COMMENT '结束或录用日期，投稿时长的终点，进行中为空',
  published_at DATE NULL COMMENT '实际发表日期，用于客户成果汇总',
  assigned_member_id CHAR(36) NULL COMMENT '负责投稿的成员，为后续任务分配权限预留',
  notes TEXT NOT NULL COMMENT '本次投稿备注，不保存密码',
  sort_order INT NOT NULL COMMENT '同一论文下的投稿顺序，保留原始改投顺序',
  version BIGINT NOT NULL COMMENT '单次投稿乐观锁版本号',
  created_at DATETIME(6) NOT NULL COMMENT '本次投稿记录建立时间，UTC',
  updated_at DATETIME(6) NOT NULL COMMENT '本次投稿记录最近修改时间，UTC',
  PRIMARY KEY (id), UNIQUE KEY uk_submission_scope (workspace_id,id), UNIQUE KEY uk_submission_paper_scope (workspace_id,paper_id,id),
  KEY ix_submission_paper_date (workspace_id,paper_id,submitted_at), KEY ix_submission_status (workspace_id,status,submitted_at),
  CONSTRAINT fk_submission_paper FOREIGN KEY (workspace_id,paper_id) REFERENCES lw_paper(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_submission_assignee FOREIGN KEY (workspace_id,assigned_member_id) REFERENCES lw_workspace_member(workspace_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='每一次投稿、改投、期刊及起止日期，时长按日期实时计算';

CREATE TABLE IF NOT EXISTS lw_submission_credential (
  submission_id CHAR(36) NOT NULL COMMENT '关联投稿 UUID，一次投稿对应一份账号绑定资料',
  workspace_id CHAR(36) NOT NULL COMMENT '所属工作空间 UUID',
  account_name VARCHAR(200) NOT NULL DEFAULT '' COMMENT '投稿系统登录账号',
  password_ciphertext TEXT NOT NULL COMMENT 'AES-256-GCM 密文，含随机 IV 和认证标签，绑定投稿 UUID，禁止保存明文密码',
  key_fingerprint CHAR(64) NOT NULL COMMENT '所用服务器加密密钥的 SHA-256 指纹',
  bound_email VARCHAR(200) NOT NULL DEFAULT '' COMMENT '投稿账号绑定邮箱',
  bound_phone VARCHAR(200) NOT NULL DEFAULT '' COMMENT '投稿账号绑定手机号',
  updated_at DATETIME(6) NOT NULL COMMENT '资料最近随投稿记录修改的时间，UTC',
  PRIMARY KEY (submission_id),
  CONSTRAINT fk_credential_submission FOREIGN KEY (workspace_id,submission_id) REFERENCES lw_submission(workspace_id,id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='投稿登录凭据与绑定联系方式，密码使用独立服务器密钥加密';

CREATE TABLE IF NOT EXISTS lw_paper_current_submission (
  paper_id CHAR(36) NOT NULL COMMENT '论文 UUID，一篇论文最多指定一条当前投稿',
  workspace_id CHAR(36) NOT NULL COMMENT '所属工作空间 UUID',
  submission_id CHAR(36) NOT NULL COMMENT '当前投稿 UUID，复合外键保证属于同一论文和空间',
  PRIMARY KEY (paper_id),
  CONSTRAINT fk_current_paper FOREIGN KEY (workspace_id,paper_id) REFERENCES lw_paper(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_current_submission FOREIGN KEY (workspace_id,paper_id,submission_id) REFERENCES lw_submission(workspace_id,paper_id,id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='论文当前投稿指向，独立关联表避免论文与投稿循环外键';

CREATE TABLE IF NOT EXISTS lw_financial_transaction (
  id CHAR(36) NOT NULL COMMENT '收支流水 UUID',
  workspace_id CHAR(36) NOT NULL COMMENT '所属工作空间 UUID',
  paper_id CHAR(36) NOT NULL COMMENT '关联论文 UUID，客户及写作任务通过论文关联',
  type VARCHAR(40) NOT NULL COMMENT '收支分类：incoming_deposit 收定金、incoming_balance 收尾款、incoming_other 其他收入、outgoing_deposit 付定金、outgoing_balance 付尾款、outgoing_other 其他支出',
  amount_cents BIGINT NOT NULL COMMENT '实际收付款金额，单位人民币分，必须大于零',
  occurred_at DATE NOT NULL COMMENT '实际收款或付款日期',
  method VARCHAR(80) NOT NULL DEFAULT '' COMMENT '收付方式，如转账、微信、支付宝',
  note TEXT NOT NULL COMMENT '流水备注或转账凭证号',
  created_by_member_id CHAR(36) NULL COMMENT '录入成员，为后续财务审计预留',
  version BIGINT NOT NULL DEFAULT 1 COMMENT '流水版本号，为后续冲正或作废操作预留',
  created_at DATETIME(6) NOT NULL COMMENT '流水录入时间，UTC',
  PRIMARY KEY (id), KEY ix_transaction_paper_date (workspace_id,paper_id,occurred_at),
  CONSTRAINT ck_transaction_amount CHECK (amount_cents BETWEEN 1 AND 100000000),
  CONSTRAINT fk_transaction_paper FOREIGN KEY (workspace_id,paper_id) REFERENCES lw_paper(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_transaction_creator FOREIGN KEY (workspace_id,created_by_member_id) REFERENCES lw_workspace_member(workspace_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='论文实际收支流水，定金和尾款参与结算，其他收支单独统计';

CREATE TABLE IF NOT EXISTS lw_paper_history (
  id CHAR(36) NOT NULL COMMENT '业务历史 UUID，旧记录导入时按论文和事件生成稳定编号',
  workspace_id CHAR(36) NOT NULL COMMENT '所属工作空间 UUID',
  paper_id CHAR(36) NOT NULL COMMENT '关联论文 UUID',
  submission_ref CHAR(36) NULL COMMENT '历史投稿编号快照，允许对应投稿已删除，因此不设置投稿外键',
  action VARCHAR(200) NOT NULL COMMENT '业务动作，如新增投稿记录、更新投稿进度',
  status VARCHAR(20) NOT NULL COMMENT '事件发生时的投稿状态快照',
  journal VARCHAR(200) NOT NULL DEFAULT '' COMMENT '事件发生时的期刊名称快照',
  system_name VARCHAR(200) NOT NULL DEFAULT '' COMMENT '事件发生时的投稿系统快照',
  system_url VARCHAR(200) NOT NULL DEFAULT '' COMMENT '事件发生时的投稿网址快照',
  submitted_at DATE NULL COMMENT '事件发生时的投稿日期快照',
  sort_order INT NOT NULL COMMENT '同一论文下的历史事件顺序',
  event_at DATETIME(6) NOT NULL COMMENT '业务事件发生时间，UTC',
  PRIMARY KEY (id), KEY ix_history_paper_time (workspace_id,paper_id,event_at),
  CONSTRAINT fk_history_paper FOREIGN KEY (workspace_id,paper_id) REFERENCES lw_paper(workspace_id,id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='投稿业务变更历史及期刊快照，不保存账号密码';
