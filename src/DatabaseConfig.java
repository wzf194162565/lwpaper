import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;
import java.util.*;

/** Local properties + environment overrides; credentials never form part of the JDBC URL. */
public final class DatabaseConfig {
    private final Properties values;
    public final Path root;
    public final Path data;
    public final String storage;
    public DatabaseConfig(Path root, Path data) throws IOException {
        this.root = root; this.data = data; values = new Properties();
        Path file = Path.of(System.getProperty("app.config", root.resolve("config/application.properties").toString()));
        if (Files.exists(file)) try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) { values.load(reader); }
        storage = value("app.storage", "APP_STORAGE", "file");
        if (!Set.of("file", "mysql").contains(storage)) throw new IllegalArgumentException("app.storage must be file or mysql");
    }
    public String value(String name, String environment, String fallback) {
        String system = System.getProperty(name), env = System.getenv(environment);
        return system != null ? system : env != null ? env : values.getProperty(name, fallback);
    }
    public String database() {
        String name = value("db.name", "DB_NAME", "lunwen");
        if (!name.matches("[A-Za-z0-9_]{1,64}")) throw new IllegalArgumentException("数据库名只允许 1–64 位字母、数字和下划线");
        return name;
    }
    public Connection connect(boolean database) throws SQLException {
        String host = value("db.host", "DB_HOST", "127.0.0.1");
        if (!host.matches("[A-Za-z0-9._\\-]+")) throw new IllegalArgumentException("数据库主机格式不正确");
        int port = Integer.parseInt(value("db.port", "DB_PORT", "3306"));
        if (port < 1 || port > 65535) throw new IllegalArgumentException("数据库端口范围不正确");
        String ssl = value("db.sslMode", "DB_SSL_MODE", "PREFERRED");
        if (!Set.of("DISABLED", "PREFERRED", "REQUIRED", "VERIFY_CA", "VERIFY_IDENTITY").contains(ssl)) throw new IllegalArgumentException("db.sslMode 不正确");
        Properties properties = new Properties();
        properties.setProperty("user", value("db.username", "DB_USERNAME", ""));
        properties.setProperty("password", value("db.password", "DB_PASSWORD", ""));
        properties.setProperty("characterEncoding", "UTF-8");
        properties.setProperty("connectionTimeZone", "UTC");
        properties.setProperty("forceConnectionTimeZoneToSession", "true");
        properties.setProperty("sslMode", ssl);
        properties.setProperty("allowPublicKeyRetrieval", value("db.allowPublicKeyRetrieval", "DB_ALLOW_PUBLIC_KEY_RETRIEVAL", "false"));
        properties.setProperty("connectTimeout", "5000"); properties.setProperty("socketTimeout", "30000");
        properties.setProperty("allowMultiQueries", "false");
        return DriverManager.getConnection("jdbc:mysql://" + host + ":" + port + "/" + (database ? database() : ""), properties);
    }
    public Path keyFile() { return Path.of(value("db.keyFile", "DB_KEY_FILE", data.resolve("database.key").toString())).toAbsolutePath().normalize(); }
}
