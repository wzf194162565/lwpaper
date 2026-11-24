import java.util.*;

/** New payments must fit the remaining agreement; existing ledgers stay readable. */
final class FinancialRules {
    static long remaining(Map<String,Object> paper,String type) {
        boolean customer=Set.of("incoming_deposit","incoming_balance").contains(type);
        boolean writer=Set.of("outgoing_deposit","outgoing_balance").contains(type);
        if(!customer&&!writer)return Long.MAX_VALUE;
        long target=PaperService.number(paper.get(customer?"contractCents":"writerFeeCents"));
        long paid=customer?ServiceTermination.customerNet(paper):ServiceTermination.writerNet(paper);
        long remaining=target-paid;
        long deposit=PaperService.number(paper.getOrDefault(customer?"contractDepositCents":"writerDepositCents",0));
        // A zero deposit on an older record means no installment split was recorded.
        if(deposit>0) {
            long installment=type.endsWith("_deposit")?deposit:target-deposit;
            remaining=Math.min(remaining,installment-WriterPayments.paid(paper,type));
        }
        return Math.max(0,remaining);
    }
    static void validateTransaction(Map<String,Object> paper,Map<String,Object> transaction) {
        String type=Main.string(transaction,"type");
        long limit=remaining(paper,type);
        if(PaperService.number(transaction.get("amountCents"))>limit)
            throw new ApiException(400,"本次收付金额不能超过对应的剩余约定金额，请核对费用和已登记流水");
    }
    static void validateCustomerTerms(Map<String,Object> paper,Map<String,Object> next) {
        long total=PaperService.number(next.get("contractCents")),previous=PaperService.number(paper.get("contractCents"));
        if(total!=previous&&total<ServiceTermination.customerNet(paper))
            throw new ApiException(400,"服务费用不能低于累计已收服务款；终止合作请使用终止服务结算");
        long deposit=PaperService.number(next.get("contractDepositCents")),oldDeposit=PaperService.number(paper.getOrDefault("contractDepositCents",0));
        if(deposit>0&&(deposit!=oldDeposit||total!=previous)) {
            if(deposit<WriterPayments.paid(paper,"incoming_deposit"))throw new ApiException(400,"约定收款定金不能低于累计已收定金，请核对收款记录");
            if(total-deposit<WriterPayments.paid(paper,"incoming_balance"))throw new ApiException(400,"约定收款尾款不能低于累计已收尾款，请核对收款记录");
        }
    }
}
