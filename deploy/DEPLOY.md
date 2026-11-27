# 知序 · 阿里云 ECS 部署

本包包含 Java 17 兼容的已编译程序、前端、MySQL JDBC 驱动、数据库升级脚本及 Linux 启动/自启/Nginx 模板。无需在服务器编译。未包含 Java 运行时、本机业务数据、数据库连接密码、投稿密钥或 TLS 证书。

以下按 Alibaba Cloud Linux / Ubuntu、systemd、Nginx 1.20+ 部署；程序支持多账号注册和独立工作空间，尚未提供团队共享空间与角色分工。默认使用加密文件存储；需要 MySQL 时按第 3 步配置。Windows Server 可运行根目录 `start.cmd`，仅监听本机；下述 systemd/Nginx 命令面向 Linux。

应用与数据一起部署时，小规模使用可在同一台 ECS 上运行 Java、Nginx 和 MySQL；需要独立数据库托管时将 MySQL 换成 RDS 内网实例。MySQL 的业务记录保存在数据库数据目录，投稿密码密钥保存在应用的 `data/database.key`，还需持久保存 `data/attachments/` 中的加密稿件和各空间的 `files.key`。服务器重启后由 systemd 启动服务。

## 1. 上传与校验

上传 `.tar.gz` 及同名 `.sha256` 到服务器的独立目录。将下列包名替换为实际文件名：

```bash
sha256sum -c paper-desk-aliyun-YYYYMMDD-HHMMSS.tar.gz.sha256
tar -xzf paper-desk-aliyun-YYYYMMDD-HHMMSS.tar.gz
cd paper-desk-aliyun-YYYYMMDD-HHMMSS
```

ZIP 与 tar.gz 内容相同，Linux 推荐 tar.gz。阿里云安全组保留自己的 SSH 访问规则；公网使用时为 Nginx 开放 80/443，应用的 8080 和自建 MySQL 的 3306 无需对公网开放。

## 2. 安装 Java 和服务

Ubuntu / Debian：

```bash
sudo apt update
sudo apt install -y openjdk-17-jre-headless nginx
```

Alibaba Cloud Linux 3 / Rocky / AlmaLinux：

```bash
sudo dnf install -y java-17-openjdk-headless nginx
```

确认 `java -version` 至少为 17、`nginx -v` 至少为 1.20。若系统仓库的 Nginx 较旧，升级到受支持版本后再使用附带的 HTTPS 配置。

在解压目录运行：

```bash
sudo bash install.sh
```

安装到 `/opt/paper-desk`，创建 `paperdesk` 服务用户并配置开机自启。安装器保留现有 `config/application.properties` 和 `data/`；首次安装后尚未启动，便于先选定存储方式。无需安装服务时，可在解压目录执行 `bash start.sh` 前台运行，Ctrl+C 停止。

## 3. 配置存储并启动

### 同一台 ECS 安装 MySQL

Ubuntu 22.04 / 24.04 示例：

```bash
sudo apt update
sudo apt install -y mysql-server mysql-client python3
sudo systemctl enable --now mysql
```

Alibaba Cloud Linux 3 / Rocky 9 的 MySQL 8 仓库示例：

```bash
sudo dnf install -y mysql-server mysql python3
sudo systemctl enable --now mysqld
```

执行 `mysqld --version`，确认安装的是 MySQL 8.0.16 或以上版本；本系统未适配 MariaDB。发行版仓库不提供 MySQL 8 时，先按该系统的 MySQL 官方安装方法配置软件仓库。

在 MySQL 的 `[mysqld]` 配置中设置 `bind-address=127.0.0.1`；安装了 MySQL X 插件时也设置 `mysqlx-bind-address=127.0.0.1`，重启数据库服务。阿里云安全组仅按访问方式开放 SSH 和 80/443。

复制并编辑建库模板，只在私有副本中填写新的数据库密码：

```bash
sudo install -m 0600 /opt/paper-desk/deploy/mysql-init.sql.example /root/paper-desk-mysql-init.sql
sudoedit /root/paper-desk-mysql-init.sql
sudo mysql -e "SOURCE /root/paper-desk-mysql-init.sql;"
```

该模板创建 `lunwen` 库和仅可从 `127.0.0.1` 登录的 `paperdesk_app` 专用账号，授权仅限此库。需要密码登录数据库管理账号时，改用 `mysql -u root -p` 的交互式登录并执行 `SOURCE /root/paper-desk-mysql-init.sql;`。已有同名账号不会被重置密码。

### 应用连接数据库

默认文件模式无需数据库。直接启动：

```bash
sudo systemctl start paper-desk
sudo systemctl status paper-desk --no-pager
curl -fsS http://127.0.0.1:8080/api/session
```

需要 **MySQL 8.0.16+** 时，启动前在服务器复制模板并编辑：

```bash
sudo install -m 0640 -o root -g paperdesk /opt/paper-desk/config/application.mysql.example.properties /opt/paper-desk/config/application.properties
sudoedit /opt/paper-desk/config/application.properties
```

填写 `db.host`、`db.port`、`db.name`、`db.username`、`db.password`，保留 `app.storage=mysql`。同机部署填写 `127.0.0.1`、`3306`、`lunwen`、`paperdesk_app` 及刚设置的数据库密码。不要直接复制本机连接配置；服务器上的 `127.0.0.1` 指向服务器本身。使用 RDS 时在控制台创建数据库和账号，填写 ECS 可访问的 RDS 内网地址，并配置 RDS 白名单及对应数据库权限。

