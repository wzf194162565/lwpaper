# MySQL 全量迁移与备份

适用于把当前 MySQL 的全部账号、独立空间、客户、论文、历次投稿及收支迁移到 ECS 或 RDS。全量迁移保留原来的登录账号和密码。应用界面的 `.vault` 备份只包含当前账号的业务数据，适合单账号导入。

迁移期间先暂停本机录入，直到确认云端成为正式使用入口。以下整库恢复步骤用于新建的空目标数据库；已有业务的数据库应先做独立备份，再制定合并或替换方案。

## 1. 在原电脑导出数据库和匹配密钥

复制 `deploy/mysql-client.example.cnf` 为 `data/migration-client.cnf`，在本机编辑其中的 host、port、user、password，使其与当前 MySQL 配置一致。该文件属于 MySQL 客户端格式，与 Java 的 `application.properties` 格式不同；密码不写进命令参数。

PowerShell 在项目根目录执行，数据库名和密钥路径按实际配置修改：

```powershell
python scripts/backup_mysql.py --database lunwen --defaults-file data/migration-client.cnf --key-file data/database.key --output data/cloud-migration
```

如果 `mysqldump` 不在 PATH，追加 `--mysqldump "C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe"`，路径以本机实际安装位置为准。脚本直接以二进制方式接收导出内容，避免 PowerShell 重定向改变中文 SQL 的编码。

生成的 `paper-desk-mysql-lunwen-时间-随机编号.tar.gz` 包含：

- `database.sql`：整个应用数据库，含所有账号及空间。
- `database.key`：与投稿密码密文匹配的原始密钥。
- `MANIFEST.json`：数据库名、时间、文件大小及 SHA-256 校验。

这是包含业务数据和密钥的私有备份，与公开程序部署包分别保存、上传，不放入网站目录或代码仓库。脚本不会复制数据库连接密码。Linux 下备份文件权限为 600，未完成的导出不会发布为备份。

校验后，通过已配置的 SSH 身份上传到服务器的私有目录：

```powershell
python scripts/backup_mysql.py --verify data/cloud-migration/实际备份文件名.tar.gz
scp data/cloud-migration/实际备份文件名.tar.gz SSH_USER@SERVER_IP:~/
```

## 2. 在 ECS 上恢复到空目标库

先按 `DEPLOY.md` 安装应用及 MySQL，并建立 `lunwen` 数据库和应用账号。恢复前停止应用，避免自动初始化账号或写入数据：

```bash
sudo systemctl stop paper-desk
python3 /opt/paper-desk/tools/backup_mysql.py --verify ~/实际备份文件名.tar.gz
install -d -m 0700 ~/paper-desk-migration
tar -xzf ~/实际备份文件名.tar.gz -C ~/paper-desk-migration
```

先用数据库管理账号核对目标库的表数。以下示例使用本机 MySQL 的 socket 管理账号：

```bash
sudo mysql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='lunwen';"
```

新目标库应输出 **0**。如已有表，先停止恢复，检查是否连接到了旧环境。随后在服务器上执行 SQL 导入和密钥安装：

```bash
sudo mysql < ~/paper-desk-migration/database.sql
sudo install -m 0600 -o paperdesk -g paperdesk ~/paper-desk-migration/database.key /opt/paper-desk/data/database.key
sudo systemctl start paper-desk
sudo systemctl status paper-desk --no-pager
curl -fsS http://127.0.0.1:8080/api/session
```

如果 MySQL 管理账号需要密码，用 `mysql -u root -p` 的交互式登录，再在会话中执行 `SOURCE /完整路径/database.sql;`；不要把密码直接写在命令行。备份包含原数据库名，以上流程假定两端都使用 `lunwen`。需要改库名时先制定相应 SQL 恢复步骤。

若使用 RDS，先在 RDS 控制台建立数据库及管理账号，使用对应的私有 MySQL 客户端配置文件连接内网地址导入；`database.key` 仍安装在 ECS 的应用数据目录。RDS 的目标库名与备份中的库名保持一致。

## 3. 验收与切换

通过 SSH 隧道或 HTTPS 域名访问云端，使用原账号密码登录，分别核对：

1. 各账号的客户、论文和收支数量及金额。
2. 一篇多次改投的论文，其历史期刊、日期和状态是否齐全。
3. 投稿系统密码能否在详情中正常显示。
4. 不同账号的数据是否仍隔离。
5. 新增一条记录、重启应用后，记录是否保留。

核对完成后统一使用云端入口，保留本机及迁移备份一段时间，避免两边继续独立录入。

## 4. 云端定时备份

服务器安装 Python 3 和 MySQL 客户端。创建私有客户端配置：

```bash
sudo install -d -m 0700 /etc/paper-desk
sudo install -m 0600 /opt/paper-desk/config/mysql-client.example.cnf /etc/paper-desk/mysql-backup.cnf
sudoedit /etc/paper-desk/mysql-backup.cnf
```

填写云端数据库连接信息，先手动验证一次完整备份：

```bash
sudo python3 /opt/paper-desk/tools/backup_mysql.py --database lunwen --defaults-file /etc/paper-desk/mysql-backup.cnf --key-file /opt/paper-desk/data/database.key --output /var/backups/paper-desk
```

确认成功后启用每天 03:20 的任务：

```bash
sudo install -m 0644 /opt/paper-desk/deploy/backup.cron.example /etc/cron.d/paper-desk-backup
```

备份使用事务快照，可以在应用运行时执行；不会自动删除旧备份。按实际磁盘容量安排保留周期，并把副本保存到 ECS 之外，例如私有 OSS 存储桶或本地离线存储。ECS 与本机数据库的独立加密密钥都需要和各自备份匹配保存。
