import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Resolves each login to a stable, independent store; never switches another session's identity. */
public final class AccountRegistry {
    private final ApplicationStore primary;
    private final Path data;
    private final Map<String, ApplicationStore> accounts = new HashMap<>();

    public AccountRegistry(ApplicationStore primary, Path data) { this.primary = primary; this.data = data; }
    public String storageType() { return primary.storageType(); }
    public synchronized boolean initialized() { return primary.exists(); }

    public synchronized ApplicationStore setup(String username, String password) throws Exception {
        if (initialized()) throw new ApiException(409, "系统已初始化，请使用注册功能创建新账号，或直接登录");
        return register(username, password);
    }

    public synchronized ApplicationStore register(String username, String password) throws Exception {
        username = Vault.validateUsername(username);
        Vault.validatePassword(password);
        ApplicationStore store;
        if (primary instanceof MysqlStore mysql) {
            store = mysql.registerAccount(username, password);
        } else {
            String id = accountId(username);
            Path directory = data.resolve("accounts").resolve(id);
            Path identity = data.resolve("primary-account.id");
            if (primary.exists()) {
                if (!Files.exists(identity)) {
                    if (primary.username().isEmpty()) throw new ApiException(409, "检测到旧版加密账号，请先用原账号登录一次完成升级，之后即可注册新账号");
                    rememberPrimary();
                }
                if (Files.readString(identity, StandardCharsets.US_ASCII).equals(id) || Files.exists(directory.resolve("papers.vault"))) {
                    throw new ApiException(409, "该账号已被注册，请更换账号或直接登录");
                }
                Files.createDirectories(directory);
                store = new Vault(directory);
                store.setup(username, password);
            } else {
                primary.setup(username, password);
                rememberPrimary();
                store = primary;
            }
        }
        accounts.put(store.username(), store);
        return store;
    }

    public synchronized ApplicationStore login(String username, String password) throws Exception {
        username = username.trim();
        if (username.isEmpty() || username.length() > 64 || password.isEmpty() || password.length() > 128) throw new ApiException(401, "账号或密码不正确");
        ApplicationStore store = accounts.get(username);
        if (store != null) {
            store.unlock(username, password);
        } else if (primary instanceof MysqlStore mysql) {
            store = mysql.loginAccount(username, password);
        } else {
            Path directory = data.resolve("accounts").resolve(accountId(username));
            if (Files.exists(directory.resolve("papers.vault"))) store = new Vault(directory);
            else {
                Path identity = data.resolve("primary-account.id");
                if (!primary.exists() || Files.exists(identity) && !Files.readString(identity, StandardCharsets.US_ASCII).equals(accountId(username))) {
                    throw new ApiException(401, "账号或密码不正确");
                }
                store = primary;
            }
            store.unlock(username, password);
            if (store == primary) rememberPrimary();
        }
        accounts.put(store.username(), store);
        return store;
    }

    public synchronized ApplicationStore changePassword(String username, String current, String next) throws Exception {
        Vault.validatePassword(next);
        ApplicationStore store = login(username, current);
        store.changePassword(current, next);
        return store;
    }

    private void rememberPrimary() throws Exception {
        Files.writeString(data.resolve("primary-account.id"), accountId(primary.username()), StandardCharsets.US_ASCII);
    }

    private static String accountId(String username) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(username.getBytes(StandardCharsets.UTF_8)));
    }
}
