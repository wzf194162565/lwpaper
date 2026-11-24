import javax.crypto.*;
import javax.crypto.spec.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.time.Instant;
import java.util.*;
import java.util.zip.ZipFile;

/** Immutable manuscript revisions. Only metadata enters the business state. */
public final class AttachmentService {
    static final long ACCOUNT_LIMIT = 512L * 1024 * 1024;
    static final long ARCHIVE_LIMIT = 600L * 1024 * 1024;
    private final ApplicationStore store;
    final Path directory;
    AttachmentService(ApplicationStore store) { this.store=store;directory=store.attachmentDirectory(); }
    static long maxBytes() {
        int mb=Integer.getInteger("app.fileMaxMb",50);
        if(mb<1||mb>200)throw new IllegalArgumentException("app.fileMaxMb must be between 1 and 200");
        return mb*1024L*1024;
    }
    static List<Object> files(Map<String,Object> paper) {
        return paper.get("files") instanceof List<?> ? Json.array(paper.get("files")) : List.of();
    }
    static List<Map<String,Object>> all(Map<String,Object> state) {
        List<Map<String,Object>> result=new ArrayList<>();
        for(Object p:Json.array(state.get("papers")))for(Object f:files(Json.object(p)))result.add(Json.object(f));
        return result;
    }
    static Map<String,Object> find(Map<String,Object> paper,String id) {
        for(Object f:files(paper))if(Main.string(Json.object(f),"id").equals(id))return Json.object(f);
        throw new ApiException(404,"稿件文件不存在");
    }
    static boolean receipt(Map<String,Object> file){return Main.string(file,"purpose").equals("receipt");}
    static String filename(String value) {
        if(value.isBlank()||value.length()>200||value.matches(".*[\\\\/:*?\"<>|\\p{Cntrl}].*"))throw new ApiException(400,"文件名无效，最多 200 个字符");
        String lower=value.toLowerCase(Locale.ROOT);
        if(!lower.endsWith(".doc")&&!lower.endsWith(".docx")&&!lower.endsWith(".pdf")&&!lower.endsWith(".png")&&!lower.endsWith(".jpg")&&!lower.endsWith(".jpeg"))throw new ApiException(400,"支持 DOC、DOCX、PDF 及 PNG、JPG 凭证图片");
        return value;
    }
    Path blob(String id) { UUID.fromString(id);return directory.resolve(id+".bin"); }
    byte[] key(boolean create) throws Exception {
        Path path=directory.resolve("files.key");
        if(!Files.exists(path)) {
            if(!create)throw new IOException("附件密钥缺失，请恢复附件目录及 files.key");
            Files.createDirectories(directory);
            try(var entries=Files.list(directory)) {
                if(entries.anyMatch(p->p.getFileName().toString().endsWith(".bin")))throw new IOException("附件密钥缺失，拒绝覆盖已有附件");
            }
            byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);
            Files.write(path,Base64.getEncoder().encode(bytes),StandardOpenOption.CREATE_NEW);
        }
        byte[] bytes=Base64.getDecoder().decode(Files.readString(path).trim());
        if(bytes.length!=32)throw new IOException("附件密钥格式无效");return bytes;
    }
    static void copyLimited(InputStream input,OutputStream output,long limit) throws IOException {
        long total=0;byte[] buffer=new byte[65536];int n;
        while((n=input.read(buffer))!=-1) { total+=n;if(total>limit)throw new ApiException(413,"文件超过允许大小");output.write(buffer,0,n); }
    }
    static String hash(Path path) throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(InputStream input=Files.newInputStream(path)) { byte[] buffer=new byte[65536];int n;while((n=input.read(buffer))!=-1)digest.update(buffer,0,n); }
        return HexFormat.of().formatHex(digest.digest());
    }
    static void encrypt(Path plain,Path encrypted,byte[] key,String id) throws Exception {
        byte[] iv=new byte[12];new SecureRandom().nextBytes(iv);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));
        try(OutputStream raw=Files.newOutputStream(encrypted,StandardOpenOption.CREATE_NEW)) {
            raw.write(iv);try(OutputStream output=new CipherOutputStream(raw,cipher);InputStream input=Files.newInputStream(plain)){input.transferTo(output);}
        }
    }
    static void decrypt(InputStream input,Path plain,byte[] key,String id,long limit) throws Exception {
        byte[] iv=input.readNBytes(12);if(iv.length!=12)throw new IOException("附件损坏");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));
        try(InputStream decrypted=new CipherInputStream(input,cipher);OutputStream output=Files.newOutputStream(plain)){copyLimited(decrypted,output,limit);}
    }
    static void checkContent(Path path,String name) throws Exception {
        byte[] head;try(InputStream in=Files.newInputStream(path)){head=in.readNBytes(8);}
        String lower=name.toLowerCase(Locale.ROOT);boolean valid=false;
        if(lower.endsWith(".pdf"))valid=new String(head,StandardCharsets.US_ASCII).startsWith("%PDF-");
        if(lower.endsWith(".doc"))valid=Arrays.equals(head,new byte[]{(byte)0xd0,(byte)0xcf,0x11,(byte)0xe0,(byte)0xa1,(byte)0xb1,0x1a,(byte)0xe1});
        if(lower.endsWith(".docx"))try(ZipFile zip=new ZipFile(path.toFile())){valid=zip.getEntry("[Content_Types].xml")!=null&&zip.getEntry("word/document.xml")!=null;}catch(IOException ignored){}
        if(lower.endsWith(".png")||lower.endsWith(".jpg")||lower.endsWith(".jpeg"))valid=javax.imageio.ImageIO.read(path.toFile())!=null;
        if(!valid)throw new ApiException(400,"文件内容与格式不符，请上传有效的 Word 或 PDF 文件");
    }
    Map<String,Object> upload(String paperId,String name,String note,long version,String uploadId,InputStream input) throws Exception {
        return upload(paperId,name,note,version,uploadId,input,"");
    }
    Map<String,Object> upload(String paperId,String name,String note,long version,String uploadId,InputStream input,String transactionId) throws Exception {
        boolean receipt=!transactionId.isEmpty();
        if(!receipt&&!name.toLowerCase(Locale.ROOT).matches(".*\\.(docx?|pdf)$"))throw new ApiException(400,"稿件仅支持 DOC、DOCX、PDF，收支凭证请从对应流水上传");
        filename(name);if(note.length()>1000)throw new ApiException(400,"修改说明最多 1000 个字符");
        String id=uploadId.isEmpty()?UUID.randomUUID().toString():uploadId;
        try{if(!UUID.fromString(id).toString().equals(id))throw new IllegalArgumentException();}catch(IllegalArgumentException e){throw new ApiException(400,"上传标识无效");}
        synchronized(store) {
            Map<String,Object> before=store.read(),paper=PaperService.find(before,paperId);
            if(receipt)FinancialLedger.find(paper,transactionId);
            for(Object f:files(paper))if(Main.string(Json.object(f),"id").equals(id)){if(!Main.string(Json.object(f),"transactionId").equals(transactionId))throw new ApiException(409,"上传标识已被其他记录使用");return PaperService.publicPaper(paper,true,before);}
            if(Files.exists(blob(id))||all(before).stream().anyMatch(f->Main.string(f,"id").equals(id)))throw new ApiException(409,"上传标识已使用，请重新选择文件");
            PaperService.checkVersion(paper,Map.of("version",version));
            if(files(paper).stream().map(Json::object).filter(f->receipt(f)==receipt).count()>=(receipt?1000:200))throw new ApiException(400,receipt?"每篇论文最多保留 1000 个凭证":"每篇论文最多保留 200 个稿件版本");
            Files.createDirectories(directory);Path plain=Files.createTempFile(directory,"upload-",".tmp");
            Path target=blob(id);boolean saved=false;
            try {
                try(OutputStream output=Files.newOutputStream(plain)){copyLimited(input,output,maxBytes());}
                long size=Files.size(plain);if(size==0)throw new ApiException(400,"不能上传空文件");checkContent(plain,name);
                if(all(before).stream().mapToLong(f->PaperService.number(f.get("size"))).sum()+size>ACCOUNT_LIMIT)throw new ApiException(413,"当前账号附件容量上限为 512MB");
                long revision=files(paper).stream().map(Json::object).filter(f->receipt(f)==receipt).mapToLong(f->PaperService.number(f.get("revision"))).max().orElse(0)+1;
                Map<String,Object> metadata=new LinkedHashMap<>(Map.of("id",id,"filename",name,"size",size,"sha256",hash(plain),"revision",revision,"note",note,"uploadedAt",Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS).toString()));
                metadata.put("purpose",receipt?"receipt":"manuscript");metadata.put("transactionId",transactionId);metadata.put("uploadedBy",store.username());
                encrypt(plain,target,key(true),id);
                Map<String,Object> result=store.mutate(state->{
                    Map<String,Object> current=PaperService.find(state,paperId);PaperService.checkVersion(current,Map.of("version",version));
                    if(!current.containsKey("files"))current.put("files",new ArrayList<>());Json.array(current.get("files")).add(metadata);PaperService.touch(current);
                    Map<String,Object> event=new LinkedHashMap<>();event.put("at",PaperService.now());event.put("action",(receipt?"上传收支凭证 ":"上传稿件 V"+revision+"：")+name);
                    for(String field:List.of("status","journal","submissionSystem","submissionUrl","submittedAt"))event.put(field,current.getOrDefault(field,""));
                    Json.array(current.get("history")).add(event);
                    if(receipt)FinancialLedger.audit(current,"receipt",FinancialLedger.find(current,transactionId),store.username(),note,id);
                    return PaperService.publicPaper(current,true,state);
                });saved=true;return result;
            }finally{Files.deleteIfExists(plain);if(!saved)Files.deleteIfExists(target);}
        }
    }
    Path download(String paperId,String fileId) throws Exception {
        Map<String,Object> metadata=find(PaperService.find(store.read(),paperId),fileId);
        Path plain=Files.createTempFile(directory,"download-",".tmp");
        try {
            try(InputStream input=Files.newInputStream(blob(fileId))){decrypt(input,plain,key(false),fileId,200L*1024*1024);}
            if(Files.size(plain)!=PaperService.number(metadata.get("size"))||!hash(plain).equals(Main.string(metadata,"sha256")))throw new IOException("附件完整性校验失败");
            return plain;
        }catch(Exception e){Files.deleteIfExists(plain);throw e;}
    }
    void removeBlobs(List<Map<String,Object>> files) {
        for(Map<String,Object> f:files)try{Files.deleteIfExists(blob(Main.string(f,"id")));}catch(IOException e){System.err.println("Could not remove an unreferenced attachment");}
    }
    static void validate(Map<String,Object> state) {
        Set<String> ids=new HashSet<>();long total=0;
        for(Object item:Json.array(state.get("papers"))) {
            Map<String,Object> paper=Json.object(item);Set<Long> revisions=new HashSet<>();Set<String> local=new HashSet<>();
            if(paper.containsKey("files")&&!(paper.get("files") instanceof List<?>))throw new IllegalArgumentException();
            if(files(paper).stream().map(Json::object).filter(f->!receipt(f)).count()>200||files(paper).size()>1200)throw new IllegalArgumentException();
            for(Object f:files(paper)) {
                Map<String,Object> file=Json.object(f);String id=Main.string(file,"id");UUID.fromString(id);filename(Main.string(file,"filename"));
                long size=PaperService.number(file.get("size")),revision=PaperService.number(file.get("revision"));total+=size;
                if(!ids.add(id)||!local.add(id)||!revisions.add(revision*(receipt(file)?-1:1))||revision<1||size<1||size>200L*1024*1024||Main.string(file,"note").length()>1000||!Main.string(file,"sha256").matches("[0-9a-f]{64}"))throw new IllegalArgumentException();
                if(receipt(file))FinancialLedger.find(paper,Main.string(file,"transactionId"));
                Instant.parse(Main.string(file,"uploadedAt"));
            }
            for(Object s:Json.array(paper.get("submissions"))) {String id=Main.string(Json.object(s),"manuscriptId");if(!id.isEmpty()&&(!local.contains(id)||receipt(find(paper,id))))throw new IllegalArgumentException();}
            for(Object audit:FinancialLedger.audits(paper)){String fileId=Main.string(Json.object(audit),"fileId");if(!fileId.isEmpty()&&!local.contains(fileId))throw new IllegalArgumentException();}
        }
        if(total>ACCOUNT_LIMIT)throw new IllegalArgumentException();
    }
}
