import java.math.BigDecimal;
import java.net.URI;
import java.time.*;
import java.time.format.DateTimeParseException;
import java.util.*;

/** Validated paper records, submission history and exact-cent bookkeeping. */
public final class PaperService {
    private final BusinessStore vault;
    static final Set<String> STATUSES = Set.of("草稿", "待投稿", "已投稿", "审稿中", "修改中", "已录用", "已发表", "已拒稿", "已撤稿");
    static final Set<String> TYPES = Set.of("incoming_deposit", "incoming_balance", "incoming_other", "outgoing_deposit", "outgoing_balance", "outgoing_other", "incoming_settlement", "outgoing_refund", "outgoing_settlement", "incoming_writer_refund", "outgoing_publication", "incoming_publication_refund");
    private static final List<String> FIELDS = List.of("title", "authors", "authorBio", "customer", "writer", "journal", "submissionSystem", "submissionUrl", "submissionAccount", "boundEmail", "boundPhone", "submittedAt", "followUpAt", "followUpReason", "status", "notes");
    public PaperService(BusinessStore vault) { this.vault = vault; }

    private void ensureCodes() {
        if(!PaperCodes.needed(vault.read())&&!WriterService.needsSync(vault.read()))return;
        try { vault.mutate(state->{PaperCodes.migrate(state);WriterService.sync(state);return null;}); }
        catch(RuntimeException e){throw e;}catch(Exception e){throw new IllegalStateException("论文编号更新失败",e);}
    }
    public List<Object> list() {
        ensureCodes();
        Map<String, Object> state = vault.read();
        List<Object> result = new ArrayList<>();
        for (Object item : Json.array(state.get("papers"))) result.add(publicPaper(Json.object(item), false, state));
        result.sort(Comparator.comparing((Object o) -> Main.string(Json.object(o), "updatedAt")).reversed());
        return result;
    }
    public Map<String, Object> get(String id) { ensureCodes(); Map<String, Object> state = vault.read(); return publicPaper(find(state, id), true, state); }
    public Map<String, Object> credentials(String id) { return Map.of("password", Main.string(find(vault.read(), id), "submissionPassword")); }

    public Map<String, Object> create(Map<String, Object> input) throws Exception {
        return vault.mutate(state -> {
            PaperCodes.migrate(state);
            List<Object> records = Json.array(state.get("papers"));
            if (records.size() >= 10_000) throw new ApiException(400, "本机版最多保存 10000 篇论文");
            Map<String, Object> paper = fields(input, null);
            validateFollowUp(paper, null, input);
            String id = text(input, "createRequestId", 36);
            if (id.isEmpty()) id = UUID.randomUUID().toString();
            else {
                try { if (!UUID.fromString(id).toString().equals(id)) throw new IllegalArgumentException(); }
                catch (IllegalArgumentException e) { throw new ApiException(400, "新增请求标识不正确，请重新打开表单"); }
                for (Object item : records) if (Main.string(Json.object(item), "id").equals(id))
                    throw new ApiException(409, "这篇论文已保存，请刷新列表核对，避免重复登记付款");
            }
            paper.put("id", id);
            paper.put("code", "");
            paper.put("version", 1); paper.put("createdAt", now()); paper.put("updatedAt", now());
            paper.put("transactions", new ArrayList<>());
            paper.put("history", new ArrayList<>(List.of(event(paper, "建立论文档案"))));
            BusinessService.initializePaper(state, paper, input);
            WriterService.sync(state);WriterService.resolve(state,paper,input);WriterAssignments.initialize(paper);
            paper.put("code",PaperCodes.next(state,paper));
            PublicationFees.initialize(paper);WriterPayments.apply(paper, input,FinancialLedger.actor(vault));CustomerReceipts.apply(paper,input,FinancialLedger.actor(vault));
            FollowUps.initialize(paper);
            records.add(paper);
            WriterService.sync(state);
            return publicPaper(paper, true, state);
        });
    }

