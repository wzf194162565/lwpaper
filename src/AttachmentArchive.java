import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

/** Portable backup: password-encrypted business metadata and authenticated encrypted files. */
final class AttachmentArchive {
    static Path backup(ApplicationStore store) throws Exception {
        synchronized(store) {
            Map<String,Object> state=store.read();AttachmentService files=new AttachmentService(store);
            List<Map<String,Object>> entries=AttachmentService.all(state);
            state.put("attachmentBackupKey",Base64.getEncoder().encodeToString(files.key(false)));
            Path archive=Files.createTempFile(files.directory,"backup-",".zip");boolean complete=false;
            try {
                byte[] business=store.encodeBackup(state);
                if(business.length>8*1024*1024)throw new ApiException(413,"业务备份超过 8MB 容量上限");
                try(ZipOutputStream zip=new ZipOutputStream(Files.newOutputStream(archive))) {
                    zip.setLevel(0);zip.putNextEntry(new ZipEntry("business.vault"));zip.write(business);zip.closeEntry();
                    for(Map<String,Object> f:entries) {
                        Path source=files.blob(Main.string(f,"id"));
                        if(Files.size(source)!=PaperService.number(f.get("size"))+28)throw new IOException("附件缺失或损坏，无法创建完整备份");
                        zip.putNextEntry(new ZipEntry("files/"+Main.string(f,"id")+".bin"));Files.copy(source,zip);zip.closeEntry();
                    }
                }
                complete=true;return archive;
            }finally{if(!complete)Files.deleteIfExists(archive);}
        }
    }
    static void restore(ApplicationStore store,InputStream input,String password) throws Exception {
        if(password.isEmpty()||password.length()>128)throw new ApiException(400,"备份密码格式不正确");
        synchronized(store) {
            AttachmentService files=new AttachmentService(store);Files.createDirectories(files.directory);
            Path archive=Files.createTempFile(files.directory,"restore-",".zip");List<Path> installed=new ArrayList<>();
            List<Map<String,Object>> previous=AttachmentService.all(store.read());boolean committed=false;
            try {
                try(OutputStream out=Files.newOutputStream(archive)){AttachmentService.copyLimited(input,out,AttachmentService.ARCHIVE_LIMIT);}
                try(ZipFile zip=new ZipFile(archive.toFile())) {
                    ZipEntry metadata=zip.getEntry("business.vault");if(metadata==null)throw new ApiException(400,"不是有效的论文附件备份");
                    ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                    try(InputStream in=zip.getInputStream(metadata)){AttachmentService.copyLimited(in,bytes,8*1024*1024);}
                    Map<String,Object> state=Vault.readBackup(bytes.toByteArray(),password);
                    byte[] sourceKey;
                    try{sourceKey=Base64.getDecoder().decode(Main.string(state,"attachmentBackupKey"));}catch(IllegalArgumentException e){throw new ApiException(400,"附件备份密钥无效");}
                    if(sourceKey.length!=32)throw new ApiException(400,"附件备份密钥无效");state.remove("attachmentBackupKey");
                    List<Map<String,Object>> entries=AttachmentService.all(state);Set<String> expected=new HashSet<>(Set.of("business.vault"));
                    for(Map<String,Object> f:entries)expected.add("files/"+Main.string(f,"id")+".bin");
                    Set<String> actual=new HashSet<>();
                    for(ZipEntry e:Collections.list(zip.entries()))if(e.isDirectory()||!actual.add(e.getName())||!expected.contains(e.getName()))throw new ApiException(400,"备份包含重复或无效文件");
                    if(!actual.equals(expected))throw new ApiException(400,"备份中的稿件文件不完整");
                    byte[] targetKey=files.key(true);Map<String,String> ids=new HashMap<>();
                    for(Map<String,Object> f:entries) {
                        String old=Main.string(f,"id"),id=UUID.randomUUID().toString();ids.put(old,id);
                        ZipEntry entry=zip.getEntry("files/"+old+".bin");long size=PaperService.number(f.get("size"));
                        if(entry.getSize()!=size+28)throw new ApiException(400,"备份中的稿件大小不正确");
                        Path plain=Files.createTempFile(files.directory,"restore-file-",".tmp");Path target=files.blob(id);installed.add(target);
                        try {
                            try(InputStream in=zip.getInputStream(entry)){AttachmentService.decrypt(in,plain,sourceKey,old,size);}
                            catch(IOException e){throw new ApiException(400,"稿件解密失败，备份已损坏");}
                            if(Files.size(plain)!=size||!AttachmentService.hash(plain).equals(Main.string(f,"sha256")))throw new ApiException(400,"稿件文件校验失败");
                            AttachmentService.checkContent(plain,Main.string(f,"filename"));AttachmentService.encrypt(plain,target,targetKey,id);f.put("id",id);
                        }finally{Files.deleteIfExists(plain);}
                    }
                    for(Object p:Json.array(state.get("papers")))for(Object s:Json.array(Json.object(p).get("submissions"))) {
                        Map<String,Object> sub=Json.object(s);String id=Main.string(sub,"manuscriptId");if(!id.isEmpty())sub.put("manuscriptId",ids.get(id));
                    }
                    store.restoreState(state);committed=true;
                }
                files.removeBlobs(previous);
            }catch(ZipException e){throw new ApiException(400,"备份压缩包已损坏");}
            finally{Files.deleteIfExists(archive);if(!committed)for(Path path:installed)Files.deleteIfExists(path);}
        }
    }
}
