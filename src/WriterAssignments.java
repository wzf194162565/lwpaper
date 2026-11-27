import java.util.*;

/** Stable identities for writing engagements and their ledger entries. */
final class WriterAssignments {
    static final Set<String> TYPES=Set.of("outgoing_deposit","outgoing_balance","outgoing_settlement","incoming_writer_refund");
    static List<Object> all(Map<String,Object> p) { return Json.array(p.getOrDefault("writerAssignments",List.of())); }
    static Map<String,Object> current(Map<String,Object> p) {
        for(Object o:all(p)){Map<String,Object>a=Json.object(o);if(Main.string(a,"id").equals(Main.string(p,"writerAssignmentId")))return a;}return null;
    }
    static Map<String,Object> find(Map<String,Object> p,String id) {
        for(Object o:all(p)){Map<String,Object>a=Json.object(o);if(Main.string(a,"id").equals(id))return a;}throw new ApiException(400,"写作安排不存在");
    }
    static void initialize(Map<String,Object> p) {
        if(!BusinessService.hasWriting(p)||current(p)!=null)return;
        p.put("writerAssignments",new ArrayList<>());add(p);
        for(Object o:Json.array(p.get("transactions"))){Map<String,Object>tx=Json.object(o);if(TYPES.contains(Main.string(tx,"type")))stamp(tx,current(p));}
    }
    static void add(Map<String,Object> p) {
        Map<String,Object>a=new LinkedHashMap<>();a.put("id",UUID.randomUUID().toString());a.put("createdAt",PaperService.now());a.put("closedAt","");a.put("reason","");
        p.put("writerAssignmentId",a.get("id"));all(p).add(a);refresh(p);
    }
    static void refresh(Map<String,Object> p) {
        Map<String,Object>a=current(p);if(a==null)return;
        for(String k:List.of("writerId","writer","writerFeeCents","writerDepositCents","writingStatus","writingStartAt","writingDueAt","writingDeliveredAt"))a.put(k,p.getOrDefault(k,k.endsWith("Cents")?0L:""));
    }
    static void stamp(Map<String,Object>tx,Map<String,Object>a) {
        tx.put("writerAssignmentId",a.get("id"));tx.put("writerId",a.get("writerId"));tx.put("writerName",a.get("writer"));
    }
    static long paid(Map<String,Object>p,Map<String,Object>a,String type) {
        long total=0;for(Object o:Json.array(p.get("transactions"))){Map<String,Object>tx=Json.object(o);if(Main.string(tx,"writerAssignmentId").equals(Main.string(a,"id"))&&(type==null?TYPES.contains(Main.string(tx,"type")):type.equals(Main.string(tx,"type"))))total+=FinancialLedger.signed(tx)*(Main.string(tx,"type").equals("incoming_writer_refund")?-1:1);}return total;
    }
    static long previousFees(Map<String,Object>p) {long total=0;for(Object o:all(p)){Map<String,Object>a=Json.object(o);if(a!=current(p))total+=PaperService.number(a.get("finalCents"));}return total;}
    static long target(Map<String,Object>p,Map<String,Object>a) {
        if(a!=current(p))return PaperService.number(a.get("finalCents"));
        return ServiceTermination.ended(p)?PaperService.number(Json.object(p.get("termination")).get("writerCents"))-previousFees(p):PaperService.number(p.get("writerFeeCents"));
    }
    static void bind(Map<String,Object>p,Map<String,Object>input,Map<String,Object>tx) {
        if(!TYPES.contains(Main.string(tx,"type"))||current(p)==null)return;
        String id=Main.string(input,"writerAssignmentId");Map<String,Object>a=id.isEmpty()?current(p):find(p,id);stamp(tx,a);
        String type=Main.string(tx,"type");long net=paid(p,a,null),target=target(p,a),limit;
        if(type.equals("incoming_writer_refund"))limit=net-target;
        else {limit=target-net;if(a==current(p)&&!ServiceTermination.ended(p)&&PaperService.number(a.get("writerDepositCents"))>0){long deposit=PaperService.number(a.get("writerDepositCents"));limit=Math.min(limit,(type.equals("outgoing_deposit")?deposit:target-deposit)-paid(p,a,type));}}
        if(PaperService.number(tx.get("amountCents"))>Math.max(0,limit))throw new ApiException(400,"金额超过该写作者本次安排的待付或待追回金额");
    }
    static List<Object> views(Map<String,Object>p) {
        List<Object>rows=new ArrayList<>();for(Object o:all(p)){Map<String,Object>a=Json.object(o),v=new LinkedHashMap<>(a);long target=target(p,a),paid=paid(p,a,null);v.put("current",a==current(p));v.put("targetCents",target);v.put("paidCents",paid);v.put("payableCents",Math.max(0,target-paid));v.put("recoverableCents",Math.max(0,paid-target));rows.add(v);}return rows;
    }
    static void validate(Map<String,Object>s,Set<String>writers) {
        for(Object o:Json.array(s.get("papers"))){Map<String,Object>p=Json.object(o);if(!p.containsKey("writerAssignments"))continue;
            Set<String>ids=new HashSet<>();for(Object item:all(p)){Map<String,Object>a=Json.object(item);UUID.fromString(Main.string(a,"id"));if(!ids.add(Main.string(a,"id")))throw new IllegalArgumentException();String w=Main.string(a,"writerId");if(!w.isEmpty()&&!writers.contains(w))throw new IllegalArgumentException("Unknown writer");if(a!=current(p)&&PaperService.number(a.get("finalCents"))<0)throw new IllegalArgumentException();}
            if(BusinessService.hasWriting(p)&&(current(p)==null||!Main.string(p,"writerId").equals(Main.string(current(p),"writerId"))))throw new IllegalArgumentException("Missing current assignment");
            for(Object item:Json.array(p.get("transactions"))){Map<String,Object>tx=Json.object(item);if(TYPES.contains(Main.string(tx,"type"))){Map<String,Object>a=find(p,Main.string(tx,"writerAssignmentId"));if(!Main.string(a,"writerId").equals(Main.string(tx,"writerId")))throw new IllegalArgumentException("Wrong payment owner");}}
        }
    }
}
