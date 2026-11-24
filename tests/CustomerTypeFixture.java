import java.nio.file.*;
import java.util.*;

/** Removes classification fields from a supplied test backup to reproduce pre-V007 data. */
public class CustomerTypeFixture {
    public static void main(String[] args) throws Exception {
        Path backup = Path.of(args[0]);
        Map<String, Object> state = Vault.readBackup(Files.readAllBytes(backup), args[1]);
        for (Object item : Json.array(state.get("customers"))) {
            Map<String, Object> customer = Json.object(item);
            customer.remove("customerType");
            customer.remove("referrer");
        }
        Files.write(backup, Vault.encryptedBackup(state, args[1]));
    }
}