    public Map<String, Object> update(String id, Map<String, Object> input) throws Exception {
        return vault.mutate(state -> {
            WriterService.sync(state);
            Map<String, Object> paper = find(state, id); checkVersion(paper, input);
            ServiceTermination.requireActive(paper);
            FollowUps.initialize(paper);
            String oldFollowUpDate=Main.string(paper,"followUpAt"),oldFollowUpReason=Main.string(paper,"followUpReason");
            Map<String, Object> originalTerms = new LinkedHashMap<>(paper);
            Map<String, Object> nextFields = fields(input, paper);
            if((input.containsKey("writerId")&&!Main.string(input,"writerId").equals(Main.string(paper,"writerId")))||(input.containsKey("writer")&&!Main.string(input,"writer").equals(Main.string(paper,"writer"))))throw new ApiException(409,"更换写作者请使用更换写作者，保留原安排和结算历史");
            WriterPayments.validateTerms(paper, nextFields);
            if(!input.containsKey("customerReceiptTotals"))FinancialRules.validateCustomerTerms(paper,nextFields);
            validateFollowUp(nextFields, paper, input);
            boolean journalChanged=!Main.string(paper,"journal").equals(Main.string(nextFields,"journal"));
            if(journalChanged){PublicationFees.initialize(paper);Map<String,Object> account=PublicationFees.current(paper);if(account!=null&&PublicationFees.hasTransactions(paper,Main.string(account,"id")))throw new ApiException(409,"当前投稿已有版面费流水，更换期刊请使用改投");}
            if(journalChanged&&!PublicationFees.hasTerms(input)) {
                nextFields.put("publicationFeeMode","pending");nextFields.put("publicationFeeCents",0L);
            }
            boolean changed = List.of("status", "journal", "submissionSystem", "submissionUrl", "submittedAt").stream().anyMatch(k -> !Objects.equals(paper.get(k), nextFields.get(k)));
            boolean followUpChanged = !Main.string(paper,"followUpAt").equals(Main.string(nextFields,"followUpAt")) || !Main.string(paper,"followUpReason").equals(Main.string(nextFields,"followUpReason"));
            PublicationFees.recordChange(paper,nextFields);
            paper.putAll(nextFields); FollowUps.legacyUpdate(paper,oldFollowUpDate,oldFollowUpReason); touch(paper);
            BusinessService.updatePaper(state, paper, input);
            WriterService.sync(state);
            WriterAssignments.refresh(paper);
            if(PublicationFees.hasTerms(input)||journalChanged)PublicationFees.updateCurrent(paper,Map.of("publicationFeeMode",nextFields.get("publicationFeeMode"),"publicationFeeAmount",BigDecimal.valueOf(number(nextFields.get("publicationFeeCents")),2).toPlainString()));
            if(PublicationFees.hasTerms(input)||journalChanged)FinancialLedger.audit(paper,"fee_update",Map.of("publicationAccountId",PublicationFees.current(paper).get("id")),FinancialLedger.actor(vault),"论文表单更新费用："+PublicationFees.descriptionAccount(PublicationFees.current(paper)),"");
            WriterPayments.apply(paper, input,FinancialLedger.actor(vault));CustomerReceipts.apply(paper,input,FinancialLedger.actor(vault));
            if(input.containsKey("customerReceiptTotals")) {
                originalTerms.put("transactions",paper.get("transactions"));
                FinancialRules.validateCustomerTerms(originalTerms,paper);
            }
            if (changed) Json.array(paper.get("history")).add(event(paper, "更新投稿进度"));
            if (followUpChanged) {
                String date=Main.string(paper,"followUpAt"),reason=Main.string(paper,"followUpReason");
                String summary=reason.codePointCount(0,reason.length())>120?reason.substring(0,reason.offsetByCodePoints(0,120))+"…":reason;
                Json.array(paper.get("history")).add(event(paper, (date.isEmpty()?"更新跟进事项":"安排跟进："+date) + (summary.isEmpty()?"":" · "+summary)));
            }
            return publicPaper(paper, true, state);
        });
    }

    public Map<String,Object> saveFollowUp(String id,String taskId,Map<String,Object> input) throws Exception {
        return vault.mutate(state -> {
            Map<String,Object> paper=find(state,id);checkVersion(paper,input);
            FollowUps.save(paper,taskId,input);touch(paper);
            return publicPaper(paper,true,state);
        });
    }

    public void delete(String id, Map<String, Object> input) throws Exception {
        vault.mutate(state -> {
            Map<String, Object> paper = find(state, id); checkVersion(paper, input);
            Json.array(state.get("papers")).remove(paper); return null;
        });
    }

