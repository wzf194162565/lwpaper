import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.function.LongSupplier;

/** Short-lived, single-use reset challenges. Only salted digests are retained in memory. */
public final class RecoveryCodes {
    @FunctionalInterface interface Sender { void send(String email,String code) throws Exception; }
    private record Challenge(byte[] salt,byte[] digest,long expires,int failures) { }
    private record Limit(long start,int count) { }
    private final Map<String,Challenge> challenges=new HashMap<>();
    private final Map<String,Limit> limits=new HashMap<>();
    private final Map<String,Long> sent=new HashMap<>();
    private final SecureRandom random=new SecureRandom();
    private final Sender sender;private final LongSupplier clock;
    public RecoveryCodes(Sender sender) { this(sender,System::currentTimeMillis); }
    RecoveryCodes(Sender sender,LongSupplier clock) { this.sender=sender;this.clock=clock; }
    public synchronized void send(String username,String email,String source,boolean eligible) throws Exception {
        long now=clock.getAsLong();prune(now);limit("send:"+source,10,now);
        String key=username+"\n"+email;
        if(now-sent.getOrDefault(key,Long.MIN_VALUE/2)<60_000)throw new ApiException(429,"请等待 60 秒后再获取验证码");
        if(challenges.size()>=10_000||sent.size()>=10_000)throw new ApiException(429,"验证码请求过多，请稍后重试");
        sent.put(key,now);
        if(!eligible)return;
        String code=String.format(Locale.ROOT,"%06d",random.nextInt(1_000_000));byte[] salt=new byte[32];random.nextBytes(salt);
        try { sender.send(email,code); } catch(Exception error){sent.remove(key);throw error;}
        challenges.put(key,new Challenge(salt,digest(salt,code),now+600_000,0));
    }
    public synchronized void consume(String username,String email,String code,String source) throws Exception {
        long now=clock.getAsLong();prune(now);limit("verify:"+source,30,now);
        String key=username+"\n"+email;Challenge challenge=challenges.get(key);
        if(challenge==null)throw invalid();
        if(!code.matches("[0-9]{6}")||!MessageDigest.isEqual(challenge.digest(),digest(challenge.salt(),code))) {
            if(challenge.failures()+1>=5)challenges.remove(key);
            else challenges.put(key,new Challenge(challenge.salt(),challenge.digest(),challenge.expires(),challenge.failures()+1));
            throw invalid();
        }
        challenges.remove(key);
    }
    public synchronized void invalidate(String username) { challenges.keySet().removeIf(key->key.startsWith(username+"\n")); }
    private void limit(String key,int max,long now) {
        Limit previous=limits.get(key);if(previous==null||now-previous.start()>=900_000)previous=new Limit(now,0);
        if(previous.count()>=max||limits.size()>=20_000&&!limits.containsKey(key))throw new ApiException(429,"操作过于频繁，请稍后再试");
        limits.put(key,new Limit(previous.start(),previous.count()+1));
    }
    private void prune(long now) { challenges.values().removeIf(value->value.expires()<=now);sent.values().removeIf(value->now-value>=600_000);limits.values().removeIf(value->now-value.start()>=900_000); }
    private static ApiException invalid() { return new ApiException(400,"验证码不正确或已失效，请重新获取"); }
    private static byte[] digest(byte[] salt,String code) throws Exception { MessageDigest hash=MessageDigest.getInstance("SHA-256");hash.update(salt);return hash.digest(code.getBytes(StandardCharsets.UTF_8)); }
}