建议预先建立独立数据库并使用该库的专用账号；程序需要该库的业务读写、建表、索引、外键及 ALTER 权限。启动会自动执行包内 V001–V015 升级脚本。V015 增加加密登录密码副本，V014 增加账号找回邮箱；V013 增加独立跟进事项和处理历史表，旧跟进计划兼容读取，首次编辑时保存为独立事项；V011、V012 增加作者简介和预计发表日期。V006 增加跟进事项与由来，旧记录默认为空；V005 增加稿件文件信息及投稿版本关联；V004 增加客户收款定金约定，旧记录默认 0，保留原服务费用与实际流水。远程数据库优先配置可信 TLS 证书和 `db.sslMode=VERIFY_IDENTITY`；模板中的 PREFERRED 是同机连接示例。独立投稿密钥默认生成在 `/opt/paper-desk/data/database.key`。

然后执行上一段启动命令。连接失败时查看日志；程序不会自动从 MySQL 回退为文件模式。

## 4. 初始化账号、迁移现有数据

**迁移当前 MySQL 的全部账号和业务记录**时，先不要启动应用、注册新账号或打开首次初始化界面。按照 [MySQL 全量迁移与备份](MYSQL-MIGRATION.md) 导出整库及匹配的密钥，在新建的空云端数据库中恢复后再启动。登录账号、密码和各自工作空间会一起保留。

**只迁移一个账号，或原先使用文件存储**时，可以使用下面的界面备份恢复流程。文件存储需要连同所有账号一起迁移时，先停止原服务，再将完整 `data/` 目录复制到服务器并设置所有者为 `paperdesk`，保留 `primary-account.id`、`accounts/` 及各自加密文件；服务器同样选择文件存储。

先在当前本机系统的“数据与设置”下载最新加密备份（MySQL 的最新数据也通过此入口导出，不应使用迁移前遗留的 `papers.vault`）。

下载备份后，先停止自己电脑上占用 8080 的本机系统，再建立 SSH 隧道。将 `YOUR_SERVER_IP` 替换为 ECS 公网 IP；若使用其他 SSH 用户也一并替换：

```bash
ssh -N -L 8080:127.0.0.1:8080 root@YOUR_SERVER_IP
```

打开电脑浏览器 `http://127.0.0.1:8080`，在“注册”中创建服务器的账号和管理密码。需要迁移时，在“数据与设置”选择“从备份恢复”，输入导出时的备份密码。恢复只替换当前云端账号的业务记录，保留服务器刚设置的登录账号和密码；核对客户、论文、投稿与收支后再启用公网入口。整个过程无需开放 8080。隧道两端端口须与程序端口一致，否则 Host/Origin 校验会拒绝请求。

新部署使用空库/空数据目录，导入加密备份即可迁移业务数据；若选择直接迁移整套 MySQL 数据库，则必须同时迁移与该库匹配的原始 `database.key`，不可用新密钥替代。

## 5. 通过域名和 HTTPS 访问

将域名解析到 ECS，准备与该域名匹配的证书及私钥。复制模板：

```bash
sudo cp /opt/paper-desk/deploy/nginx.conf.example /etc/nginx/conf.d/paper-desk.conf
sudoedit /etc/nginx/conf.d/paper-desk.conf
```

将模板中**所有** `paper.example.com` 替换为自己的域名，包括 `map` 中的 HTTPS 来源；修改证书和私钥路径。配置放在 Nginx 的 `http {}` 内，常见 `/etc/nginx/conf.d/*.conf` 即位于该位置。宝塔面板的站点配置若只接受 `server {}`，需将 `map` 放到主配置的 `http {}` 中。

```bash
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

更新已有 Nginx 配置时，请同步模板新增的文件传输 location：普通 JSON 请求保持 12MB 限制，稿件默认单文件 50MB，附件 ZIP 恢复最多 600MB。通过 `https://你的域名` 登录，验证新建、保存、稿件上传下载和备份恢复。启用 SELinux 的系统若 Nginx 返回 502 且审计日志提示禁止连接后端，可执行 `sudo setsebool -P httpd_can_network_connect 1`，再重试。

程序只接受本机 Host 与 Origin。模板会先验证公网 Origin，再转换为后端的本机来源，并为登录 Cookie 加上 Secure；直接转发原始 Host/Origin 会出现 403。请保留来源校验，仅在模板明确配置的 HTTPS 域名提供服务。如修改后端端口，同步修改 systemd 服务的 `APP_PORT` 及 Nginx 的 `proxy_pass`、Host、Origin，执行 `systemctl daemon-reload` 并重启服务。

只供自己远程使用时，第 4 步 SSH 隧道已经可以访问，可不配置 Nginx 和域名。

## 6. 日常维护与更新

```bash
sudo systemctl restart paper-desk
sudo systemctl stop paper-desk
sudo journalctl -u paper-desk -n 100 --no-pager
sudo journalctl -u paper-desk -f
```

保留 `/opt/paper-desk/config/application.properties` 和整个 `/opt/paper-desk/data/`。使用界面定期下载包含历史稿件的加密 ZIP 备份；整库快照或转储须同时保存匹配的 `database.key`、`data/attachments/` 及其中各空间的 `files.key`。配置密码如包含反斜杠，应遵循 Java properties 格式（反斜杠写为 `\\`）。

包内 `tools/backup_mysql.py` 提供整库和密钥的一致备份及校验，定时任务示例为 `deploy/backup.cron.example`；配置步骤见 [MySQL 全量迁移与备份](MYSQL-MIGRATION.md)。

更新前先下载当前加密备份；MySQL 同时备份数据库与密钥。将新包解压到另一目录，执行 `sudo bash install.sh`，随后 `sudo systemctl start paper-desk`。安装器会停止旧服务、更新程序，保留现有配置与数据；数据库升级在服务启动时执行。Nginx 使用 `/etc/nginx/` 中自己的域名配置，不会被安装器改写。修改配置后需重启服务。
