import java.util.*;

/** Append-only financial entries. Reversals correct bookkeeping, not actual cash refunds. */
final class FinancialLedger {
    static long signed(Map<String,Object> tx) {
        return PaperService.number(tx.get("amountCents")) * (Main.string(tx,"reversalOf").isEmpty()?1:-1);
    }
    static String actor(BusinessStore store) { return store instanceof ApplicationStore app?app.username():"系统"; }
    static Map<String,Object> find(Map<String,Object> paper,String id) {
        for(Object item:Json.array(paper.get("transactions")))if(Main.string(Json.object(item),"id").equals(id))return Json.object(item);
        throw new ApiException(404,"这笔收支不存在");
    }
    static boolean reversed(Map<String,Object> paper,String id) {
        return Json.array(paper.get("transactions")).stream().map(Json::object).anyMatch(tx->Main.string(tx,"reversalOf").equals(id));
    }
    static void audit(Map<String,Object> paper,String action,Map<String,Object> tx,String actor,String reason,String fileId) {
        if(!(paper.get("financialAudit") instanceof List<?>))paper.put("financialAudit",new ArrayList<>());
        Map<String,Object> event=new LinkedHashMap<>();
        event.put("id",UUID.randomUUID().toString());event.put("action",action);event.put("actor",actor);event.put("at",PaperService.now());
        for(String key:List.of("type","date","method","note","reversalOf","publicationAccountId","correctsTransactionId","writerId","writerAssignmentId","writerName"))event.put(key,Main.string(tx,key));
        event.put("amountCents",PaperService.number(tx.getOrDefault("amountCents",0)));event.put("transactionId",Main.string(tx,"id"));
        event.put("reason",reason);event.put("fileId",fileId);Json.array(paper.get("financialAudit")).add(event);
        String label=switch(action){case "reverse"->"冲销收支";case "receipt"->"上传收支凭证";case "fee_update"->"调整投稿版面费";case "fee_assign"->"核对历史版面费归属";default->"登记收支";};
        Map<String,Object> history=new LinkedHashMap<>();history.put("id",UUID.randomUUID().toString());history.put("at",event.get("at"));
        String summary=reason.codePointCount(0,reason.length())>120?reason.substring(0,reason.offsetByCodePoints(0,120))+"…":reason;
        history.put("action",label+" · "+actor+(Main.string(tx,"type").isEmpty()?"":" · "+java.math.BigDecimal.valueOf(PaperService.number(event.get("amountCents")),2).toPlainString()+" 元")+(summary.isEmpty()?"":" · "+summary));
        for(String key:List.of("status","journal","submissionSystem","submissionUrl","submittedAt"))history.put(key,paper.getOrDefault(key,""));
        Json.array(paper.get("history")).add(history);
    }
    static void record(Map<String,Object> paper,Map<String,Object> tx,String actor) {
        tx.put("actor",actor);Json.array(paper.get("transactions")).add(tx);audit(paper,"record",tx,actor,"","");
    }
    static void reverse(Map<String,Object> paper,String id,Map<String,Object> input,String actor) {
        Map<String,Object> original=find(paper,id);
        if(!Main.string(original,"reversalOf").isEmpty()||reversed(paper,id))throw new ApiException(409,"该流水已经冲销，不能重复冲销或冲销冲销记录");
        String reason=PaperService.text(input,"reason",1000);
        if(reason.isEmpty()||!Boolean.TRUE.equals(input.get("confirmReversal")))throw new ApiException(400,"请填写冲销原因，并确认这是账务更正而非实际退款");
        if(Json.array(paper.get("transactions")).size()>=1000)throw new ApiException(400,"每篇论文最多记录 1000 笔收支");
        Map<String,Object> reversal=new LinkedHashMap<>(original);reversal.put("id",UUID.randomUUID().toString());
        reversal.put("reversalOf",id);reversal.put("correctsTransactionId","");reversal.put("reversalReason",reason);
        reversal.put("createdAt",PaperService.now());reversal.put("actor",actor);
        Json.array(paper.get("transactions")).add(reversal);
        ServiceTermination.validateLedger(paper);PublicationFees.validateBalances(paper);
        audit(paper,"reverse",reversal,actor,reason,"");
    }
    static void validateStored(Map<String,Object> paper) {
        Set<String> reversed=new HashSet<>();
        for(Object item:Json.array(paper.get("transactions"))) {
            Map<String,Object> tx=Json.object(item);String ref=Main.string(tx,"reversalOf");
            for(String key:List.of("actor","reversalReason","correctsTransactionId","publicationAccountId"))PaperService.text(tx,key,key.equals("reversalReason")?1000:key.equals("actor")?64:36);
            if(!ref.isEmpty()) {
                Map<String,Object> original=find(paper,ref);
                if(!Main.string(original,"reversalOf").isEmpty()||!reversed.add(ref)||Main.string(tx,"reversalReason").isBlank()||
                   !List.of("type","amountCents","date","publicationAccountId","writerId","writerAssignmentId").stream().allMatch(k->Objects.toString(tx.get(k),"").equals(Objects.toString(original.get(k),""))))throw new IllegalArgumentException("Invalid reversal");
            }
            String correction=Main.string(tx,"correctsTransactionId");
            if(!correction.isEmpty()&&(!Main.string(find(paper,correction),"reversalOf").isEmpty()||!reversed(paper,correction)))throw new IllegalArgumentException("Invalid correction reference");
        }
        Set<String> ids=new HashSet<>();
        if(paper.containsKey("financialAudit")&&!(paper.get("financialAudit") instanceof List<?>))throw new IllegalArgumentException();
        for(Object item:audits(paper)) {
            Map<String,Object> audit=Json.object(item);UUID.fromString(Main.string(audit,"id"));java.time.Instant.parse(Main.string(audit,"at"));
            if(!ids.add(Main.string(audit,"id"))||!Set.of("record","reverse","receipt","fee_update","fee_assign").contains(Main.string(audit,"action")))throw new IllegalArgumentException();
            PaperService.text(audit,"actor",64);PaperService.text(audit,"reason",1000);PaperService.text(audit,"note",1000);PaperService.text(audit,"method",80);
            if(!Main.string(audit,"transactionId").isEmpty())find(paper,Main.string(audit,"transactionId"));
        }
    }
    static List<Object> audits(Map<String,Object> paper) { return paper.get("financialAudit") instanceof List<?>?Json.array(paper.get("financialAudit")):List.of(); }
    static void enrich(Map<String,Object> paper,Map<String,Object> result) {
        List<Object> rows=new ArrayList<>();
        for(Object item:Json.array(paper.get("transactions"))) {
            Map<String,Object> tx=new LinkedHashMap<>(Json.object(item));tx.put("signedAmountCents",signed(tx));
            tx.put("reversed",reversed(paper,Main.string(tx,"id")));tx.put("actor",Main.string(tx,"actor").isEmpty()?"历史记录":tx.get("actor"));rows.add(tx);
        }
        result.put("transactions",rows);result.put("financialAudit",audits(paper));
    }
}
