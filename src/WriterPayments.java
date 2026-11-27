import java.util.*;

/** Confirmed writing payments share the existing ledger and commit atomically with paper edits. */
final class WriterPayments {
    static long paid(Map<String, Object> paper, String type) {
        long amount = 0;
        for (Object item : Json.array(paper.get("transactions"))) {
            Map<String, Object> tx = Json.object(item);
            if (Main.string(tx, "type").equals(type)) amount += FinancialLedger.signed(tx);
        }
        return amount;
    }

    static void validateTerms(Map<String, Object> paper, Map<String, Object> next) {
        long fee = PaperService.number(next.get("writerFeeCents")), deposit = PaperService.number(next.get("writerDepositCents"));
        long oldFee = PaperService.number(paper.get("writerFeeCents")), oldDeposit = PaperService.number(paper.get("writerDepositCents"));
        Map<String,Object>a=WriterAssignments.current(paper);
        long paidDeposit = a==null?paid(paper, "outgoing_deposit"):WriterAssignments.paid(paper,a,"outgoing_deposit"), paidBalance = a==null?paid(paper, "outgoing_balance"):WriterAssignments.paid(paper,a,"outgoing_balance");
        if (fee != oldFee && fee < paidDeposit + paidBalance) throw new ApiException(400, "稿酬总额不能低于累计已付稿酬，请先核对实际付款记录");
        if (deposit != oldDeposit && deposit < paidDeposit) throw new ApiException(400, "约定写作定金不能低于累计已付定金，请先核对实际付款记录");
        if (fee - deposit != oldFee - oldDeposit && fee - deposit < paidBalance) throw new ApiException(400, "约定写作尾款不能低于累计已付尾款，请先核对实际付款记录");
    }

    static void validatePayment(Map<String, Object> paper, Map<String, Object> tx) {
        String type = Main.string(tx, "type");
        if (!Set.of("outgoing_deposit", "outgoing_balance").contains(type)) throw new ApiException(400, "请选择支付写作定金或尾款");
        long deposit = PaperService.number(paper.get("writerDepositCents")), fee = PaperService.number(paper.get("writerFeeCents"));
        long paidDeposit = paid(paper, "outgoing_deposit"), paidBalance = paid(paper, "outgoing_balance"), amount = PaperService.number(tx.get("amountCents"));
        if (amount + paidDeposit + paidBalance > fee) throw new ApiException(400, "本次支付金额不能超过待付稿酬，请核对金额，勿重复登记");
        long limit = type.equals("outgoing_deposit") ? deposit - paidDeposit : fee - deposit - paidBalance;
        if (amount > limit) throw new ApiException(400, type.equals("outgoing_deposit") ? "本次支付定金不能超过剩余约定定金，请核对费用约定" : "本次支付尾款不能超过剩余约定尾款，请核对费用约定");
    }

    static void apply(Map<String, Object> paper, Map<String, Object> input,String actor) {
        if (!input.containsKey("writerPayments")) return;
        if (!(input.get("writerPayments") instanceof List<?> payments) || payments.size() > 2) throw new ApiException(400, "本次写作付款资料不正确");
        if (payments.isEmpty()) return;
        if (!BusinessService.hasWriting(paper)) throw new ApiException(400, "半包论文无需登记写作稿酬");
        if (!Boolean.TRUE.equals(input.get("confirmWriterPayments"))) throw new ApiException(400, "请确认本次登记的金额已实际支付");
        Set<String> types = new HashSet<>();
        for (Object item : payments) {
            if (!(item instanceof Map<?, ?>)) throw new ApiException(400, "本次写作付款资料不正确");
            Map<String, Object> payment = Json.object(item);
            if (!types.add(Main.string(payment, "type"))) throw new ApiException(400, "定金和尾款本次各登记一次，请核对金额");
            Map<String, Object> tx = PaperService.transaction(paper, payment);
            if(!Set.of("outgoing_deposit","outgoing_balance").contains(Main.string(tx,"type")))throw new ApiException(400,"请选择支付写作定金或尾款");
            if(WriterAssignments.current(paper)!=null)WriterAssignments.bind(paper,Map.of(),tx);else validatePayment(paper, tx);
            FinancialLedger.record(paper,tx,actor);
        }
    }
}
