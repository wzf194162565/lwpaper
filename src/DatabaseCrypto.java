import javax.crypto.*;
import javax.crypto.spec.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;

/** Login password hashing and independently keyed, record-bound submission credential encryption. */
public final class DatabaseCrypto {
    private static final SecureRandom RANDOM = new SecureRandom();
    private final SecretKey key;
    public DatabaseCrypto(Path file, boolean allowCreate) throws Exception {
        if (!Files.exists(file)) {
            if (!allowCreate) throw new IllegalStateException("数据库加密密钥文件缺失，请从备份恢复 database.key，不能使用新密钥替换");
            Files.createDirectories(file.getParent());
            Files.write(file, Base64.getEncoder().encode(random(32)), StandardOpenOption.CREATE_NEW);
        }
        byte[] bytes = Base64.getDecoder().decode(Files.readString(file).trim());
        if (bytes.length != 32) throw new IllegalStateException("数据库加密密钥文件格式不正确");
        key = new SecretKeySpec(bytes, "AES");
    }
    public String fingerprint() throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(key.getEncoded())); }
    public String encrypt(String id, String text) throws Exception {
        if (text.isEmpty()) return "";
        byte[] iv = random(12); Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv)); cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));
        byte[] encrypted = cipher.doFinal(text.getBytes(StandardCharsets.UTF_8)), output = new byte[iv.length + encrypted.length];
        System.arraycopy(iv, 0, output, 0, iv.length); System.arraycopy(encrypted, 0, output, iv.length, encrypted.length);
        return Base64.getEncoder().encodeToString(output);
    }
    public String decrypt(String id, String text) throws Exception {
        if (text.isEmpty()) return "";
        byte[] bytes = Base64.getDecoder().decode(text); if (bytes.length < 28) throw new GeneralSecurityException("Invalid credential ciphertext");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Arrays.copyOf(bytes, 12))); cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(bytes, 12, bytes.length - 12), StandardCharsets.UTF_8);
    }
    public static String hashPassword(String password) throws Exception {
        byte[] salt = random(16);
        return "pbkdf2_sha256$310000$" + Base64.getEncoder().encodeToString(salt) + "$" + Base64.getEncoder().encodeToString(derive(password, salt, 310000));
    }
    public static boolean verifyPassword(String password, String encoded) throws Exception {
        if (password.length() > 128) return false;
        String[] parts = encoded.split("\\$");
        if (parts.length != 4 || !parts[0].equals("pbkdf2_sha256")) throw new GeneralSecurityException("Unsupported password hash");
        int rounds = Integer.parseInt(parts[1]); if (rounds < 100000 || rounds > 2_000_000) throw new GeneralSecurityException("Invalid password hash work factor");
        return MessageDigest.isEqual(derive(password, Base64.getDecoder().decode(parts[2]), rounds), Base64.getDecoder().decode(parts[3]));
    }
    private static byte[] derive(String password, byte[] salt, int rounds) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, rounds, 256);
        try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); } finally { spec.clearPassword(); }
    }
    private static byte[] random(int length) { byte[] output = new byte[length]; RANDOM.nextBytes(output); return output; }
}
