import java.util.*;

/** Publication fees are a separate paper cost; author-paid fees never enter our ledger. */
final class PublicationFees {
    static final Set<String> MODES=Set.of("pending","included","free","author");
    static String mode(Map<String,Object> paper) { return paper.containsKey("publicationFeeMode")?Main.string(paper,"publicationFeeMode"):"pending"; }
    static long amount(Map<String,Object> paper) { return PaperService.number(paper.getOrDefault("publicationFeeCents",0)); }
    static long paid(Map<String,Object> paper) { return WriterPayments.paid(paper,"outgoing_publication")-WriterPayments.paid(paper,"incoming_publication_refund"); }
    static boolean hasTerms(Map<String,Object> input) { return input.containsKey("publicationFeeMode")||input.containsKey("publicationFeeAmount"); }
    static void updateWithSubmission(Map<String,Object> input,Map<String,Object> paper,boolean required) {
        if(!hasTerms(input)) {
            if(!required)return;
            input=Map.of("publicationFeeMode","pending");
        }
        Map<String,Object> next=new LinkedHashMap<>();applyTerms(input,paper,next);
        recordChange(paper,next);paper.putAll(next);
    }
    static void recordChange(Map<String,Object> paper,Map<String,Object> next) {
        if(mode(paper).equals(mode(next))&&amount(paper)==amount(next))return;
        Map<String,Object> event=new LinkedHashMap<>();event.put("at",PaperService.now());
        event.put("action","更新版面费约定："+description(paper)+" → "+description(next));
        for(String field:List.of("status","journal","submissionSystem","submissionUrl","submittedAt"))event.put(field,paper.get(field));
        Json.array(paper.get("history")).add(event);
    }
    static String description(Map<String,Object> terms) {
        return switch(mode(terms)) {
            case "included" -> "我方承担 "+java.math.BigDecimal.valueOf(amount(terms),2).toPlainString()+" 元";
            case "free" -> "无版面费";
            case "author" -> "作者自理版面费";
            default -> "版面费待确认";
        };
    }
    static void applyTerms(Map<String,Object> input,Map<String,Object> previous,Map<String,Object> result) {
        String mode=input.containsKey("publicationFeeMode")?PaperService.text(input,"publicationFeeMode",16):mode(previous);
        if(!MODES.contains(mode))throw new ApiException(400,"请选择有效的版面费承担方式");
        long amount=mode.equals("included")?(input.containsKey("publicationFeeAmount")?PaperService.money(input,"publicationFeeAmount"):amount(previous)):0;
        if(mode.equals("included")&&amount<=0)throw new ApiException(400,"请填写我方承担的版面费金额；尚未确定请选择待确认，无版面费请选择无版面费");
        result.put("publicationFeeMode",mode);result.put("publicationFeeCents",amount);
    }
    static void validateTransaction(Map<String,Object> paper,Map<String,Object> input,Map<String,Object> tx) {
        String type=Main.string(tx,"type");
        if(!Set.of("outgoing_publication","incoming_publication_refund").contains(type))return;
        if(!Boolean.TRUE.equals(input.get("confirmPublicationPayment")))throw new ApiException(400,"请确认这笔版面费已经实际支付或退回");
        if(type.equals("outgoing_publication")&&!mode(paper).equals("included"))throw new ApiException(400,"只有我方承担版面费时才能登记支付，作者自理不计入我方流水");
        long limit=type.equals("outgoing_publication")?amount(paper)-paid(paper):paid(paper);
        if(PaperService.number(tx.get("amountCents"))>Math.max(0,limit))throw new ApiException(400,"本次版面费金额不能超过剩余应付或已实际支付的金额");
    }
    static void validateStored(Map<String,Object> paper) {
        String mode=mode(paper);long amount=amount(paper);
        if(!MODES.contains(mode)||amount<0||amount>100000000L||(!mode.equals("included")&&amount!=0)||paid(paper)<0)throw new IllegalArgumentException();
    }
    static void enrich(Map<String,Object> paper,Map<String,Object> result) {
        String mode=mode(paper);long fee=amount(paper),paid=paid(paper);
        result.put("publicationFeeMode",mode);result.put("publicationFeeCents",fee);
        result.put("publicationPaidCents",paid);result.put("publicationRefundedCents",WriterPayments.paid(paper,"incoming_publication_refund"));
        boolean known=!mode.equals("pending");
        result.put("publicationPayableCents",known?Math.max(0,fee-paid):0L);result.put("publicationRefundableCents",known?Math.max(0,paid-fee):0L);
        long profit=ServiceTermination.customerTarget(paper)-ServiceTermination.writerTarget(paper)-fee+
                    WriterPayments.paid(paper,"incoming_other")-WriterPayments.paid(paper,"outgoing_other");
        boolean settled=known&&ServiceTermination.customerNet(paper)==ServiceTermination.customerTarget(paper)&&
                ServiceTermination.writerNet(paper)==ServiceTermination.writerTarget(paper)&&paid==fee;
        result.put("profitEstimateKnown",known);result.put("estimatedProfitCents",known?profit:null);
        result.put("profitSettled",settled);result.put("settledProfitCents",settled?profit:null);
        if(ServiceTermination.ended(paper))result.put("settlementComplete",Boolean.TRUE.equals(result.get("settlementComplete"))&&known&&paid==fee);
    }
}
