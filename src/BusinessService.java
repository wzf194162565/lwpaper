import java.math.BigDecimal;
import java.text.Normalizer;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;

/** Customer relationships, writing workflow, independent submission attempts and legacy migration. */
public final class BusinessService {
    static final Set<String> WRITING_STATUSES = Set.of("待分配", "写作中", "待修改", "已交稿", "已完成", "已取消");
    static final Set<String> SERVICE_TYPES = Set.of("full", "half");
    static final Set<String> CUSTOMER_STATUSES = Set.of("待合作", "合作中", "已归档");
    static final Set<String> CUSTOMER_TYPES = Set.of("同行", "终端客户（自主开发）", "他人介绍");
    static final Set<String> FINISHED_SUBMISSIONS = Set.of("已录用", "已发表", "已拒稿", "已撤稿");
    static final List<String> SUBMISSION_FIELDS = List.of("journal", "submissionSystem", "submissionUrl", "submissionAccount", "submissionPassword", "boundEmail", "boundPhone", "submittedAt", "status");
    private final BusinessStore vault;
    public BusinessService(BusinessStore vault) { this.vault = vault; }

    static boolean migrate(Map<String, Object> state) {
        if (!Objects.toString(state.get("schema"), "").equals("1")) return PublicationFees.migrateState(state);
        state.put("customers", new ArrayList<>());
        for (Object item : Json.array(state.get("papers"))) {
            Map<String, Object> paper = Json.object(item);
            Map<String, Object> writing = new LinkedHashMap<>();
            applyWriting(paper, paper, writing); paper.putAll(writing);
            paper.put("submissions", new ArrayList<>()); paper.put("activeSubmissionId", "");
            linkCustomer(state, paper, Map.of("customer", Main.string(paper, "customer")));
            if (hasLegacySubmission(paper)) {
                Map<String, Object> submission = legacySubmission(paper);
                Json.array(paper.get("submissions")).add(submission);
                paper.put("activeSubmissionId", submission.get("id"));
            }
            syncCurrent(paper);
        }
        state.put("schema", 2);
        PublicationFees.migrateState(state);
        return true;
    }

    static void initializePaper(Map<String, Object> state, Map<String, Object> paper, Map<String, Object> input) {
        paper.put("submissions", new ArrayList<>()); paper.put("activeSubmissionId", "");
        linkCustomer(state, paper, input);
        if (hasLegacySubmission(paper)) {
            Map<String, Object> submission = legacySubmission(paper);
            autoEndDates(submission); validateSubmissionDates(submission, true);
            Json.array(paper.get("submissions")).add(submission);
            paper.put("activeSubmissionId", submission.get("id"));
        }
        syncCurrent(paper);
    }

    static void updatePaper(Map<String, Object> state, Map<String, Object> paper, Map<String, Object> input) {
        linkCustomer(state, paper, input);
        if (SUBMISSION_FIELDS.stream().anyMatch(input::containsKey)) {
            Map<String, Object> current = current(paper);
            if (current == null && hasLegacySubmission(paper)) {
                current = legacySubmission(paper);
                autoEndDates(current); validateSubmissionDates(current, true);
                Json.array(paper.get("submissions")).add(current);
                paper.put("activeSubmissionId", current.get("id"));
            } else if (current != null) {
                Map<String, Object> before = new LinkedHashMap<>(current);
                for (String field : SUBMISSION_FIELDS) current.put(field, paper.get(field));
                if (!before.equals(current)) {
                    boolean journalChanged = !journalKey(Main.string(before, "journal")).equals(journalKey(Main.string(current, "journal")));
                    boolean reopened = Set.of("已拒稿", "已撤稿").contains(Main.string(before, "status")) &&
                        !Set.of("已拒稿", "已撤稿").contains(Main.string(current, "status"));
                    if (journalChanged || reopened) checkDuplicateSubmission(paper, Main.string(current, "journal"), Main.string(current, "id"));
                    autoEndDates(current);
                    validateSubmissionDates(current, !Objects.equals(before.get("status"), current.get("status")) || input.containsKey("submittedAt"));
                    PaperService.touch(current);
                }
            }
        }
        syncCurrent(paper);
    }

