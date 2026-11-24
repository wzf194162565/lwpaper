import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;

/** Explicit relational row mapping. No business state is stored as an opaque JSON document. */
final class MysqlStateMapper {
    enum Kind { TEXT, NUMBER, DATE, TIME, SECRET }
    record Column(String sql, String field, Kind kind) {}
    record Table(String name, String key, List<Column> columns) {}
    record Row(String id, Map<String, Object> values) {}
    private final String workspace;
    private final DatabaseCrypto crypto;
    private final String fingerprint;

    private static Column s(String sql, String field) { return new Column(sql, field, Kind.TEXT); }
    private static Column n(String sql, String field) { return new Column(sql, field, Kind.NUMBER); }
    private static Column d(String sql, String field) { return new Column(sql, field, Kind.DATE); }
    private static Column t(String sql, String field) { return new Column(sql, field, Kind.TIME); }
    private static Table table(String name, String key, Column... columns) { return new Table(name, key, List.of(columns)); }
    static final Table CUSTOMERS = table("lw_customer", "id", s("id","id"),s("name","name"),s("phone","phone"),s("email","email"),s("wechat","wechat"),s("organization","organization"),s("address","address"),s("status","status"),s("customer_type","customerType"),s("referrer","referrer"),d("cooperation_started_at","cooperationStartedAt"),s("notes","notes"),n("version","version"),t("created_at","createdAt"),t("updated_at","updatedAt"));
    static final Table PAPERS = table("lw_paper", "id",s("id","id"),s("customer_id","customerId"),s("code","code"),s("title","title"),s("authors","authors"),s("service_type","serviceType"),n("contract_cents","contractCents"),n("contract_deposit_cents","contractDepositCents"),d("follow_up_at","followUpAt"),s("follow_up_reason","followUpReason"),s("notes","notes"),n("version","version"),t("created_at","createdAt"),t("updated_at","updatedAt"));
    static final Table WRITING = table("lw_writing_task", "id",s("id","id"),s("paper_id","paperId"),s("writer_name","writer"),s("status","writingStatus"),d("start_at","writingStartAt"),d("due_at","writingDueAt"),d("delivered_at","writingDeliveredAt"),n("fee_cents","writerFeeCents"),n("deposit_cents","writerDepositCents"),n("version","version"),t("created_at","createdAt"),t("updated_at","updatedAt"));
    static final Table SUBMISSIONS = table("lw_submission", "id",s("id","id"),s("paper_id","paperId"),s("title","title"),s("journal","journal"),s("system_name","submissionSystem"),s("system_url","submissionUrl"),s("status","status"),s("manuscript_id","manuscriptId"),d("submitted_at","submittedAt"),d("ended_at","endedAt"),d("published_at","publishedAt"),s("notes","notes"),n("sort_order","sortOrder"),n("version","version"),t("created_at","createdAt"),t("updated_at","updatedAt"));
    static final Table CREDENTIALS = table("lw_submission_credential", "submission_id",s("submission_id","id"),s("account_name","submissionAccount"),new Column("password_ciphertext","submissionPassword",Kind.SECRET),s("key_fingerprint","keyFingerprint"),s("bound_email","boundEmail"),s("bound_phone","boundPhone"),t("updated_at","updatedAt"));
    static final Table TRANSACTIONS = table("lw_financial_transaction", "id",s("id","id"),s("paper_id","paperId"),s("type","type"),n("amount_cents","amountCents"),d("occurred_at","date"),s("method","method"),s("note","note"),s("actor","actor"),s("reversal_of","reversalOf"),s("reversal_reason","reversalReason"),s("corrects_transaction_id","correctsTransactionId"),s("publication_account_id","publicationAccountId"),t("created_at","createdAt"));
    static final Table HISTORY = table("lw_paper_history", "id",s("id","id"),s("paper_id","paperId"),s("submission_ref","submissionId"),s("action","action"),s("status","status"),s("journal","journal"),s("system_name","submissionSystem"),s("system_url","submissionUrl"),d("submitted_at","submittedAt"),n("sort_order","sortOrder"),t("event_at","at"));
    static final Table CURRENT = table("lw_paper_current_submission", "paper_id",s("paper_id","paperId"),s("submission_id","submissionId"));
    static final Table FILES = table("lw_paper_file","id",s("id","id"),s("paper_id","paperId"),s("filename","filename"),n("size_bytes","size"),s("sha256","sha256"),n("revision","revision"),s("note","note"),s("purpose","purpose"),s("transaction_id","transactionId"),s("uploaded_by","uploadedBy"),t("uploaded_at","uploadedAt"));
    static final Table TERMINATIONS=table("lw_paper_service_termination","paper_id",s("paper_id","paperId"),d("terminated_at","terminatedAt"),s("reason","reason"),n("customer_cents","customerCents"),n("writer_cents","writerCents"),t("updated_at","updatedAt"));
    static final Table PUBLICATION_FEES=table("lw_paper_publication_fee","paper_id",s("paper_id","paperId"),s("mode","publicationFeeMode"),n("amount_cents","publicationFeeCents"),t("updated_at","updatedAt"));
    static final Table COST_ACCOUNTS=table("lw_publication_account","id",s("id","id"),s("paper_id","paperId"),s("submission_id","submissionId"),s("journal","journal"),s("mode","mode"),n("amount_cents","amountCents"),s("settlement_status","settlementStatus"),n("final_cents","finalCents"),s("legacy","legacy"),t("created_at","createdAt"),t("updated_at","updatedAt"));
    static final Table FINANCIAL_AUDIT=table("lw_financial_audit","id",s("id","id"),s("paper_id","paperId"),s("action","action"),s("actor","actor"),t("event_at","at"),s("transaction_id","transactionId"),s("reversal_of","reversalOf"),s("corrects_transaction_id","correctsTransactionId"),s("publication_account_id","publicationAccountId"),s("file_id","fileId"),s("type","type"),n("amount_cents","amountCents"),d("occurred_at","date"),s("method","method"),s("note","note"),s("reason","reason"));
    static final List<Table> TABLES = List.of(CUSTOMERS,PAPERS,WRITING,FILES,SUBMISSIONS,CREDENTIALS,COST_ACCOUNTS,TRANSACTIONS,FINANCIAL_AUDIT,HISTORY,CURRENT,TERMINATIONS,PUBLICATION_FEES);

