import java.io.IOException;
import java.nio.file.AccessDeniedException;

public class VaultRetryFixture {
    public static void main(String[] args) throws Exception {
        int[] calls={0};
        Vault.retryFileOperation(()->{if(++calls[0]<3)throw new AccessDeniedException("temporary lock");});
        if(calls[0]!=3)throw new AssertionError("Transient access failure was not retried");
        calls[0]=0;
        try {
            Vault.retryFileOperation(()->{calls[0]++;throw new AccessDeniedException("persistent denial");});
            throw new AssertionError("Persistent failure was hidden");
        } catch(AccessDeniedException expected) { if(calls[0]!=4)throw new AssertionError("Retry limit exceeded"); }
        calls[0]=0;
        try {
            Vault.retryFileOperation(()->{calls[0]++;throw new IOException("disk full");});
            throw new AssertionError("Other failure was hidden");
        } catch(IOException expected) { if(calls[0]!=1)throw new AssertionError("Unrelated errors must not retry"); }
        Thread.currentThread().interrupt();
        try {
            Vault.retryFileOperation(()->{throw new AccessDeniedException("locked");});
            throw new AssertionError("Interrupt was ignored");
        } catch(IOException expected) { if(!Thread.currentThread().isInterrupted())throw new AssertionError("Interrupt flag lost"); }
        finally { Thread.interrupted(); }
        System.out.println("File retry checks passed");
    }
}
