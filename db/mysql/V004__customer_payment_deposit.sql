-- 客户收款约定：旧记录定金默认 0，约定尾款由服务费总额减定金计算。
ALTER TABLE lw_paper
  ADD COLUMN contract_deposit_cents BIGINT NOT NULL DEFAULT 0 COMMENT '约定向客户收取的定金，单位人民币分，不代表实际收款' AFTER contract_cents,
  ADD CONSTRAINT ck_paper_contract_deposit CHECK (contract_deposit_cents BETWEEN 0 AND contract_cents);
