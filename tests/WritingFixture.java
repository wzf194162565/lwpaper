import java.nio.file.*;
import java.util.*;

/** Reproduces a legacy conflicting writing status using only the supplied test backup. */
public class WritingFixture {
    public static void main(String[] args) throws Exception {
        Path backup = Path.of(args[0]);
        Map<String, Object> state = Vault.readBackup(Files.readAllBytes(backup), args[1]);
        for (Object item : Json.array(state.get("papers"))) {
            Map<String, Object> paper = Json.object(item);
            if (!Main.string(paper, "writingDeliveredAt").isEmpty()) paper.put("writingStatus", "写作中");
        }
        Files.write(backup, Vault.encryptedBackup(state, args[1]));
    }
}
