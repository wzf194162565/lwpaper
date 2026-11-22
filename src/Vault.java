import javax.crypto.*;
import javax.crypto.spec.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.function.Function;

/** AES-256-GCM authenticated encrypted store with atomic replacement. */
public final class Vault implements ApplicationStore {
    private static final byte[] MAGIC = "PAPERDESK1".getBytes(StandardCharsets.US_ASCII);
    private static final int ROUNDS = 310_000;
    private static final SecureRandom RANDOM = new SecureRandom();
    private final Path file;
    private byte[] salt;
    private SecretKey key;
    private Map<String, Object> state;
    public Vault(Path directory) { this.file = directory.resolve("papers.vault"); }
    public synchronized boolean exists() { return Files.exists(file); }
    public synchronized void setup(String username, String password) throws Exception {
        if (exists()) throw new ApiException(409, "系统已初始化，请登录");
        username = validateUsername(username);
        validatePassword(password);
        byte[] newSalt = random(16); SecretKey newKey = derive(password, newSalt);
        Map<String, Object> initial = new LinkedHashMap<>();
        initial.put("schema", 2); initial.put("username", username); initial.put("papers", new ArrayList<>()); initial.put("customers", new ArrayList<>());
        persist(initial, newKey, newSalt);
        key = newKey; salt = newSalt; state = initial;
    }
    public synchronized void unlock(String username, String password) throws Exception {
        if (!exists()) throw new ApiException(409, "请先设置管理密码");
        username = username.trim();
        if (username.isEmpty() || username.length() > 64 || password.length() > 128 || password.isEmpty()) throw new ApiException(401, "账号或密码不正确");
        byte[] encoded = Files.readAllBytes(file), savedSalt = extractSalt(encoded);
        SecretKey savedKey = derive(password, savedSalt);
        Map<String, Object> loaded;
        try { loaded = decode(encoded, savedKey); }
        catch (GeneralSecurityException e) { throw new ApiException(401, "账号或密码不正确，或数据文件已损坏"); }
        String savedUsername = Main.string(loaded, "username");
        if (!savedUsername.isEmpty() && !savedUsername.equals(username)) throw new ApiException(401, "账号或密码不正确");
        boolean migrated = BusinessService.migrate(loaded);
        validateState(loaded);
        if (savedUsername.isEmpty()) {
            // Legacy password-only stores can bind an account after the original password is verified.
            loaded.put("username", validateUsername(username));
        }
        if (migrated || savedUsername.isEmpty()) persist(loaded, savedKey, savedSalt);
        key = savedKey; salt = savedSalt; state = loaded;
    }
    public synchronized String username() { return state == null ? "" : Main.string(state, "username"); }
    public String storageType() { return "file"; }
    public synchronized Map<String, Object> read() {
        if (state == null) throw new ApiException(401, "请先登录");
        return copy(state);
    }
    public synchronized <T> T mutate(Function<Map<String, Object>, T> action) throws Exception {
        Map<String, Object> next = read(); T result = action.apply(next);
        persist(next, key, salt); state = next; return result;
    }
    public synchronized byte[] backup() throws Exception { return Files.readAllBytes(file); }
    public synchronized void restore(byte[] encoded, String password) throws Exception {
        if (encoded.length > 8 * 1024 * 1024 || password.length() > 128) throw new ApiException(400, "备份文件过大或密码格式不正确");
        byte[] savedSalt = extractSalt(encoded);
        Map<String, Object> loaded;
        try { loaded = decode(encoded, derive(password, savedSalt)); }
        catch (GeneralSecurityException | IllegalArgumentException e) { throw new ApiException(400, "无法读取备份，请检查备份密码和文件完整性"); }
        BusinessService.migrate(loaded);
        validateState(loaded);
        // Restore business data while keeping this installation's login account and password.
        loaded.put("username", Main.string(state, "username"));
        persist(loaded, key, salt); state = loaded;
    }
    public synchronized void changePassword(String current, String next) throws Exception {
        validatePassword(next);
        if (current.length() > 128) throw new ApiException(401, "当前密码不正确");
        try { decode(Files.readAllBytes(file), derive(current, salt)); }
        catch (GeneralSecurityException e) { throw new ApiException(401, "当前密码不正确"); }
        byte[] newSalt = random(16); SecretKey newKey = derive(next, newSalt);
        persist(state, newKey, newSalt); key = newKey; salt = newSalt;
    }
    private void persist(Map<String, Object> next, SecretKey nextKey, byte[] nextSalt) throws Exception {
        byte[] bytes = encode(next, nextKey, nextSalt);
        if (bytes.length > 8 * 1024 * 1024) throw new ApiException(400, "数据已达到本机版容量上限（8MB），请先导出归档");
        Path temporary = file.resolveSibling("papers.vault.tmp");
        try {
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            if (Files.exists(file)) Files.copy(file, file.resolveSibling("papers.vault.bak"), StandardCopyOption.REPLACE_EXISTING);
            try { Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
            catch (AtomicMoveNotSupportedException e) { Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING); }
        } finally { Files.deleteIfExists(temporary); }
    }
    private static byte[] encode(Map<String, Object> data, SecretKey key, byte[] salt) throws Exception {
        byte[] iv = random(12);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv)); cipher.updateAAD(MAGIC);
        byte[] encrypted = cipher.doFinal(Json.write(data).getBytes(StandardCharsets.UTF_8));
        return ByteBuffer.allocate(MAGIC.length + 16 + 12 + encrypted.length).put(MAGIC).put(salt).put(iv).put(encrypted).array();
    }
    private static byte[] extractSalt(byte[] bytes) {
        if (bytes.length < MAGIC.length + 16 + 12 + 16 || !Arrays.equals(MAGIC, Arrays.copyOf(bytes, MAGIC.length))) throw new ApiException(400, "不是有效的 Paper Desk 加密数据文件");
        return Arrays.copyOfRange(bytes, MAGIC.length, MAGIC.length + 16);
    }
    private static Map<String, Object> decode(byte[] bytes, SecretKey key) throws Exception {
        extractSalt(bytes); int start = MAGIC.length + 16;
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Arrays.copyOfRange(bytes, start, start + 12))); cipher.updateAAD(MAGIC);
        return Json.object(Json.parse(new String(cipher.doFinal(bytes, start + 12, bytes.length - start - 12), StandardCharsets.UTF_8)));
    }
    private static SecretKey derive(String password, byte[] salt) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ROUNDS, 256);
        try { return new SecretKeySpec(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(), "AES"); }
        finally { spec.clearPassword(); }
    }
    static void validateState(Map<String, Object> data) {
        try {
            if (!Objects.toString(data.get("schema"), "").equals("2")) throw new IllegalArgumentException();
            if (data.containsKey("username")) validateUsername(Main.string(data, "username"));
            List<Object> list = Json.array(data.get("papers"));
            if (list.size() > 10_000) throw new IllegalArgumentException();
            Set<String> ids = new HashSet<>();
            for (Object item : list) {
                Map<String, Object> paper = Json.object(item); PaperService.validateStored(paper);
                if (!ids.add(Main.string(paper, "id"))) throw new IllegalArgumentException();
            }
            BusinessService.validateState(data);
        } catch (IllegalArgumentException | ApiException e) { throw new ApiException(400, "数据文件结构无效，无法导入"); }
    }
    static String validateUsername(String username) {
        String value = username.trim();
        if (!value.matches("[A-Za-z0-9][A-Za-z0-9_.@+\\-]{2,63}")) throw new ApiException(400, "登录账号需要 3–64 个字符，可使用字母、数字、下划线、点、@、加号和减号");
        return value;
    }
    static void validatePassword(String password) {
        if (password.length() < 10 || password.length() > 128 || password.isBlank()) throw new ApiException(400, "管理密码需要 10–128 个字符");
    }
    private static Map<String, Object> copy(Map<String, Object> data) { return Json.object(Json.parse(Json.write(data))); }
    private static byte[] random(int length) { byte[] bytes = new byte[length]; RANDOM.nextBytes(bytes); return bytes; }
    public static String token() { return Base64.getUrlEncoder().withoutPadding().encodeToString(random(32)); }

    static byte[] encryptedBackup(Map<String, Object> data, String password) throws Exception {
        byte[] salt = random(16);
        return encode(data, derive(password, salt), salt);
    }
    static final class BackupCipher {
        private final byte[] salt;
        private final SecretKey key;
        BackupCipher(String password) throws Exception { salt = random(16); key = derive(password, salt); }
        byte[] encrypt(Map<String, Object> data) throws Exception { return encode(data, key, salt); }
    }
    static Map<String, Object> readBackup(byte[] data, String password) throws Exception {
        try {
            Map<String, Object> result = decode(data, derive(password, extractSalt(data)));
            BusinessService.migrate(result); validateState(result); return result;
        } catch (GeneralSecurityException | IllegalArgumentException e) { throw new ApiException(400, "备份密码不正确，或备份文件已损坏"); }
    }
}
