/** Application identity, encrypted backup and business storage contract. */
public interface ApplicationStore extends BusinessStore {
    boolean exists();
    void setup(String username, String password) throws Exception;
    void unlock(String username, String password) throws Exception;
    String username();
    void changePassword(String current, String next) throws Exception;
    byte[] backup() throws Exception;
    void restore(byte[] encoded, String password) throws Exception;
    String storageType();
    java.nio.file.Path attachmentDirectory();
    byte[] encodeBackup(java.util.Map<String, Object> state) throws Exception;
    void restoreState(java.util.Map<String, Object> state) throws Exception;
}
