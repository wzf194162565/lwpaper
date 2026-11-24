import java.nio.file.*;
import java.util.*;

/** Produces an encrypted fixture predating service types and customer deposit terms. */
public class LegacyFixture {
    public static void main(String[] args) throws Exception {
        Vault vault = new Vault(Path.of(args[0]));
        vault.setup("test-user", "Test-password-2026");
        PaperService service = new PaperService(vault);
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("title", "旧写作题目"); input.put("writer", "旧写作者"); input.put("customer", "旧客户");
        input.put("status", "已发表"); input.put("journal", "旧期刊"); input.put("submittedAt", "2026-01-01");
        input.put("submissionPassword", "legacy-private-password"); input.put("writerFee", "3000"); input.put("contractAmount", "8000");
        Map<String, Object> paper = service.create(input);
        service.addTransaction(Main.string(paper, "id"), Map.of("version", paper.get("version"), "type", "outgoing_deposit", "amount", "1200", "date", "2026-01-02"));
        vault.mutate(state -> {
            for (Object item : Json.array(state.get("papers"))) {
                Map<String, Object> old = Json.object(item);
                old.remove("serviceType"); old.remove("contractDepositCents");
                old.remove("publicationFees");old.remove("financialAudit");
                for(Object tx:Json.array(old.get("transactions")))for(String key:List.of("actor","publicationAccountId","reversalOf","reversalReason","correctsTransactionId"))Json.object(tx).remove(key);
            }
            if (args.length > 1 && args[1].equals("2")) return null;
            state.put("schema", 1); state.remove("customers");
            for (Object item : Json.array(state.get("papers"))) {
                Map<String, Object> old = Json.object(item);
                for (String field : List.of("submissions", "activeSubmissionId", "customerId", "writingStatus", "writingStartAt", "writingDueAt", "writingDeliveredAt", "writerDepositCents")) old.remove(field);
            }
            return null;
        });
    }
}