    MysqlStateMapper(String workspace, DatabaseCrypto crypto) throws Exception { this.workspace=workspace;this.crypto=crypto;fingerprint=crypto.fingerprint(); }

    Map<String,Object> read(Connection connection, String username) throws Exception {
        Map<String,Object> state = new LinkedHashMap<>(); state.put("schema",2);state.put("username",username);
        List<Object> customers = new ArrayList<>(readTable(connection,CUSTOMERS,"updated_at,id"));state.put("customers",customers);
        List<Object> papers = new ArrayList<>(readTable(connection,PAPERS,"created_at,id"));state.put("papers",papers);
        Map<String,Map<String,Object>> byPaper = new LinkedHashMap<>(), bySubmission = new HashMap<>(), byCustomer = new HashMap<>();
        for(Object item:customers) { Map<String,Object> c=Json.object(item);byCustomer.put(Main.string(c,"id"),c); }
        for(Object item:papers) {
            Map<String,Object> p=Json.object(item);byPaper.put(Main.string(p,"id"),p);
            p.put("transactions",new ArrayList<>());p.put("history",new ArrayList<>());p.put("submissions",new ArrayList<>());p.put("files",new ArrayList<>());p.put("activeSubmissionId","");
            p.put("publicationFees",new ArrayList<>());p.put("financialAudit",new ArrayList<>());
            for(String field:List.of("writer","writingStartAt","writingDueAt","writingDeliveredAt"))p.put(field,"");
            p.put("writingStatus",BusinessService.hasWriting(p)?"待分配":"");p.put("writerFeeCents",0L);p.put("writerDepositCents",0L);
            String customerId=Main.string(p,"customerId");p.put("customer",customerId.isEmpty()?"":byCustomer.get(customerId).get("name"));
        }
        for(Map<String,Object> w:readTable(connection,WRITING,"paper_id")) {
            Map<String,Object> p=required(byPaper,Main.string(w,"paperId"));
            for(String field:List.of("writer","writingStatus","writingStartAt","writingDueAt","writingDeliveredAt","writerFeeCents","writerDepositCents"))p.put(field,w.get(field));
        }
        for(Map<String,Object> f:readTable(connection,FILES,"revision,id")) {
            String parent=Main.string(f,"paperId");f.remove("paperId");Json.array(required(byPaper,parent).get("files")).add(f);
        }
        for(Map<String,Object> sub:readTable(connection,SUBMISSIONS,"sort_order,id")) {
            String parent=Main.string(sub,"paperId"); sub.remove("paperId");sub.remove("sortOrder");
            Json.array(required(byPaper,parent).get("submissions")).add(sub);bySubmission.put(Main.string(sub,"id"),sub);
        }
        for(Map<String,Object> credential:readTable(connection,CREDENTIALS,"submission_id")) {
            Map<String,Object> sub=required(bySubmission,Main.string(credential,"id"));
            if(!fingerprint.equals(Main.string(credential,"keyFingerprint")))throw new IllegalStateException("投稿凭据密钥指纹不匹配");
            for(String field:List.of("submissionAccount","submissionPassword","boundEmail","boundPhone"))sub.put(field,credential.get(field));
        }
        for(Map<String,Object> tx:readTable(connection,TRANSACTIONS,"created_at,id")) {
            String parent=Main.string(tx,"paperId");tx.remove("paperId");Json.array(required(byPaper,parent).get("transactions")).add(tx);
        }
        for(Map<String,Object> event:readTable(connection,HISTORY,"sort_order,id")) {
            String parent=Main.string(event,"paperId");event.remove("paperId");event.remove("sortOrder");
            if(Main.string(event,"submissionId").isEmpty())event.remove("submissionId");
            Json.array(required(byPaper,parent).get("history")).add(event);
        }
        for(Map<String,Object> current:readTable(connection,CURRENT,"paper_id"))required(byPaper,Main.string(current,"paperId")).put("activeSubmissionId",current.get("submissionId"));
        for(Object item:papers)BusinessService.syncCurrent(Json.object(item));
        for(Map<String,Object> closure:readTable(connection,TERMINATIONS,"paper_id")) {
            String id=Main.string(closure,"paperId");closure.remove("paperId");required(byPaper,id).put("termination",closure);
        }
        for(Map<String,Object> fee:readTable(connection,PUBLICATION_FEES,"paper_id")) {
            Map<String,Object> paper=required(byPaper,Main.string(fee,"paperId"));
            paper.put("publicationFeeMode",fee.get("publicationFeeMode"));paper.put("publicationFeeCents",fee.get("publicationFeeCents"));
        }
        for(Map<String,Object> account:readTable(connection,COST_ACCOUNTS,"created_at,id")){String parent=Main.string(account,"paperId");account.remove("paperId");Json.array(required(byPaper,parent).get("publicationFees")).add(account);}
        for(Map<String,Object> event:readTable(connection,FINANCIAL_AUDIT,"event_at,id")){String parent=Main.string(event,"paperId");event.remove("paperId");Json.array(required(byPaper,parent).get("financialAudit")).add(event);}
        return state;
    }