    public Map<String,Object> terminate(String id,Map<String,Object> input,boolean revision) throws Exception {
        return vault.mutate(state -> {
            WriterService.sync(state);
            Map<String,Object> paper=find(state,id);checkVersion(paper,input);
            ServiceTermination.close(paper,input,revision);
            return publicPaper(paper,true,state);
        });
    }

    public Map<String,Object> publicationFee(String id,Map<String,Object> input) throws Exception {
        return vault.mutate(state -> {
            Map<String,Object> paper=find(state,id);checkVersion(paper,input);
            PublicationFees.update(paper,input,FinancialLedger.actor(vault));touch(paper);
            return publicPaper(paper,true,state);
        });
    }

    public Map<String, Object> addTransaction(String id, Map<String, Object> input) throws Exception {
        return vault.mutate(state -> {
            WriterService.sync(state);
            Map<String, Object> paper = find(state, id); checkVersion(paper, input);
            List<Object> transactions = Json.array(paper.get("transactions"));
            Map<String, Object> tx = transaction(paper, input);
            WriterAssignments.bind(paper,input,tx);
            ServiceTermination.validateTransaction(paper,input,tx);
            if(!WriterAssignments.TYPES.contains(Main.string(tx,"type"))||WriterAssignments.current(paper)==null)FinancialRules.validateTransaction(paper,tx);
            PublicationFees.validateTransaction(paper,input,tx);
            if (input.containsKey("confirmWriterPayment") && !Boolean.TRUE.equals(input.get("confirmWriterPayment"))) throw new ApiException(400, "请确认本次金额已实际支付");
            if (Boolean.TRUE.equals(input.get("confirmWriterPayment"))&&WriterAssignments.current(paper)==null) WriterPayments.validatePayment(paper, tx);
            String correction=text(input,"correctsTransactionId",36);
            if(!correction.isEmpty()&&WriterAssignments.TYPES.contains(Main.string(tx,"type"))&&!Main.string(FinancialLedger.find(paper,correction),"writerAssignmentId").equals(Main.string(tx,"writerAssignmentId")))throw new ApiException(400,"重记流水必须保留原写作安排归属");
            if(!correction.isEmpty()){Map<String,Object> original=FinancialLedger.find(paper,correction);if(!Main.string(original,"reversalOf").isEmpty()||!FinancialLedger.reversed(paper,correction))throw new ApiException(400,"请先冲销原始流水，再重新登记");tx.put("correctsTransactionId",correction);}
            FinancialLedger.record(paper,tx,FinancialLedger.actor(vault));touch(paper);return publicPaper(paper,true,state);
        });
    }

    public Map<String,Object> reassignWriter(String id,Map<String,Object> input) throws Exception {
        return vault.mutate(state->{
            WriterService.sync(state);Map<String,Object>p=find(state,id);checkVersion(p,input);ServiceTermination.requireActive(p);
            if(!BusinessService.hasWriting(p))throw new ApiException(400,"半包论文没有写作安排");
            String reason=text(input,"reason",1000),writerId=text(input,"writerId",36);
            if(reason.isBlank()||writerId.isEmpty())throw new ApiException(400,"请选择新写作者并填写更换原因");
            if(writerId.equals(Main.string(p,"writerId")))throw new ApiException(400,"请选择不同的写作者");
            Map<String,Object>w=WriterService.find(state,writerId);if(!Main.string(w,"status").equals("active"))throw new ApiException(400,"请选择合作中的写作者");
            if(!input.containsKey("previousSettlement")||!input.containsKey("writerFee")||!input.containsKey("writerDepositAmount"))throw new ApiException(400,"请明确填写原写作者结算金额、新稿酬和定金");
            long settlement=money(input,"previousSettlement");if(settlement>number(p.get("writerFeeCents")))throw new ApiException(400,"原写作者结算不能超过原约定稿酬");
            Map<String,Object>a=WriterAssignments.current(p);a.put("finalCents",settlement);a.put("closedAt",now());a.put("reason",reason);
            Map<String,Object>nextInput=new LinkedHashMap<>();
            for(String key:List.of("writerFee","writerDepositAmount","writingStartAt","writingDueAt"))if(input.containsKey(key))nextInput.put(key,input.get(key));
            nextInput.put("writer",w.get("name"));nextInput.put("writingDeliveredAt","");nextInput.put("writingStatus","写作中");
            nextInput.putIfAbsent("writingStartAt",java.time.LocalDate.now().toString());nextInput.putIfAbsent("writingDueAt","");
            p.putAll(fields(nextInput,p));p.put("writerId",writerId);WriterAssignments.add(p);touch(p);
            Json.array(p.get("history")).add(event(p,"更换写作者："+Main.string(a,"writer")+" → "+Main.string(w,"name")+" · "+reason));
            return publicPaper(p,true,state);
        });
    }

