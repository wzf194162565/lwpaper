import java.time.*;
import java.util.*;

/** Service closure is independent of editorial progress and actual cash movements. */
final class ServiceTermination {
    static final Set<String> SETTLEMENT_TYPES = Set.of("incoming_settlement", "outgoing_refund", "outgoing_settlement", "incoming_writer_refund");
    static boolean ended(Map<String,Object> paper) { return paper.get("termination") instanceof Map<?,?>; }
    static void requireActive(Map<String,Object> paper) {
        if (ended(paper)) throw new ApiException(409,"这篇论文的服务已终止，可查看历史、调整结算和登记实际收支");
    }
    static long total(Map<String,Object> paper,String type) { return WriterPayments.paid(paper,type); }
    static long customerNet(Map<String,Object> paper) {
        return total(paper,"incoming_deposit")+total(paper,"incoming_balance")+total(paper,"incoming_settlement")-total(paper,"outgoing_refund");
    }
    static long writerNet(Map<String,Object> paper) {
        return total(paper,"outgoing_deposit")+total(paper,"outgoing_balance")+total(paper,"outgoing_settlement")-total(paper,"incoming_writer_refund");
    }
    static long customerTarget(Map<String,Object> paper) {
        return PaperService.number(ended(paper)?Json.object(paper.get("termination")).get("customerCents"):paper.get("contractCents"));
    }
    static long writerTarget(Map<String,Object> paper) {
        return PaperService.number(ended(paper)?Json.object(paper.get("termination")).get("writerCents"):paper.get("writerFeeCents"));
    }
    static void validateLedger(Map<String,Object> paper) {
        if(customerNet(paper)<0||writerNet(paper)<0||PublicationFees.paid(paper)<0)throw new ApiException(400,"退款或退回款项不能超过对应的累计实际收付款");
    }
    static void validateTransaction(Map<String,Object> paper,Map<String,Object> input,Map<String,Object> tx) {
        String type=Main.string(tx,"type");
        if(!SETTLEMENT_TYPES.contains(type)) {
            if(ended(paper)&&Set.of("incoming_deposit","incoming_balance","outgoing_deposit","outgoing_balance").contains(type))
                throw new ApiException(400,"服务已终止，请使用终止结算的收款、退款或稿酬类型");
            return;
        }
        if(!ended(paper))throw new ApiException(400,"请先登记终止服务及最终结算金额");
        if(!Boolean.TRUE.equals(input.get("confirmSettlementPayment")))throw new ApiException(400,"请确认这笔款项已经实际收付");
        if(!BusinessService.hasWriting(paper)&&Set.of("outgoing_settlement","incoming_writer_refund").contains(type))throw new ApiException(400,"半包论文没有写作稿酬结算");
        long customer=customerNet(paper),writer=writerNet(paper);
        long remaining=switch(type) {
            case "incoming_settlement" -> customerTarget(paper)-customer;
            case "outgoing_refund" -> customer-customerTarget(paper);
            case "outgoing_settlement" -> writerTarget(paper)-writer;
            default -> writer-writerTarget(paper);
        };
        if(PaperService.number(tx.get("amountCents"))>Math.max(0,remaining))throw new ApiException(400,"本次金额不能超过对应的剩余结算金额，请核对流水");
    }
    static void close(Map<String,Object> paper,Map<String,Object> input,boolean revision) {
        if(ended(paper)!=revision)throw new ApiException(409,revision?"这篇论文尚未终止服务":"这篇论文已经终止服务，请调整结算，勿重复终止");
        if(!Boolean.TRUE.equals(input.get("confirmTermination")))throw new ApiException(400,"请确认终止服务及最终结算金额");
        Map<String,Object> next=new LinkedHashMap<>();
        String date=PaperService.date(input,"terminatedAt"),reason=PaperService.text(input,"terminationReason",1000);
        if(date.isEmpty()||date.compareTo(LocalDate.now().toString())>0||date.compareTo(Main.string(paper,"createdAt").substring(0,10))<0)
            throw new ApiException(400,"终止日期应在论文建档日期与今天之间");
        if(reason.isEmpty())throw new ApiException(400,"请填写终止原因");
        for(String field:List.of("customerSettlement","writerSettlement"))if(!(input.get(field) instanceof String s)||s.isBlank())throw new ApiException(400,"请明确填写客户及写作者的最终结算金额，可填 0");
        long customer=PaperService.money(input,"customerSettlement"),writer=PaperService.money(input,"writerSettlement");
        if(customer>PaperService.number(paper.get("contractCents")))throw new ApiException(400,"客户最终结算金额不能超过原服务费用");
        if(writer>PaperService.number(paper.get("writerFeeCents"))||(!BusinessService.hasWriting(paper)&&writer!=0))throw new ApiException(400,"写作者最终结算金额不能超过原稿酬，半包应为 0");
        next.put("terminatedAt",date);next.put("reason",reason);next.put("customerCents",customer);next.put("writerCents",writer);next.put("updatedAt",PaperService.now());
        paper.put("termination",next);PaperService.touch(paper);
        Map<String,Object> event=new LinkedHashMap<>();event.put("at",PaperService.now());
        event.put("action",(revision?"调整终止结算":"终止服务")+" · 客户 "+customer+" 分 · 稿酬 "+writer+" 分 · "+reason.substring(0,Math.min(80,reason.length())));
        for(String key:List.of("status","journal","submissionSystem","submissionUrl","submittedAt"))event.put(key,paper.get(key));
        Json.array(paper.get("history")).add(event);
    }
    static void enrich(Map<String,Object> paper,Map<String,Object> result) {
        long customer=customerNet(paper),writer=writerNet(paper),target=customerTarget(paper),fee=writerTarget(paper);
        result.put("serviceStatus",ended(paper)?"terminated":"active");
        result.put("settlementContractCents",target);result.put("settlementWriterFeeCents",fee);
        result.put("contractReceivedCents",customer);result.put("writerPaidCents",writer);
        result.put("customerRefundedCents",total(paper,"outgoing_refund"));result.put("writerRefundedCents",total(paper,"incoming_writer_refund"));
        result.put("receivableCents",Math.max(0,target-customer));result.put("payableCents",Math.max(0,fee-writer));
        long refund=ended(paper)?Math.max(0,customer-target):0,recovery=ended(paper)?Math.max(0,writer-fee):0;
        result.put("refundableCents",refund);result.put("recoverableCents",recovery);
        result.put("settlementComplete",ended(paper)&&customer==target&&writer==fee);
        if(ended(paper))result.put("writingOverdue",false);
    }
    static void validateStored(Map<String,Object> paper) {
        if(!paper.containsKey("termination")) {
            for(Object item:Json.array(paper.get("transactions")))if(SETTLEMENT_TYPES.contains(Main.string(Json.object(item),"type")))throw new IllegalArgumentException();
            return;
        }
        Map<String,Object> closure=Json.object(paper.get("termination"));
        String date=PaperService.date(closure,"terminatedAt");
        if(date.isEmpty()||PaperService.text(closure,"reason",1000).isEmpty())throw new IllegalArgumentException();
        Instant.parse(Main.string(closure,"updatedAt"));
        long customer=PaperService.number(closure.get("customerCents")),writer=PaperService.number(closure.get("writerCents"));
        if(customer<0||customer>PaperService.number(paper.get("contractCents"))||writer<0||writer>PaperService.number(paper.get("writerFeeCents"))||(!BusinessService.hasWriting(paper)&&writer!=0))throw new IllegalArgumentException();
        validateLedger(paper);
    }
}