    private List<Map<String,Object>> readTable(Connection connection, Table table, String order) throws Exception {
        String columns=String.join(",",table.columns.stream().map(c->"`"+c.sql+"`").toList());
        List<Map<String,Object>> rows=new ArrayList<>();
        try(PreparedStatement statement=connection.prepareStatement("SELECT "+columns+" FROM "+table.name+" WHERE workspace_id=? ORDER BY "+order)) {
            statement.setString(1,workspace);
            try(ResultSet rs=statement.executeQuery()) {
                while(rs.next()) {
                    Map<String,Object> row=new LinkedHashMap<>();String id=rs.getString(table.key);
                    for(Column column:table.columns) {
                        Object value=switch(column.kind) {
                            case NUMBER -> rs.getLong(column.sql);
                            case TIME -> { LocalDateTime time=rs.getObject(column.sql,LocalDateTime.class); yield time==null?"":time.toInstant(ZoneOffset.UTC).toString(); }
                            case DATE -> { java.sql.Date date=rs.getDate(column.sql);yield date==null?"":date.toLocalDate().toString(); }
                            case SECRET -> crypto.decrypt(id,Objects.toString(rs.getString(column.sql),""));
                            case TEXT -> Objects.toString(rs.getString(column.sql),"");
                        };
                        row.put(column.field,value);
                    }
                    rows.add(row);
                }
            }
        }
        return rows;
    }

