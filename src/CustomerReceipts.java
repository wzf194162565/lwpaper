import java.util.*;

/** Actual service receipts are committed with fee terms and writing payments in one transaction. */
final class CustomerReceipts {
    static void apply(Map<String,Object> paper, Map<String,Object> input, String actor) {
        if (input.containsKey("customerReceiptTotals")) {
            if (input.containsKey("customerReceipts")) throw new ApiException(400,"不能同时提交累计收款和新增收款");
            applyTotals(paper,input.get("customerReceiptTotals"),actor);
            return;
        }
        if (!input.containsKey("customerReceipts")) return;
        if (!(input.get("customerReceipts") instanceof List<?> receipts) || receipts.size()>2)
            throw new ApiException(400,"本次服务费收款资料不正确");
        if (receipts.isEmpty()) return;
        if (!Boolean.TRUE.equals(input.get("confirmCustomerReceipts")))
            throw new ApiException(400,"请确认本次登记的服务费已实际收到");
        Set<String> types=new HashSet<>();
        for (Object item:receipts) {
            if (!(item instanceof Map<?,?>)) throw new ApiException(400,"本次服务费收款资料不正确");
            Map<String,Object> receipt=Json.object(item);
            String type=Main.string(receipt,"type");
            if (!Set.of("incoming_deposit","incoming_balance").contains(type))
                throw new ApiException(400,"请选择收取服务费定金或尾款");
            if (!types.add(type)) throw new ApiException(400,"服务费定金和尾款本次各登记一次");
            Map<String,Object> tx=PaperService.transaction(paper,receipt);
            FinancialRules.validateTransaction(paper,tx);
            FinancialLedger.record(paper,tx,actor);
        }
    }
    static void applyTotals(Map<String,Object> paper,Object raw,String actor) {
        if (!(raw instanceof Map<?,?>)) throw new ApiException(400,"已收金额格式不正确");
        Map<String,Object> totals=Json.object(raw);
        if (!totals.containsKey("deposit")||!totals.containsKey("balance"))throw new ApiException(400,"请填写已收定金和已收尾款");
        long deposit=PaperService.money(totals,"deposit"),balance=PaperService.money(totals,"balance");
        long oldDeposit=WriterPayments.paid(paper,"incoming_deposit"),oldBalance=WriterPayments.paid(paper,"incoming_balance");
        long fee=PaperService.number(paper.get("contractCents")),agreed=PaperService.number(paper.get("contractDepositCents"));
        if(deposit<0||balance<0)throw new ApiException(400,"已收金额不能小于零");
        if(deposit!=oldDeposit||balance!=oldBalance) {
            if(deposit+balance>fee)throw new ApiException(400,"已收定金与已收尾款合计不能超过服务费用");
            if(agreed>0&&deposit>agreed)throw new ApiException(400,"已收定金不能超过约定定金");
            if(agreed>0&&balance>fee-agreed)throw new ApiException(400,"已收尾款不能超过服务费用减约定定金");
        }
        if(deposit<oldDeposit)reconcile(paper,"incoming_deposit",deposit,actor);
        if(balance<oldBalance)reconcile(paper,"incoming_balance",balance,actor);
        if(deposit>oldDeposit)reconcile(paper,"incoming_deposit",deposit,actor);
        if(balance>oldBalance)reconcile(paper,"incoming_balance",balance,actor);
    }

    private static void reconcile(Map<String,Object> paper,String type,long target,String actor) {
        long previous=WriterPayments.paid(paper,type);
        if(target==previous)return;
        if(target>previous) {
            Map<String,Object> tx=PaperService.transaction(paper,Map.of("type",type,"amount",java.math.BigDecimal.valueOf(target-previous,2).toPlainString(),"date",java.time.LocalDate.now().toString(),"note","服务费用更新已收金额"));
            FinancialRules.validateTransaction(paper,tx);FinancialLedger.record(paper,tx,actor);return;
        }
        // Preserve the original ledger when correcting a cumulative received amount.
        long reduction=previous-target;
        List<Object> originals=new ArrayList<>(Json.array(paper.get("transactions")));
        Collections.reverse(originals);
        for(Object item:originals) {
            Map<String,Object> tx=Json.object(item);String id=Main.string(tx,"id");
            if(!type.equals(Main.string(tx,"type"))||!Main.string(tx,"reversalOf").isEmpty()||FinancialLedger.reversed(paper,id))continue;
            long amount=PaperService.number(tx.get("amountCents"));
            FinancialLedger.reverse(paper,id,Map.of("reason","服务费用更正已收金额","confirmReversal",true),actor);
            if(amount>reduction) {
                Map<String,Object> residual=PaperService.transaction(paper,Map.of("type",type,"amount",java.math.BigDecimal.valueOf(amount-reduction,2).toPlainString(),"date",Main.string(tx,"date"),"method",Main.string(tx,"method"),"note","服务费用更正已收金额"));
                residual.put("correctsTransactionId",id);FinancialLedger.record(paper,residual,actor);
            }
            reduction-=Math.min(amount,reduction);if(reduction==0)break;
        }
        if(reduction!=0)throw new ApiException(400,"已收金额无法更正，请核对收支记录");
    }

}
