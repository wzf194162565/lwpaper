ALTER TABLE lw_paper
  ADD COLUMN author_bio VARCHAR(2000) NOT NULL DEFAULT ''
  COMMENT '论文作者简介，自由文本'
  AFTER authors;