    void writeChanges(Connection connection,Map<String,Object> before,Map<String,Object> after) throws Exception {
        Map<Table,Map<String,Row>> previous=flatten(before),next=flatten(after);
        // Child rows first; parent deletes also cascade, while customer references remain restricted.
        List<Table> reverse=new ArrayList<>(TABLES);Collections.reverse(reverse);
        for(Table table:reverse)if(table!=CUSTOMERS)for(Row row:previous.get(table).values())if(!next.get(table).containsKey(row.id)||(table==CURRENT&&!row.equals(next.get(table).get(row.id)))) {
            try(PreparedStatement statement=connection.prepareStatement("DELETE FROM "+table.name+" WHERE workspace_id=? AND `"+table.key+"`=?")) {
                statement.setString(1,workspace);statement.setString(2,row.id);statement.executeUpdate();
            }
        }
        for(Table table:TABLES)for(Row row:next.get(table).values())if(!row.equals(previous.get(table).get(row.id)))writeRow(connection,table,row,table!=CURRENT&&previous.get(table).containsKey(row.id));
        // Retained papers may have moved to another customer during restore. Remove old customers last.
        for(Row row:previous.get(CUSTOMERS).values())if(!next.get(CUSTOMERS).containsKey(row.id)) {
            try(PreparedStatement statement=connection.prepareStatement("DELETE FROM lw_customer WHERE workspace_id=? AND id=?")) {
                statement.setString(1,workspace);statement.setString(2,row.id);statement.executeUpdate();
            }
        }
    }

    private void writeRow(Connection connection,Table table,Row row,boolean existing) throws Exception {
        List<String> names=new ArrayList<>();names.add("workspace_id");names.addAll(table.columns.stream().map(Column::sql).toList());
        String columns=String.join(",",names.stream().map(n->"`"+n+"`").toList());
        String updates=String.join(",",table.columns.stream().map(c->"`"+c.sql+"`=?").toList());
        String sql=existing?"UPDATE "+table.name+" SET "+updates+" WHERE workspace_id=? AND `"+table.key+"`=?":"INSERT INTO "+table.name+" ("+columns+") VALUES ("+String.join(",",Collections.nCopies(names.size(),"?"))+")";
        try(PreparedStatement statement=connection.prepareStatement(sql)) {
            int index=1;if(!existing)statement.setString(index++,workspace);
            for(Column column:table.columns) {
                Object value=row.values.get(column.sql);
                if(value==null)statement.setNull(index, column.kind==Kind.DATE?Types.DATE:Types.VARCHAR);
                else switch(column.kind) {
                    case NUMBER -> statement.setLong(index,((Number)value).longValue());
                    case TIME -> statement.setObject(index,LocalDateTime.ofInstant((Instant)value,ZoneOffset.UTC));
                    case DATE -> statement.setObject(index,LocalDate.parse(value.toString()));
                    case SECRET -> statement.setString(index,crypto.encrypt(row.id,value.toString()));
                    case TEXT -> statement.setString(index,value.toString());
                }
                index++;
            }
            if(existing){statement.setString(index++,workspace);statement.setString(index,row.id);}
            statement.executeUpdate();
        }
    }