    static Map<String, Object> transaction(Map<String, Object> paper, Map<String, Object> input) {
            if (Json.array(paper.get("transactions")).size() >= 1000) throw new ApiException(400, "每篇论文最多记录 1000 笔收支");
            String type = text(input, "type", 40);
            if (!TYPES.contains(type)) throw new ApiException(400, "收支类型不正确");
            if (!BusinessService.hasWriting(paper) && Set.of("outgoing_deposit", "outgoing_balance").contains(type)) throw new ApiException(400, "半包论文没有写作稿酬，投稿等费用请登记为其他支出");
            long cents = money(input, "amount");
            if (cents <= 0) throw new ApiException(400, "收支金额必须大于 0");
            String date = date(input, "date");
            if (date.isEmpty()) throw new ApiException(400, "请选择收支日期");
            if (LocalDate.parse(date).isAfter(LocalDate.now())) throw new ApiException(400, "收支日期不能晚于今天");
            Map<String, Object> tx = new LinkedHashMap<>();
            tx.put("id", UUID.randomUUID().toString()); tx.put("type", type); tx.put("amountCents", cents); tx.put("date", date);
            tx.put("method", text(input, "method", 80)); tx.put("note", text(input, "note", 1000)); tx.put("createdAt", now());
            return tx;
    }

    public Map<String, Object> deleteTransaction(String id, String transactionId, Map<String, Object> input) throws Exception {
        throw new ApiException(405,"收支流水不能直接删除，请填写原因后冲销，并按实际情况重新登记");
    }

    public Map<String,Object> reverseTransaction(String id,String transactionId,Map<String,Object> input) throws Exception {
        return vault.mutate(state -> {
            WriterService.sync(state);
            Map<String, Object> paper = find(state, id); checkVersion(paper, input);
            PublicationFees.initialize(paper);FinancialLedger.reverse(paper,transactionId,input,FinancialLedger.actor(vault));
            touch(paper); return publicPaper(paper, true, state);
        });
    }

    private static Map<String, Object> fields(Map<String, Object> input, Map<String, Object> previous) {
        Map<String, Object> values = new LinkedHashMap<>();
        if (previous != null) values.putAll(previous); values.putAll(input);
        values.putIfAbsent("status", "待投稿");
        Map<String, Object> result = new LinkedHashMap<>();
        for (String field : FIELDS) result.put(field, field.endsWith("At") ? date(values, field) : text(values, field, field.equals("notes") ? 5000 : field.equals("authorBio") ? 2000 : field.equals("followUpReason") ? 1000 : field.equals("title") ? 300 : 200));
        if (Main.string(result, "title").isEmpty()) throw new ApiException(400, "请填写论文题目");
        if (!STATUSES.contains(Main.string(result, "status"))) throw new ApiException(400, "请选择有效的投稿状态");
        String email = Main.string(result, "boundEmail");
        if (!email.isEmpty() && !email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) throw new ApiException(400, "绑定邮箱格式不正确");
        String url = Main.string(result, "submissionUrl");
        if (!url.isEmpty()) {
            try {
                URI uri = URI.create(url);
                if (!Set.of("https", "http").contains(Objects.toString(uri.getScheme(), "")) || uri.getHost() == null || uri.getUserInfo() != null) throw new IllegalArgumentException();
            } catch (IllegalArgumentException e) { throw new ApiException(400, "投稿网址需要以 http:// 或 https:// 开头"); }
        }
        String submittedAt = Main.string(result, "submittedAt");
        if (!submittedAt.isEmpty() && LocalDate.parse(submittedAt).isAfter(LocalDate.now())) throw new ApiException(400, "投稿日期不能晚于今天；计划日期可填在跟进日期中");
        result.put("contractCents", input.containsKey("contractAmount") ? money(input, "contractAmount") : previous == null ? 0L : number(previous.get("contractCents")));
        long contractDeposit = input.containsKey("contractDepositAmount") ? money(input, "contractDepositAmount") : previous == null ? 0L : number(previous.getOrDefault("contractDepositCents", 0));
        if (contractDeposit < 0 || contractDeposit > number(result.get("contractCents"))) throw new ApiException(400, "约定收款定金不能超过服务费用");
        result.put("contractDepositCents", contractDeposit);
        result.put("writerFeeCents", input.containsKey("writerFee") ? money(input, "writerFee") : previous == null ? 0L : number(previous.get("writerFeeCents")));
        BusinessService.applyWriting(input, values, result);
        PublicationFees.applyTerms(input,previous==null?Map.of():previous,result);
        if (input.containsKey("submissionPassword")) {
            if (!(input.get("submissionPassword") instanceof String password) || password.length() > 500) throw new ApiException(400, "投稿密码最多 500 个字符");
            result.put("submissionPassword", input.get("submissionPassword"));
        } else result.put("submissionPassword", previous == null ? "" : previous.get("submissionPassword"));
        return result;
    }

