import java.util.concurrent.atomic.AtomicLong;

public final class RecoveryFixture {
    private static void rejected(RunnableWithException operation,int status) throws Exception {
        try { operation.run();throw new AssertionError("Expected rejection"); }
        catch(ApiException error) { if(error.status!=status)throw new AssertionError("Wrong status: "+error.status); }
    }
    @FunctionalInterface interface RunnableWithException { void run() throws Exception; }
    public static void main(String[] args) throws Exception {
        AtomicLong now=new AtomicLong(1_000_000);String[] sent={""};
        RecoveryCodes codes=new RecoveryCodes((email,code)->sent[0]=code,now::get);
        codes.send("account","owner@example.test","local",true);String first=sent[0];
        rejected(()->codes.send("account","owner@example.test","local",true),429);
        now.addAndGet(60_000);codes.send("account","owner@example.test","local",true);
        // Expiry is deterministic and needs no production TTL override.
        now.addAndGet(600_000);rejected(()->codes.consume("account","owner@example.test",sent[0],"local"),400);
        codes.send("account","owner@example.test","local",true);
        codes.consume("account","owner@example.test",sent[0],"local");
        rejected(()->codes.consume("account","owner@example.test",sent[0],"local"),400);
        codes.send("other","owner@example.test","other-source",true);
        rejected(()->codes.consume("wrong-account","owner@example.test",sent[0],"other-source"),400);
        codes.invalidate("other");rejected(()->codes.consume("other","owner@example.test",sent[0],"other-source"),400);
        for(int i=0;i<10;i++)codes.send("name-"+i,"owner@example.test","limited",false);
        rejected(()->codes.send("eleventh","owner@example.test","limited",false),429);
        now.addAndGet(900_000);codes.send("eleventh","owner@example.test","limited",false);
    }
}