    // Records created before service types were introduced retain their writing workflow.
    static String serviceType(Map<String, Object> paper) {
        String type = paper.containsKey("serviceType") ? PaperService.text(paper, "serviceType", 20) : "full";
        if (!SERVICE_TYPES.contains(type)) throw new ApiException(400, "请选择全包或半包服务");
        return type;
    }

    static boolean hasWriting(Map<String, Object> paper) { return serviceType(paper).equals("full"); }

    private static String writingStatus(String status, String delivered) {
        // A delivery closes initial writing; revisions and explicit terminal states remain distinct.
        return !delivered.isEmpty() && Set.of("待分配", "写作中").contains(status) ? "已交稿" : status;
    }

    static void applyWriting(Map<String, Object> input, Map<String, Object> previous, Map<String, Object> output) {
        Map<String, Object> values = new LinkedHashMap<>();
        if (previous != null) values.putAll(previous); values.putAll(input);
        output.put("serviceType", serviceType(values));
        if (!hasWriting(values)) {
            boolean writingData = !Main.string(values, "writer").isEmpty() ||
                List.of("writingStartAt", "writingDueAt", "writingDeliveredAt").stream().anyMatch(k -> !Main.string(values, k).isEmpty()) ||
                !Set.of("", "待分配").contains(Main.string(values, "writingStatus")) ||
                PaperService.number(output.getOrDefault("writerFeeCents", values.getOrDefault("writerFeeCents", 0))) != 0 ||
                (input.containsKey("writerDepositAmount") ? PaperService.money(input, "writerDepositAmount") : PaperService.number(values.getOrDefault("writerDepositCents", 0))) != 0;
            boolean writingPayments = previous != null && previous.get("transactions") instanceof List<?> transactions &&
                transactions.stream().map(Json::object).anyMatch(tx -> Set.of("outgoing_deposit", "outgoing_balance").contains(Main.string(tx, "type")));
            if (writingData || writingPayments) throw new ApiException(400, "半包由客户提供文章，不能包含写作安排、稿酬或稿酬付款；需要写作请选择全包");
            for (String field : List.of("writer", "writingStatus", "writingStartAt", "writingDueAt", "writingDeliveredAt")) output.put(field, "");
            output.put("writerFeeCents", 0L); output.put("writerDepositCents", 0L);
            return;
        }
        String status = values.containsKey("writingStatus") ? PaperService.text(values, "writingStatus", 20) : Main.string(values, "writer").isEmpty() ? "待分配" : "写作中";
        if (!WRITING_STATUSES.contains(status)) throw new ApiException(400, "请选择有效的写作状态");
        output.put("writingStatus", status);
        for (String field : List.of("writingStartAt", "writingDueAt", "writingDeliveredAt")) output.put(field, PaperService.date(values, field));
        if (Set.of("已交稿", "已完成").contains(status) && Main.string(output, "writingDeliveredAt").isEmpty()) output.put("writingDeliveredAt", LocalDate.now().toString());
        String start = Main.string(output, "writingStartAt"), due = Main.string(output, "writingDueAt"), delivered = Main.string(output, "writingDeliveredAt");
        if (!start.isEmpty() && !due.isEmpty() && due.compareTo(start) < 0) throw new ApiException(400, "预计交稿日期不能早于写作开始日期");
        if (!delivered.isEmpty() && (delivered.compareTo(LocalDate.now().toString()) > 0 || (!start.isEmpty() && delivered.compareTo(start) < 0))) throw new ApiException(400, "实际交稿日期不能晚于今天或早于写作开始日期");
        output.put("writingStatus", writingStatus(status, delivered));
        long fee = PaperService.number(output.getOrDefault("writerFeeCents", values.getOrDefault("writerFeeCents", 0)));
        long deposit = input.containsKey("writerDepositAmount") ? PaperService.money(input, "writerDepositAmount") : PaperService.number(values.getOrDefault("writerDepositCents", 0));
        if (deposit < 0 || deposit > fee) throw new ApiException(400, "约定写作定金不能超过稿酬总额");
        output.put("writerDepositCents", deposit);
    }