    private static void validateFollowUp(Map<String,Object> next,Map<String,Object> previous,Map<String,Object> input) {
        if(Main.string(next,"followUpAt").isEmpty()||!Main.string(next,"followUpReason").isEmpty())return;
        // Old records with only a date remain readable and unrelated partial updates stay compatible.
        if(previous==null||input.containsKey("followUpReason")||!Main.string(previous,"followUpAt").equals(Main.string(next,"followUpAt")))
            throw new ApiException(400,"请填写跟进事项，说明为什么跟进以及需要处理什么");
    }

    static Map<String, Object> publicPaper(Map<String, Object> paper, boolean detail, Map<String, Object> state) {
        Map<String, Object> result = new LinkedHashMap<>(paper);
        result.put("followUpReason",Main.string(paper,"followUpReason"));
        result.put("authorBio",Main.string(paper,"authorBio"));
        result.put("followUps",new ArrayList<>(FollowUps.tasks(paper)));
        if(!detail)result.remove("followUpHistory");
        result.remove("submissionPassword"); result.put("hasPassword", !Main.string(paper, "submissionPassword").isEmpty());
        result.put("files", new ArrayList<>(AttachmentService.files(paper)));
        if (!detail) result.remove("history");
        long received = 0, paid = 0, contractReceived = 0, writerPaid = 0;
        for (Object item : Json.array(paper.get("transactions"))) {
            Map<String, Object> tx = Json.object(item);
            long amount = FinancialLedger.signed(tx);
            String type = Main.string(tx, "type");
            if (type.startsWith("incoming_")) received += amount; else paid += amount;
            if (type.equals("incoming_deposit") || type.equals("incoming_balance")) contractReceived += amount;
            if (type.equals("outgoing_deposit") || type.equals("outgoing_balance")) writerPaid += amount;
        }
        long contract = number(paper.get("contractCents")), writerFee = number(paper.get("writerFeeCents"));
        long deposit = number(paper.getOrDefault("contractDepositCents", 0));
        result.put("contractDepositCents", deposit); result.put("contractBalanceCents", contract - deposit);
        result.put("receivedCents", received); result.put("paidCents", paid);
        result.put("contractReceivedCents", contractReceived); result.put("writerPaidCents", writerPaid);
        result.put("otherIncomeCents", ServiceTermination.total(paper,"incoming_other")); result.put("otherExpenseCents", ServiceTermination.total(paper,"outgoing_other"));
        result.put("receivableCents", Math.max(0, contract - contractReceived));
        result.put("payableCents", Math.max(0, writerFee - writerPaid));
        result.put("netCents", received - paid);
        BusinessService.enrichPaper(paper, result, state);
        ServiceTermination.enrich(paper,result);
        PublicationFees.enrich(paper,result);
        FinancialLedger.enrich(paper,result);
        result.put("writerAssignments",WriterAssignments.views(paper));
        result.put("totalWriterFeeCents",ServiceTermination.writerTarget(paper));
        return result;
    }

