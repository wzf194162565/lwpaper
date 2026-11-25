import java.nio.file.*;
import java.util.*;

/** Builds a pre-V006 portable backup for compatibility tests, only using supplied test data. */
public class FollowUpFixture {
    public static void main(String[] args) throws Exception {
        Path backup=Path.of(args[0]);
        Map<String,Object> state=Vault.readBackup(Files.readAllBytes(backup),args[1]);
        for(Object item:Json.array(state.get("papers"))){
            Map<String,Object> paper=Json.object(item);
            paper.remove("followUpReason");paper.remove("followUps");paper.remove("followUpHistory");
        }
        Files.write(backup,Vault.encryptedBackup(state,args[1]));
    }
}