    private static boolean hasLegacySubmission(Map<String, Object> paper) {
        return !Set.of("草稿", "待投稿").contains(Main.string(paper, "status")) ||
            List.of("journal", "submissionSystem", "submissionAccount", "submissionPassword", "submissionUrl", "boundEmail", "boundPhone", "submittedAt").stream().anyMatch(k -> !Main.string(paper, k).isEmpty());
    }

    private static Map<String, Object> legacySubmission(Map<String, Object> paper) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (String field : SUBMISSION_FIELDS) result.put(field, paper.getOrDefault(field, ""));
        result.put("title", paper.get("title")); result.put("notes", ""); result.put("endedAt", ""); result.put("publishedAt", "");
        result.put("id", UUID.randomUUID().toString()); result.put("version", 1);
        result.put("createdAt", paper.get("createdAt")); result.put("updatedAt", paper.get("updatedAt"));
        // Legacy records have no reliable completion date: retain it as unknown.
        return result;
    }

    private static void linkCustomer(Map<String, Object> state, Map<String, Object> paper, Map<String, Object> input) {
        if (input.containsKey("customerId")) {
            String id = PaperService.text(input, "customerId", 100);
            paper.put("customerId", id);
            paper.put("customer", id.isEmpty() ? "" : findCustomer(state, id).get("name"));
        } else if (input.containsKey("customer") || !paper.containsKey("customerId")) {
            String name = PaperService.text(input, "customer", 200);
            String id = "";
            if (!name.isEmpty()) {
                Map<String, Object> match = null;
                for (Object item : Json.array(state.get("customers"))) if (Main.string(Json.object(item), "name").equals(name)) { match = Json.object(item); break; }
                if (match == null) { match = newCustomer(Map.of("name", name)); Json.array(state.get("customers")).add(match); }
                id = Main.string(match, "id");
            }
            paper.put("customerId", id); paper.put("customer", name);
        }
    }

    static Map<String, Object> current(Map<String, Object> paper) {
        for (Object item : Json.array(paper.get("submissions"))) if (Main.string(Json.object(item), "id").equals(Main.string(paper, "activeSubmissionId"))) return Json.object(item);
        return null;
    }

    static void syncCurrent(Map<String, Object> paper) {
        Map<String, Object> current = current(paper);
        for (String field : SUBMISSION_FIELDS) paper.put(field, current == null ? field.equals("status") ? "待投稿" : "" : current.get(field));
    }

    static void enrichPaper(Map<String, Object> paper, Map<String, Object> result, Map<String, Object> state) {
        result.put("serviceType", serviceType(paper));
        String customerId = Main.string(paper, "customerId");
        result.put("customer", customerId.isEmpty() ? "" : findCustomer(state, customerId).get("name"));
        List<Object> submissions = new ArrayList<>(); Set<String> journals = new LinkedHashSet<>(); boolean published = false;
        for (Object item : Json.array(paper.get("submissions"))) {
            Map<String, Object> sub = Json.object(item); submissions.add(publicSubmission(sub));
            if (Main.string(sub, "status").equals("已发表")) { published = true; if (!Main.string(sub, "journal").isEmpty()) journals.add(Main.string(sub, "journal")); }
        }
        result.put("submissions", submissions); result.put("publishedJournals", new ArrayList<>(journals));
        result.put("published", published);
        Map<String, Object> current = current(paper);
        result.put("submissionTitle", current == null ? "" : current.get("title"));
        result.put("submissionDays", current == null ? null : publicSubmission(current).get("durationDays"));
        result.put("writerBalanceCents", PaperService.number(paper.get("writerFeeCents")) - PaperService.number(paper.get("writerDepositCents")));
        String delivered = Main.string(paper, "writingDeliveredAt");
        String status = writingStatus(Main.string(paper, "writingStatus"), delivered);
        // Resolve older inconsistent records in every API view without rewriting them on a read.
        result.put("writingStatus", status);
        result.put("writingDays", hasWriting(paper) ? elapsed(Main.string(paper, "writingStartAt"), delivered, status.equals("已取消")) : null);
        result.put("writingOverdue", hasWriting(paper) && delivered.isEmpty() && !Main.string(paper, "writingDueAt").isEmpty() && Main.string(paper, "writingDueAt").compareTo(LocalDate.now().toString()) < 0 && !Set.of("已交稿", "已完成", "已取消").contains(status));
        for (String type : PaperService.TYPES) {
            long total = 0;
            for (Object item : Json.array(paper.get("transactions"))) { Map<String, Object> tx = Json.object(item); if (Main.string(tx, "type").equals(type)) total += FinancialLedger.signed(tx); }
            result.put(type + "Cents", total);
        }
    }

    static Map<String, Object> publicSubmission(Map<String, Object> submission) {
        Map<String, Object> result = new LinkedHashMap<>(submission);
        result.remove("submissionPassword"); result.put("hasPassword", !Main.string(submission, "submissionPassword").isEmpty());
        String end = Main.string(submission, "endedAt");
        if (end.isEmpty()) end = Main.string(submission, "publishedAt");
        result.put("durationDays", elapsed(Main.string(submission, "submittedAt"), end, FINISHED_SUBMISSIONS.contains(Main.string(submission, "status"))));
        return result;
    }

    private static Object elapsed(String start, String end, boolean finished) {
        if (start.isEmpty() || (finished && end.isEmpty())) return null;
        return Math.max(0, ChronoUnit.DAYS.between(LocalDate.parse(start), end.isEmpty() ? LocalDate.now() : LocalDate.parse(end)));
    }

    public Map<String, Object> addSubmission(String paperId, Map<String, Object> input) throws Exception {
        return vault.mutate(state -> {
            Map<String, Object> paper = PaperService.find(state, paperId); PaperService.checkVersion(paper, input);
            ServiceTermination.requireActive(paper);
            List<Object> list = Json.array(paper.get("submissions"));
            if (list.size() >= 200) throw new ApiException(400, "每篇论文最多保留 200 次投稿");
            Map<String, Object> sub = submissionFields(input, null, paper);
            checkDuplicateSubmission(paper, Main.string(sub, "journal"), "");
            PublicationFees.initialize(paper);boolean first=list.isEmpty();
            sub.put("id", UUID.randomUUID().toString()); sub.put("version", 1); sub.put("createdAt", PaperService.now()); sub.put("updatedAt", PaperService.now());
            list.add(sub); paper.put("activeSubmissionId", sub.get("id")); syncCurrent(paper); PaperService.touch(paper);
            PublicationFees.onSubmissionAdded(paper,sub,input,first);
            FinancialLedger.audit(paper,"fee_update",Map.of("publicationAccountId",PublicationFees.current(paper).get("id")),FinancialLedger.actor(vault),"建立投稿费用："+PublicationFees.descriptionAccount(PublicationFees.current(paper)),"");
            addHistory(paper, sub, "新增投稿记录");
            return PaperService.publicPaper(paper, true, state);
        });
    }

    public Map<String, Object> updateSubmission(String paperId, String id, Map<String, Object> input) throws Exception {
        return vault.mutate(state -> {
            Map<String, Object> paper = PaperService.find(state, paperId), sub = findSubmission(paper, id);
            ServiceTermination.requireActive(paper);
            PaperService.checkVersion(sub, input);
            Map<String, Object> next = submissionFields(input, sub, paper);
            boolean journalChanged = !journalKey(Main.string(sub, "journal")).equals(journalKey(Main.string(next, "journal")));
            boolean reopened = Set.of("已拒稿", "已撤稿").contains(Main.string(sub, "status")) &&
                !Set.of("已拒稿", "已撤稿").contains(Main.string(next, "status"));
            if (journalChanged || reopened) checkDuplicateSubmission(paper, Main.string(next, "journal"), id);
            if(PublicationFees.hasTerms(input))PaperService.checkVersion(paper,Map.of("version",input.getOrDefault("paperVersion",0)));
            if(journalChanged){Map<String,Object> account=PublicationFees.bySubmission(paper,id);if(account!=null&&PublicationFees.hasTransactions(paper,Main.string(account,"id")))throw new ApiException(409,"该投稿已有版面费流水，更换期刊请使用改投");}
            sub.putAll(next); PaperService.touch(sub);
            PublicationFees.updateForSubmission(paper,id,input,journalChanged);
            if(PublicationFees.hasTerms(input)||journalChanged)FinancialLedger.audit(paper,"fee_update",Map.of("publicationAccountId",PublicationFees.bySubmission(paper,id).get("id")),FinancialLedger.actor(vault),"更新投稿费用："+PublicationFees.descriptionAccount(PublicationFees.bySubmission(paper,id)),"");
            syncCurrent(paper); PaperService.touch(paper); addHistory(paper, sub, "更新投稿记录");
            return PaperService.publicPaper(paper, true, state);
        });
    }

    public Map<String, Object> deleteSubmission(String paperId, String id, Map<String, Object> input) throws Exception {
        return vault.mutate(state -> {
            ServiceTermination.requireActive(PaperService.find(state,paperId));
            Map<String, Object> paper = PaperService.find(state, paperId), sub = findSubmission(paper, id);
            PaperService.checkVersion(sub, input);PublicationFees.beforeDeleteSubmission(paper,id);Json.array(paper.get("submissions")).remove(sub);
            if (Main.string(paper, "activeSubmissionId").equals(id)) {
                List<Object> list = Json.array(paper.get("submissions"));
                paper.put("activeSubmissionId", list.isEmpty() ? "" : Json.object(list.get(list.size() - 1)).get("id"));
                PublicationFees.mirror(paper);
            }
            syncCurrent(paper); PaperService.touch(paper); addHistory(paper, sub, "删除投稿记录");
            return PaperService.publicPaper(paper, true, state);
        });
    }

    public Map<String, Object> submissionCredentials(String paperId, String id) {
        Map<String, Object> paper = PaperService.find(vault.read(), paperId);
        return Map.of("password", Main.string(findSubmission(paper, id), "submissionPassword"));
    }

    private static Map<String, Object> findSubmission(Map<String, Object> paper, String id) {
        for (Object item : Json.array(paper.get("submissions"))) if (Main.string(Json.object(item), "id").equals(id)) return Json.object(item);
        throw new ApiException(404, "这次投稿记录不存在");
    }

    private static String journalKey(String journal) {
        return Normalizer.normalize(journal, Normalizer.Form.NFKC).replaceAll("(?U)\\s+", "").toLowerCase(Locale.ROOT);
    }

    private static void checkDuplicateSubmission(Map<String, Object> paper, String journal, String exceptId) {
        String key = journalKey(journal);
        if (key.isEmpty()) return;
        List<Map<String, Object>> matches = Json.array(paper.get("submissions")).stream().map(Json::object)
            .filter(s -> !Main.string(s, "id").equals(exceptId) && journalKey(Main.string(s, "journal")).equals(key)).toList();
        if (matches.stream().anyMatch(s -> Main.string(s, "status").equals("已发表")))
            throw new ApiException(409, "该论文在此期刊已有已发表记录，请编辑原投稿核对信息，不能重复新增同一期刊投稿");
        if (matches.stream().anyMatch(s -> !Set.of("已拒稿", "已撤稿").contains(Main.string(s, "status"))))
            throw new ApiException(409, "该论文在此期刊已有未结束投稿，请编辑原记录更新进度；原投稿拒稿或撤稿后才能再次投稿");
    }

    private static Map<String, Object> submissionFields(Map<String, Object> input, Map<String, Object> previous, Map<String, Object> paper) {
        Map<String, Object> merged = new LinkedHashMap<>(); if (previous != null) merged.putAll(previous); merged.putAll(input);
        if (Main.string(merged, "title").isEmpty()) merged.put("title", paper.get("title"));
        merged.putIfAbsent("status", "待投稿");
        Map<String, Object> result = new LinkedHashMap<>();
        for (String field : List.of("title", "journal", "submissionSystem", "submissionUrl", "submissionAccount", "boundEmail", "boundPhone", "status", "notes")) result.put(field, PaperService.text(merged, field, field.equals("notes") ? 5000 : field.equals("title") ? 300 : 200));
        if (Main.string(result, "journal").isEmpty()) throw new ApiException(400, "请填写投稿期刊名称");
        if (!PaperService.STATUSES.contains(Main.string(result, "status"))) throw new ApiException(400, "投稿状态不正确");
        for (String field : List.of("submittedAt", "endedAt", "publishedAt", "expectedPublishedAt")) result.put(field, PaperService.date(merged, field));
        String password = Main.string(merged, "submissionPassword");
        if (password.length() > 500 || (merged.containsKey("submissionPassword") && !(merged.get("submissionPassword") instanceof String))) throw new ApiException(400, "投稿密码格式不正确，最多 500 个字符");
        result.put("submissionPassword", password);
        String manuscript=PaperService.text(merged,"manuscriptId",36);
        if(!manuscript.isEmpty()&&AttachmentService.receipt(AttachmentService.find(paper,manuscript)))throw new ApiException(400,"收支凭证不能作为投稿稿件");
        result.put("manuscriptId",manuscript);
        if(Main.string(result,"status").equals("已录用")&&Main.string(result,"endedAt").isEmpty())throw new ApiException(400,"请填写实际录用日期");
        validateContactAndUrl(result); autoEndDates(result); validateSubmissionDates(result, true);
        if(input.containsKey("expectedPublishedAt"))validateExpectedPublication(result);
        return result;
    }

    private static void validateExpectedPublication(Map<String,Object> sub) {
        String expected=PaperService.date(sub,"expectedPublishedAt");
        if(expected.isEmpty())return;
        String accepted=PaperService.date(sub,"endedAt");
        if(!accepted.isEmpty()&&expected.compareTo(accepted)<=0)throw new ApiException(400,"预计发表日期必须晚于录用日期");
    }

    private static void autoEndDates(Map<String, Object> sub) {
        String today = LocalDate.now().toString(), status = Main.string(sub, "status");
        if (!status.equals("已发表")) sub.put("publishedAt", "");
        if (!FINISHED_SUBMISSIONS.contains(status)) sub.put("endedAt", "");
        if (status.equals("已发表") && Main.string(sub, "publishedAt").isEmpty()) sub.put("publishedAt", today);
        if (FINISHED_SUBMISSIONS.contains(status) && Main.string(sub, "endedAt").isEmpty()) sub.put("endedAt", Main.string(sub, "publishedAt").isEmpty() ? today : sub.get("publishedAt"));
    }

    private static void validateSubmissionDates(Map<String, Object> sub, boolean requireSubmitted) {
        String start = PaperService.date(sub, "submittedAt"), end = PaperService.date(sub, "endedAt"), published = PaperService.date(sub, "publishedAt");
        if (requireSubmitted && !Set.of("草稿", "待投稿").contains(Main.string(sub, "status")) && start.isEmpty()) throw new ApiException(400, "请填写实际投稿日期，以便计算投稿时长");
        for (String value : List.of(start, end, published)) if (!value.isEmpty() && value.compareTo(LocalDate.now().toString()) > 0) throw new ApiException(400, "投稿、结束和发表日期不能晚于今天");
        if (!start.isEmpty() && ((!end.isEmpty() && end.compareTo(start) < 0) || (!published.isEmpty() && published.compareTo(start) < 0))) throw new ApiException(400, "结束或发表日期不能早于投稿日期");
        if (!end.isEmpty() && !published.isEmpty() && published.compareTo(end) < 0) throw new ApiException(400, "发表日期不能早于结束/录用日期");
    }

    private static void addHistory(Map<String, Object> paper, Map<String, Object> sub, String action) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("at", PaperService.now()); event.put("action", action); event.put("submissionId", sub.get("id"));
        for (String field : List.of("status", "journal", "submissionSystem", "submissionUrl", "submittedAt")) event.put(field, sub.get(field));
        Json.array(paper.get("history")).add(event);
    }

    public List<Object> customers() {
        Map<String, Object> state = vault.read(); List<Object> result = new ArrayList<>();
        for (Object item : Json.array(state.get("customers"))) result.add(customerSummary(Json.object(item), state, false));
        result.sort(Comparator.comparing((Object o) -> Main.string(Json.object(o), "updatedAt")).reversed()); return result;
    }
    public Map<String, Object> accountAuthors() {
        Map<String, Object> state = vault.read();
        List<Object> papers = Json.array(state.get("papers"));
        Map<String, Object> result = AuthorRelations.summary(papers);
        result.put("username", Main.string(state, "username")); result.put("paperCount", papers.size());
        return result;
    }
    public Map<String, Object> customer(String id) { Map<String, Object> state = vault.read(); return customerSummary(findCustomer(state, id), state, true); }
    public Map<String, Object> createCustomer(Map<String, Object> input) throws Exception {
        return vault.mutate(state -> {
            if (Json.array(state.get("customers")).size() >= 10_000) throw new ApiException(400, "客户数量达到上限");
            Map<String, Object> customer = newCustomer(input); Json.array(state.get("customers")).add(customer);
            return customerSummary(customer, state, true);
        });
    }
    public Map<String, Object> updateCustomer(String id, Map<String, Object> input) throws Exception {
        return vault.mutate(state -> {
            Map<String, Object> customer = findCustomer(state, id); PaperService.checkVersion(customer, input);
            Map<String, Object> merged = new LinkedHashMap<>(customer); merged.putAll(input);
            customer.putAll(customerFields(merged)); PaperService.touch(customer);
            return customerSummary(customer, state, true);
        });
    }
    public void deleteCustomer(String id, Map<String, Object> input) throws Exception {
        vault.mutate(state -> {
            Map<String, Object> customer = findCustomer(state, id); PaperService.checkVersion(customer, input);
            for (Object item : Json.array(state.get("papers"))) if (Main.string(Json.object(item), "customerId").equals(id)) throw new ApiException(409, "该客户还有关联论文，请先调整论文归属；也可以将客户标为已归档");
            Json.array(state.get("customers")).remove(customer); return null;
        });
    }

    private static Map<String, Object> newCustomer(Map<String, Object> input) {
        Map<String, Object> result = customerFields(input);
        result.put("id", UUID.randomUUID().toString()); result.put("version", 1); result.put("createdAt", PaperService.now()); result.put("updatedAt", PaperService.now());
        return result;
    }
    private static Map<String, Object> customerFields(Map<String, Object> input) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (String field : List.of("name", "phone", "email", "wechat", "organization", "address", "notes")) result.put(field, PaperService.text(input, field, field.equals("notes") ? 5000 : field.equals("address") ? 300 : 200));
        if (Main.string(result, "name").isEmpty()) throw new ApiException(400, "请填写客户姓名");
        String status = input.containsKey("status") ? PaperService.text(input, "status", 20) : "合作中";
        if (!CUSTOMER_STATUSES.contains(status)) throw new ApiException(400, "客户状态不正确"); result.put("status", status);
        String customerType = PaperService.text(input, "customerType", 20);
        if (!customerType.isEmpty() && !CUSTOMER_TYPES.contains(customerType)) throw new ApiException(400, "客户类型不正确，请选择同行、终端客户（自主开发）或他人推荐");
        result.put("customerType", customerType);
        result.put("referrer", PaperService.text(input, "referrer", 200));
        String cooperationStartedAt = PaperService.date(input, "cooperationStartedAt");
        if (!cooperationStartedAt.isEmpty() && (cooperationStartedAt.compareTo("1000-01-01") < 0 || cooperationStartedAt.compareTo(LocalDate.now().toString()) > 0)) throw new ApiException(400, "合作开始日期应为有效的历史日期，不能晚于今天");
        result.put("cooperationStartedAt", cooperationStartedAt);
        String email = Main.string(result, "email");
        if (!email.isEmpty() && !email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) throw new ApiException(400, "客户邮箱格式不正确");
        return result;
    }
    static Map<String, Object> findCustomer(Map<String, Object> state, String id) {
        for (Object item : Json.array(state.get("customers"))) if (Main.string(Json.object(item), "id").equals(id)) return Json.object(item);
        throw new ApiException(404, "关联客户不存在，请重新选择客户");
    }
    private static Map<String, Object> customerSummary(Map<String, Object> customer, Map<String, Object> state, boolean detail) {
        Map<String, Object> result = new LinkedHashMap<>(customer); List<Object> papers = new ArrayList<>(); Set<String> journals = new LinkedHashSet<>();
        result.put("cooperationStartedAt", Main.string(customer, "cooperationStartedAt"));
        result.put("customerType", Main.string(customer, "customerType"));
        result.put("referrer", Main.string(customer, "referrer"));
        long contract = 0, received = 0, unpaid = 0, cost = 0,refund=0; int published = 0;
        for (Object item : Json.array(state.get("papers"))) {
            Map<String, Object> paper = Json.object(item);
            if (!Main.string(paper, "customerId").equals(Main.string(customer, "id"))) continue;
            Map<String, Object> view = PaperService.publicPaper(paper, false, state); papers.add(view);
            contract += PaperService.number(view.get("settlementContractCents")); received += PaperService.number(view.get("contractReceivedCents")); unpaid += PaperService.number(view.get("receivableCents")); cost += PaperService.number(view.get("settlementWriterFeeCents"));refund+=PaperService.number(view.get("refundableCents"));
            if (Boolean.TRUE.equals(view.get("published"))) published++;
            for (Object journal : Json.array(view.get("publishedJournals"))) journals.add(journal.toString());
        }
        result.put("paperCount", papers.size()); result.put("publishedPaperCount", published); result.put("publishedJournals", new ArrayList<>(journals));
        result.put("contractCents", contract); result.put("receivedCents", received); result.put("receivableCents", unpaid); result.put("writerFeeCents", cost);
        result.put("refundableCents",refund);
        result.putAll(AuthorRelations.summary(papers));
        if (detail) result.put("papers", papers); return result;
    }

    private static void validateContactAndUrl(Map<String, Object> input) {
        String email = Main.string(input, "boundEmail"), url = Main.string(input, "submissionUrl");
        if (!email.isEmpty() && !email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) throw new ApiException(400, "绑定邮箱格式不正确");
        if (!url.isEmpty()) {
            try { java.net.URI uri = java.net.URI.create(url); if (!Set.of("https", "http").contains(Objects.toString(uri.getScheme(), "")) || uri.getHost() == null || uri.getUserInfo() != null) throw new IllegalArgumentException(); }
            catch (IllegalArgumentException e) { throw new ApiException(400, "投稿网址需要以 http:// 或 https:// 开头"); }
        }
    }

    static void validateState(Map<String, Object> state) {
        Set<String> customerIds = new HashSet<>(); List<Object> customers = Json.array(state.get("customers"));
        if (customers.size() > 10_000) throw new IllegalArgumentException();
        for (Object item : customers) {
            Map<String, Object> customer = Json.object(item); validateIdentity(customer); customerFields(customer);
            if (!customerIds.add(Main.string(customer, "id"))) throw new IllegalArgumentException();
        }
        for (Object item : Json.array(state.get("papers"))) {
            Map<String, Object> paper = Json.object(item);
            if (!Main.string(paper, "customerId").isEmpty() && !customerIds.contains(Main.string(paper, "customerId"))) throw new IllegalArgumentException();
            Map<String, Object> writing = new LinkedHashMap<>(); applyWriting(paper, paper, writing);
            List<Object> submissions = Json.array(paper.get("submissions")); Set<String> ids = new HashSet<>();
            if (submissions.size() > 200) throw new IllegalArgumentException();
            for (Object subItem : submissions) {
                Map<String, Object> sub = Json.object(subItem); validateIdentity(sub);
                if (!ids.add(Main.string(sub, "id")) || !PaperService.STATUSES.contains(Main.string(sub, "status"))) throw new IllegalArgumentException();
                for (String field : List.of("title", "journal", "submissionSystem", "submissionUrl", "submissionAccount", "boundEmail", "boundPhone", "notes")) PaperService.text(sub, field, field.equals("notes") ? 5000 : field.equals("title") ? 300 : 200);
                if (!(sub.get("submissionPassword") instanceof String) || Main.string(sub, "submissionPassword").length() > 500) throw new IllegalArgumentException();
                validateContactAndUrl(sub); validateSubmissionDates(sub, false);
            }
            if ((!submissions.isEmpty() && !ids.contains(Main.string(paper, "activeSubmissionId"))) || (submissions.isEmpty() && !Main.string(paper, "activeSubmissionId").isEmpty())) throw new IllegalArgumentException();
        }
    }
    private static void validateIdentity(Map<String, Object> value) {
        UUID.fromString(Main.string(value, "id")); if (PaperService.number(value.get("version")) < 1) throw new IllegalArgumentException();
        Instant.parse(Main.string(value, "createdAt")); Instant.parse(Main.string(value, "updatedAt"));
    }
}
