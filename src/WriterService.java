import java.util.*;

/** Account-scoped writer profiles; names remain compatible with existing paper records. */
public final class WriterService {
    private final ApplicationStore store;
    public WriterService(ApplicationStore store) { this.store=store; }
    static List<Object> profiles(Map<String,Object> state) {
        return Json.array(state.getOrDefault("writers",List.of()));
    }
    static String nameKey(String name) { return name.strip().toLowerCase(Locale.ROOT); }
    static boolean deleted(Map<String,Object> profile) { return !Main.string(profile,"deletedAt").isEmpty(); }
    static boolean needsSync(Map<String,Object> state) {
        for(Object item:Json.array(state.get("papers"))) {
            Map<String,Object> p=Json.object(item);String name=Main.string(p,"writer").strip();
            if(BusinessService.hasWriting(p)&&(!p.containsKey("writerAssignments")||(!name.isEmpty()&&Main.string(p,"writerId").isEmpty())))return true;
        }
        return false;
    }
    static void sync(Map<String,Object> state) {
        if(!state.containsKey("writers"))state.put("writers",new ArrayList<>());
        Map<String,Map<String,Object>> byName=new HashMap<>();
        for(Object item:profiles(state)){Map<String,Object>w=Json.object(item);if(!deleted(w))byName.put(nameKey(Main.string(w,"name")),w);}
        for(Object item:Json.array(state.get("papers"))) {
            Map<String,Object> p=Json.object(item);String name=Main.string(p,"writer").strip();
            if(BusinessService.hasWriting(p)) {
                // Existing IDs, including deleted profiles, own their historical assignments.
                if(!name.isEmpty()&&Main.string(p,"writerId").isEmpty()) {
                    Map<String,Object>w=byName.get(nameKey(name));
                    if(w==null){w=newProfile(Map.of("name",name));profiles(state).add(w);byName.put(nameKey(name),w);}
                    p.put("writerId",w.get("id"));
                }
                WriterAssignments.initialize(p);
            }
        }
        if(profiles(state).size()>10000)throw new ApiException(400,"写作者数量已达到上限");
    }
    private void ensure() throws Exception {
        synchronized(store) { if(needsSync(store.read()))store.mutate(state->{sync(state);return null;}); }
    }
    public List<Object> list() throws Exception {
        ensure();Map<String,Object> state=store.read();List<Object> result=new ArrayList<>();
        for(Object item:profiles(state))if(!deleted(Json.object(item)))result.add(summary(Json.object(item),state,false));
        result.sort(Comparator.comparing(o->Main.string(Json.object(o),"name")));return result;
    }
    public Map<String,Object> get(String id) throws Exception { ensure();Map<String,Object>s=store.read();return summary(find(s,id),s,true); }
    static Map<String,Object> find(Map<String,Object>s,String id) {
        for(Object item:profiles(s))if(!deleted(Json.object(item))&&Main.string(Json.object(item),"id").equals(id))return Json.object(item);
        throw new ApiException(404,"写作者不存在");
    }
    private static Map<String,Object> fields(Map<String,Object> input) {
        Map<String,Object> value=new LinkedHashMap<>();
        for(String key:List.of("name","phone","email","wechat","specialties","notes"))value.put(key,PaperService.text(input,key,key.equals("notes")?5000:key.equals("specialties")?1000:200).strip());
        if(Main.string(value,"name").isEmpty())throw new ApiException(400,"请填写写作者姓名");
        String email=Main.string(value,"email");if(!email.isEmpty())SmtpMailer.email(email);
        String status=input.containsKey("status")?PaperService.text(input,"status",20):"active";
        if(!Set.of("active","paused","archived").contains(status))throw new ApiException(400,"请选择有效合作状态");
        value.put("status",status);return value;
    }
    private static Map<String,Object> newProfile(Map<String,Object> input) {
        Map<String,Object> p=fields(input);p.put("id",UUID.randomUUID().toString());p.put("version",1);
        p.put("createdAt",PaperService.now());p.put("updatedAt",PaperService.now());return p;
    }
    private static void unique(Map<String,Object>s,String name,String except) {
        for(Object item:profiles(s)){Map<String,Object> p=Json.object(item);if(!deleted(p)&&!Main.string(p,"id").equals(except)&&nameKey(Main.string(p,"name")).equals(nameKey(name)))throw new ApiException(409,"写作者姓名已存在；同名人员请在姓名中增加区分标记");}
    }
    public Map<String,Object> create(Map<String,Object> input) throws Exception {
        return store.mutate(s->{sync(s);if(profiles(s).size()>=10000)throw new ApiException(400,"写作者数量已达到上限");Map<String,Object> p=newProfile(input);unique(s,Main.string(p,"name"),"");profiles(s).add(p);return summary(p,s,true);});
    }
    public Map<String,Object> update(String id,Map<String,Object> input) throws Exception {
        return store.mutate(s->{sync(s);Map<String,Object> p=find(s,id);PaperService.checkVersion(p,input);
            Map<String,Object> merged=new LinkedHashMap<>(p);merged.putAll(input);Map<String,Object> next=fields(merged);
            String name=Main.string(next,"name");unique(s,name,id);
            for(Object item:Json.array(s.get("papers"))){
                Map<String,Object> paper=Json.object(item);
                if(!id.equals(Main.string(paper,"writerId")))continue;
                Map<String,Object> assignment=WriterAssignments.current(paper);
                if(!Main.string(paper,"writer").equals(name)||(assignment!=null&&!Main.string(assignment,"writer").equals(name))){
                    paper.put("writer",name);WriterAssignments.refresh(paper);PaperService.touch(paper);
                }
            }
            p.putAll(next);PaperService.touch(p);return summary(p,s,true);});
    }
    public List<String> delete(String id,Map<String,Object> input) throws Exception {
        synchronized(store) {
            List<Map<String,Object>> files=new ArrayList<>();
            List<String> removed=store.mutate(s->{sync(s);Map<String,Object> p=find(s,id);PaperService.checkVersion(p,input);
                List<Map<String,Object>> papers=linked(p,s);
                if(!papers.isEmpty()&&!Boolean.TRUE.equals(input.get("confirmCascadeDelete")))
                    throw new ApiException(409,"删除此写作者将同时清除全部关联论文及其投稿、写作安排、跟进、收支、稿件和凭证，请确认后重试");
                List<String> ids=new ArrayList<>();
                for(Map<String,Object> paper:papers){ids.add(Main.string(paper,"id"));files.addAll(AttachmentService.files(paper).stream().map(Json::object).toList());}
                Set<String> removedIds=new HashSet<>(ids);
                Json.array(s.get("papers")).removeIf(item->removedIds.contains(Main.string(Json.object(item),"id")));
                profiles(s).remove(p);return ids;
            });
            new AttachmentService(store).removeBlobs(files);
            return removed;
        }
    }
    private static List<Map<String,Object>> linked(Map<String,Object>p,Map<String,Object>s) {
        String id=Main.string(p,"id");List<Map<String,Object>> result=new ArrayList<>();
        for(Object item:Json.array(s.get("papers"))){Map<String,Object> paper=Json.object(item);if(id.equals(Main.string(paper,"writerId"))||WriterAssignments.all(paper).stream().map(Json::object).anyMatch(a->id.equals(Main.string(a,"writerId"))))result.add(paper);}return result;
    }
    private static Map<String,Object> summary(Map<String,Object> p,Map<String,Object>s,boolean detail) {
        Map<String,Object> result=new LinkedHashMap<>(p);List<Object> papers=new ArrayList<>();long agreed=0,paid=0,payable=0,recoverable=0;int active=0,delivered=0,overdue=0;
        for(Map<String,Object> paper:linked(p,s)) {
            Map<String,Object> v=PaperService.publicPaper(paper,false,s);
            long writerAgreed=0,writerPaid=0,writerPayable=0,writerRecovery=0;boolean current=false;
            List<Object> engagements=new ArrayList<>();
            for(Object o:WriterAssignments.views(paper)){Map<String,Object>a=Json.object(o);if(!Main.string(a,"writerId").equals(Main.string(p,"id")))continue;engagements.add(a);current|=Boolean.TRUE.equals(a.get("current"));writerAgreed+=PaperService.number(a.get("targetCents"));writerPaid+=PaperService.number(a.get("paidCents"));writerPayable+=PaperService.number(a.get("payableCents"));writerRecovery+=PaperService.number(a.get("recoverableCents"));}
            v.put("writerAssignments",engagements);v.put("writerFeeCents",writerAgreed);v.put("settlementWriterFeeCents",writerAgreed);v.put("writerPaidCents",writerPaid);v.put("payableCents",writerPayable);v.put("recoverableCents",writerRecovery);v.put("writerCurrent",current);papers.add(v);
            if(!current&&!engagements.isEmpty()) {
                Map<String,Object>last=Json.object(engagements.get(engagements.size()-1));
                for(String key:List.of("writerId","writer","writingStatus","writingStartAt","writingDueAt","writingDeliveredAt"))v.put(key,last.getOrDefault(key,""));
                v.put("writingOverdue",false);
            }
            boolean ended=ServiceTermination.ended(paper);String status=Main.string(v,"writingStatus");
            if(current&&!ended&&!Set.of("已交稿","已完成","已取消").contains(status))active++;
            if(engagements.stream().map(Json::object).anyMatch(a->Set.of("已交稿","已完成").contains(Main.string(a,"writingStatus"))))delivered++;
            if(current&&!ended&&Boolean.TRUE.equals(v.get("writingOverdue")))overdue++;
            agreed+=PaperService.number(v.get(ended?"settlementWriterFeeCents":"writerFeeCents"));
            paid+=PaperService.number(v.get("writerPaidCents"));payable+=PaperService.number(v.get("payableCents"));recoverable+=PaperService.number(v.get("recoverableCents"));
        }
        result.put("paperCount",papers.size());result.put("activeCount",active);result.put("deliveredCount",delivered);result.put("overdueCount",overdue);
        result.put("agreedCents",agreed);result.put("paidCents",paid);result.put("payableCents",payable);result.put("recoverableCents",recoverable);if(detail)result.put("papers",papers);return result;
    }
    static void validate(Map<String,Object>s) {
        Set<String> ids=new HashSet<>(),names=new HashSet<>();if(profiles(s).size()>10000)throw new IllegalArgumentException();
        for(Object item:profiles(s)){
            Map<String,Object> p=Json.object(item);fields(p);UUID.fromString(Main.string(p,"id"));
            if(!ids.add(Main.string(p,"id"))||(!deleted(p)&&!names.add(nameKey(Main.string(p,"name"))))||PaperService.number(p.get("version"))<1)throw new IllegalArgumentException();
            if(deleted(p)){java.time.Instant.parse(Main.string(p,"deletedAt"));if(!Main.string(p,"status").equals("archived"))throw new IllegalArgumentException();}
        }
        WriterAssignments.validate(s,ids);
    }
    static void resolve(Map<String,Object>s,Map<String,Object>p,Map<String,Object>input) {
        if(!BusinessService.hasWriting(p))return;
        if(input.containsKey("writerId")) {
            String id=PaperService.text(input,"writerId",36);p.put("writerId",id);p.put("writer",id.isEmpty()?"":find(s,id).get("name"));
        } else if(!p.containsKey("writerAssignments")) {
            String name=Main.string(p,"writer").strip();
            if(!name.isEmpty()){Map<String,Object>w=null;for(Object o:profiles(s))if(!deleted(Json.object(o))&&nameKey(Main.string(Json.object(o),"name")).equals(nameKey(name)))w=Json.object(o);if(w==null){w=newProfile(Map.of("name",name));profiles(s).add(w);}p.put("writerId",w.get("id"));}
        }
    }
}