    private Map<Table,Map<String,Row>> flatten(Map<String,Object> state) {
        Map<Table,Map<String,Row>> result=new LinkedHashMap<>();for(Table table:TABLES)result.put(table,new LinkedHashMap<>());
        for(Object item:Json.array(state.get("customers")))add(result,CUSTOMERS,Json.object(item));
        for(Object item:Json.array(state.get("papers"))) {
            Map<String,Object> paper=new LinkedHashMap<>(Json.object(item));paper.put("serviceType",BusinessService.serviceType(paper));
            String id=Main.string(paper,"id");add(result,PAPERS,paper);
            if(paper.containsKey("publicationFeeMode")) { Map<String,Object> fee=new LinkedHashMap<>(paper);fee.put("paperId",id);add(result,PUBLICATION_FEES,fee); }
            for(Object itemAccount:PublicationFees.accounts(paper)){Map<String,Object> account=new LinkedHashMap<>(Json.object(itemAccount));account.put("paperId",id);add(result,COST_ACCOUNTS,account);}
            for(Object itemAudit:FinancialLedger.audits(paper)){Map<String,Object> audit=new LinkedHashMap<>(Json.object(itemAudit));audit.put("paperId",id);add(result,FINANCIAL_AUDIT,audit);}
            if(ServiceTermination.ended(paper)) { Map<String,Object> closure=new LinkedHashMap<>(Json.object(paper.get("termination")));closure.put("paperId",id);add(result,TERMINATIONS,closure); }
            for(Object file:AttachmentService.files(paper)) { Map<String,Object> f=new LinkedHashMap<>(Json.object(file));f.put("paperId",id);add(result,FILES,f); }
            if(BusinessService.hasWriting(paper)) { Map<String,Object> writing=new LinkedHashMap<>(paper);writing.put("paperId",id);add(result,WRITING,writing); }
            int position=0;
            for(Object subItem:Json.array(paper.get("submissions"))) {
                Map<String,Object> sub=new LinkedHashMap<>(Json.object(subItem));sub.put("paperId",id);sub.put("sortOrder",position++);add(result,SUBMISSIONS,sub);
                sub.put("keyFingerprint",fingerprint);add(result,CREDENTIALS,sub);
            }
            for(Object txItem:Json.array(paper.get("transactions"))) { Map<String,Object> tx=new LinkedHashMap<>(Json.object(txItem));tx.put("paperId",id);add(result,TRANSACTIONS,tx); }
            position=0;
            for(Object eventItem:Json.array(paper.get("history"))) {
                Map<String,Object> event=new LinkedHashMap<>(Json.object(eventItem));event.put("paperId",id);event.put("sortOrder",position);
                String stable=Main.string(event,"id");
                if(stable.isEmpty())stable=UUID.nameUUIDFromBytes((id+":"+position+":"+Instant.parse(Main.string(event,"at")).truncatedTo(ChronoUnit.MICROS)).getBytes(StandardCharsets.UTF_8)).toString();
                event.put("id",stable);add(result,HISTORY,event);position++;
            }
            if(!Main.string(paper,"activeSubmissionId").isEmpty())add(result,CURRENT,Map.of("paperId",id,"submissionId",paper.get("activeSubmissionId")));
        }
        return result;
    }

    private static void add(Map<Table,Map<String,Row>> output,Table table,Map<String,Object> source) {
        Map<String,Object> values=new LinkedHashMap<>();String key="";
        for(Column column:table.columns) {
            Object value=switch(column.kind) {
                case NUMBER -> PaperService.number(source.getOrDefault(column.field,0));
                case TIME -> Instant.parse(Main.string(source,column.field)).truncatedTo(ChronoUnit.MICROS);
                default -> Main.string(source,column.field);
            };
            if(column.sql.equals(table.key))key=value.toString();
            if((column.kind==Kind.DATE||Set.of("customer_id","submission_ref","submission_id","transaction_id","reversal_of","corrects_transaction_id","publication_account_id","file_id").contains(column.sql))&&value.toString().isEmpty())value=null;
            values.put(column.sql,value);
        }
        if(key.isEmpty()||output.get(table).put(key,new Row(key,values))!=null)throw new IllegalArgumentException("Duplicate or empty entity ID in "+table.name);
    }
    private static Map<String,Object> required(Map<String,Map<String,Object>> values,String id) {
        Map<String,Object> value=values.get(id);if(value==null)throw new IllegalStateException("数据库关联记录缺失");return value;
    }
}
