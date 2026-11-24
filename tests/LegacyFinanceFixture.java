import java.nio.file.*;
import java.util.*;

/** An old backup can legitimately contain an amount recorded before write-side limits existed. */
public final class LegacyFinanceFixture {
    public static void main(String[] args) throws Exception {
        Path backup=Path.of(args[0]);Map<String,Object> state=Vault.readBackup(Files.readAllBytes(backup),args[1]);
        for(Object item:Json.array(state.get("papers"))) {
            List<Object> transactions=Json.array(Json.object(item).get("transactions"));
            if(!transactions.isEmpty())Json.object(transactions.get(0)).put("amountCents",2888800);
        }
        Files.write(backup,Vault.encryptedBackup(state,args[1]));
    }
}