    static void validateStored(Map<String, Object> paper) {
        FollowUps.validateStored(paper);
        FinancialLedger.validateStored(paper);
        ServiceTermination.validateStored(paper);
        PublicationFees.validateStored(paper);
        UUID.fromString(Main.string(paper, "id"));
        if (Main.string(paper, "code").isBlank() || number(paper.get("version")) < 1) throw new IllegalArgumentException();
        Instant.parse(Main.string(paper, "createdAt")); Instant.parse(Main.string(paper, "updatedAt"));
        Map<String, Object> input = new LinkedHashMap<>(paper);
        input.put("contractAmount", BigDecimal.valueOf(number(paper.get("contractCents")), 2).toPlainString());
        input.put("contractDepositAmount", BigDecimal.valueOf(number(paper.getOrDefault("contractDepositCents", 0)), 2).toPlainString());
        input.put("writerFee", BigDecimal.valueOf(number(paper.get("writerFeeCents")), 2).toPlainString());
        input.put("publicationFeeAmount", BigDecimal.valueOf(PublicationFees.amount(paper),2).toPlainString());
        fields(input, null);
        List<Object> transactions = Json.array(paper.get("transactions"));
        if (transactions.size() > 1000) throw new IllegalArgumentException();
        Set<String> txIds = new HashSet<>();
        for (Object item : transactions) {
            Map<String, Object> tx = Json.object(item);
            UUID.fromString(Main.string(tx, "id"));
            long cents = number(tx.get("amountCents"));
            if (cents <= 0 || cents > 100_000_000L || !TYPES.contains(Main.string(tx, "type")) || !txIds.add(Main.string(tx, "id"))) throw new IllegalArgumentException();
            if (date(tx, "date").isEmpty()) throw new IllegalArgumentException();
            Instant.parse(Main.string(tx, "createdAt")); text(tx, "method", 80); text(tx, "note", 1000);
        }
        for (Object item : Json.array(paper.get("history"))) {
            Map<String, Object> event = Json.object(item); Instant.parse(Main.string(event, "at"));
            if (!STATUSES.contains(Main.string(event, "status"))) throw new IllegalArgumentException();
        }
    }

    static Map<String, Object> find(Map<String, Object> state, String id) {
        for (Object item : Json.array(state.get("papers"))) if (Main.string(Json.object(item), "id").equals(id)) return Json.object(item);
        throw new ApiException(404, "论文不存在，可能已被删除");
    }
    static void checkVersion(Map<String, Object> paper, Map<String, Object> input) {
        if (number(paper.get("version")) != number(input.get("version"))) throw new ApiException(409, "这条记录已在其他页面更新，请关闭后重新打开，再提交修改");
    }
    static void touch(Map<String, Object> paper) { paper.put("updatedAt", now()); paper.put("version", number(paper.get("version")) + 1); }
    private static Map<String, Object> event(Map<String, Object> paper, String action) {
        Map<String, Object> event = new LinkedHashMap<>(); event.put("at", now()); event.put("action", action);
        for (String k : List.of("status", "journal", "submissionSystem", "submissionUrl", "submittedAt")) event.put(k, paper.get(k));
        return event;
    }
    static String now() { return Instant.now().toString(); }
    static String text(Map<String, Object> input, String key, int max) {
        Object raw = input.get(key);
        if (raw != null && !(raw instanceof String)) throw new ApiException(400, "字段格式不正确：" + key);
        String value = Main.string(input, key).trim();
        if (value.length() > max) throw new ApiException(400, "字段内容过长：" + key);
        return value;
    }
    static String date(Map<String, Object> input, String key) {
        String value = text(input, key, 10);
        if (!value.isEmpty()) {
            try { if (!LocalDate.parse(value).toString().equals(value)) throw new DateTimeParseException("date", value, 0); }
            catch (DateTimeParseException e) { throw new ApiException(400, "日期格式不正确：" + key); }
        }
        return value;
    }
    static long money(Map<String, Object> input, String key) {
        String raw = text(input, key, 24);
        if (raw.isEmpty()) return 0;
        if (!raw.matches("\\d+(\\.\\d{1,2})?")) throw new ApiException(400, "金额需要为非负数，最多两位小数");
        try {
            long cents = new BigDecimal(raw).movePointRight(2).longValueExact();
            if (cents > 100_000_000L) throw new ArithmeticException(); return cents;
        } catch (ArithmeticException e) { throw new ApiException(400, "单笔或约定金额不能超过 100 万元"); }
    }
    static long number(Object value) {
        try { return new BigDecimal(Objects.toString(value, "")).longValueExact(); }
        catch (ArithmeticException | NumberFormatException e) { throw new ApiException(400, "金额或版本号格式不正确"); }
    }
}
