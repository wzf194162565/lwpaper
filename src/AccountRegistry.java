import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Resolves each login to a stable, independent store; never switches another session's identity. */
public final class AccountRegistry {
    private final ApplicationStore primary;
    private final Path data;
    private final Map<String, ApplicationStore> accounts = new HashMap<>();
    private DatabaseCrypto recoveryCrypto;

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

    public synchronized ApplicationStore register(String username,String password,String email) throws Exception {
        email=registrationEmail(email);
        // Check the file recovery key before creating an account, so a missing key cannot strand it.
        if(primary instanceof Vault)recoveryCrypto(true);
        ApplicationStore store=register(username,password);bindRecoveryEmail(store,email);return store;
    }

    static String registrationEmail(String email) {
        String value=SmtpMailer.email(email);
        if(!value.endsWith("@qq.com"))throw new ApiException(400,"注册请使用 QQ 邮箱（以 @qq.com 结尾）");
        return value;
    }

    public synchronized void requireRegistrationAvailable(String username) throws Exception {
        username=Vault.validateUsername(username);
        boolean exists=accounts.containsKey(username);
        if(primary instanceof MysqlStore mysql)exists|=mysql.accountExists(username);
        else {
            String id=accountId(username);Path identity=data.resolve("primary-account.id");
            exists|=Files.exists(data.resolve("accounts").resolve(id).resolve("papers.vault"));
            exists|=Files.exists(identity)&&Files.readString(identity,StandardCharsets.US_ASCII).equals(id);
        }
        if(exists)throw new ApiException(409,"该账号已被注册，请更换账号或直接登录");
    }

    public synchronized ApplicationStore login(String username, String password) throws Exception {
        username = username.trim();
        if (username.isEmpty() || username.length() > 64 || password.isEmpty() || password.length() > 128) throw new ApiException(401, "账号或密码不正确");
        ApplicationStore store = accounts.get(username);
        if (store != null) {
            configureRecovery(store);store.unlock(username, password);
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
            configureRecovery(store);store.unlock(username, password);
            if (store == primary) rememberPrimary();
        }
        accounts.put(store.username(), store);
        return store;
    }

    public synchronized String recoveryEmail(String username) throws Exception {
        if(primary instanceof MysqlStore mysql)return mysql.recoveryEmail(username);
        Vault vault=fileAccount(username);configureRecovery(vault);return vault.recoveryEmail(username);
    }

    public synchronized void bindRecoveryEmail(ApplicationStore store,String email) throws Exception {
        email=SmtpMailer.email(email);
        if(store instanceof MysqlStore mysql)mysql.bindRecoveryEmail(email);
        else { Vault vault=(Vault)store;vault.configureRecovery(recoveryCrypto(true));vault.bindRecoveryEmail(email); }
    }

    public synchronized ApplicationStore resetPassword(String username,String next) throws Exception {
        Vault.validatePassword(next);ApplicationStore store;
        if(primary instanceof MysqlStore mysql)store=mysql.resetAccountPassword(username,next);
        else {
            Vault vault=fileAccount(username);configureRecovery(vault);vault.resetPassword(username,next);store=vault;
        }
        accounts.put(username,store);return store;
    }

    private Vault fileAccount(String username) throws Exception {
        ApplicationStore cached=accounts.get(username);if(cached instanceof Vault vault)return vault;
        String id=accountId(username);Path directory=data.resolve("accounts").resolve(id);
        if(Files.exists(directory.resolve("papers.vault")))return new Vault(directory);
        Path identity=data.resolve("primary-account.id");
        if(primary.exists()&&Files.exists(identity)&&Files.readString(identity,StandardCharsets.US_ASCII).equals(id))return (Vault)primary;
        throw new ApiException(404,"账号不存在或尚未绑定邮箱");
    }

    private void configureRecovery(ApplicationStore store) throws Exception {
        if(store instanceof Vault vault&&Files.exists(vault.recoveryFile()))vault.configureRecovery(recoveryCrypto(false));
    }

    private DatabaseCrypto recoveryCrypto(boolean allowCreate) throws Exception {
        if(recoveryCrypto!=null)return recoveryCrypto;
        boolean existing=Files.exists(data.resolve("account-recovery.json"));
        Path folders=data.resolve("accounts");
        if(!existing&&Files.isDirectory(folders))try(var directories=Files.list(folders)){existing=directories.anyMatch(path->Files.exists(path.resolve("account-recovery.json")));}
        recoveryCrypto=new DatabaseCrypto(data.resolve("recovery.key"),allowCreate&&!existing);return recoveryCrypto;
    }

    private void rememberPrimary() throws Exception {
        Files.writeString(data.resolve("primary-account.id"), accountId(primary.username()), StandardCharsets.US_ASCII);
    }

    private static String accountId(String username) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(username.getBytes(StandardCharsets.UTF_8)));
    }
}
