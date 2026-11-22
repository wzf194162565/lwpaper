# MySQL JDBC 驱动

默认文件存储模式无需第三方依赖。使用 MySQL 或构建云端部署包时，请将 MySQL Connector/J 驱动 JAR 放在本目录；第三方 JAR 不提交到 Git 仓库。

当前验证使用的版本为 **9.5.0**，运行环境为 Java 17+，数据库为 MySQL 8.0.16+。

可从 [Maven Central 下载 mysql-connector-j-9.5.0.jar](https://repo.maven.apache.org/maven2/com/mysql/mysql-connector-j/9.5.0/mysql-connector-j-9.5.0.jar)，保存为：

```text
lib/mysql-connector-j-9.5.0.jar
```

构建部署包时，本目录应只放一个 `mysql-connector-j-*.jar`，以便打包脚本确定使用的驱动。
