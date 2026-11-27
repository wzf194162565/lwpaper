import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.sql.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.function.Function;

/** MySQL-backed application identity, relational business storage and encrypted portable backups. */
public final class MysqlStore implements ApplicationStore {
    private static final String WORKSPACE="00000000-0000-0000-0000-000000000001";
    private final DatabaseConfig config;
    private final String workspace;
    private final DatabaseCrypto crypto;
    private final MysqlStateMapper mapper;
    private String userId="", username="";
    private Vault.BackupCipher backupCipher;
    public MysqlStore(DatabaseConfig config) throws Exception {
        this.config=config;
        this.workspace=WORKSPACE;
        try{Class.forName("com.mysql.cj.jdbc.Driver");}catch(ClassNotFoundException e){throw new IllegalStateException("缺少 MySQL JDBC 驱动，请将 mysql-connector-j 放入 lib，并使用包含 lib/* 的 classpath 启动");}
        initializeSchema();
        try(Connection connection=config.connect(true)) {
            connection.setAutoCommit(false);
            lock(connection);
            String saved=scalar(connection,"SELECT key_fingerprint FROM lw_storage_meta WHERE workspace_id=?",WORKSPACE);
            crypto=new DatabaseCrypto(config.keyFile(),saved.isEmpty());
            if(!saved.isEmpty()&&!saved.equals(crypto.fingerprint()))throw new IllegalStateException("database.key 与当前数据库不匹配，请恢复该数据库原来的密钥文件");
            execute(connection,"INSERT IGNORE INTO lw_storage_meta(workspace_id,key_fingerprint,business_schema,created_at) VALUES(?,?,2,UTC_TIMESTAMP(6))",WORKSPACE,crypto.fingerprint());
            connection.commit();
        }
        mapper=new MysqlStateMapper(WORKSPACE,crypto);
    }
    private MysqlStore(MysqlStore primary,String workspace) throws Exception {
        this.config=primary.config;this.workspace=workspace;this.crypto=primary.crypto;
        this.mapper=new MysqlStateMapper(workspace,crypto);
    }
    public synchronized MysqlStore registerAccount(String account,String password) throws Exception {
        account=Vault.validateUsername(account);Vault.validatePassword(password);
        try(Connection c=config.connect(true)) {
            c.setAutoCommit(false);
            try {
                lock(c);
                if(!scalar(c,"SELECT id FROM lw_user WHERE username=?",account).isEmpty())throw new ApiException(409,"该账号已被注册，请更换账号或直接登录");
                if(memberCount(c)==0) {
                    if(Files.exists(config.data.resolve("papers.vault")))throw new ApiException(409,"检测到旧版加密账号，请先用原账号登录一次完成数据迁移，之后即可注册新账号");
                    c.rollback();
                    setup(account,password);
                    return this;
                }
                String space=UUID.randomUUID().toString(),id=UUID.randomUUID().toString(),member=UUID.randomUUID().toString();
                execute(c,"INSERT INTO lw_workspace(id,name,state_revision,created_at,updated_at) VALUES(?,?,0,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",space,account+" 的工作空间");
                execute(c,"INSERT INTO lw_storage_meta(workspace_id,key_fingerprint,business_schema,created_at) VALUES(?,?,2,UTC_TIMESTAMP(6))",space,crypto.fingerprint());
                execute(c,"INSERT INTO lw_user(id,username,password_hash,password_ciphertext,status,version,created_at,updated_at) VALUES(?,?,?,?,'enabled',1,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",id,account,DatabaseCrypto.hashPassword(password),crypto.encryptLoginPassword(id,password));
                execute(c,"INSERT INTO lw_workspace_member(id,workspace_id,user_id,status,created_at) VALUES(?,?,?,'enabled',UTC_TIMESTAMP(6))",member,space,id);
                execute(c,"INSERT INTO lw_member_role(member_id,role_code) VALUES(?,'administrator')",member);
                c.commit();
                MysqlStore store=new MysqlStore(this,space);store.unlock(account,password);return store;
            } catch(Exception e){rollback(c);throw e;}
        }
    }
    synchronized boolean accountExists(String account) throws Exception {
        try(Connection c=config.connect(true)) { return !scalar(c,"SELECT id FROM lw_user WHERE username=?",account).isEmpty(); }
    }
    public synchronized MysqlStore loginAccount(String account,String password) throws Exception {
        String space;
        try(Connection c=config.connect(true)) {
            space=scalar(c,"SELECT m.workspace_id FROM lw_user u JOIN lw_workspace_member m ON m.user_id=u.id JOIN lw_member_role r ON r.member_id=m.id WHERE u.username=? AND u.status='enabled' AND m.status='enabled' AND r.role_code='administrator'",account);
            if(space.isEmpty()) {
                if(memberCount(c)>0)throw new ApiException(401,"账号或密码不正确");
                unlock(account,password);return this;
            }
        }
        MysqlStore store=new MysqlStore(this,space);store.unlock(account,password);return store;
    }
    public String storageType(){return "mysql";}
    public synchronized String username(){return username;}
    public synchronized boolean exists(){
        try(Connection c=config.connect(true)){return memberCount(c)>0||Files.exists(config.data.resolve("papers.vault"));}
        catch(SQLException e){throw failure(e);}
    }
    public synchronized void setup(String username,String password) throws Exception {
        username=Vault.validateUsername(username);Vault.validatePassword(password);
        if(Files.exists(config.data.resolve("papers.vault")))throw new ApiException(409,"检测到原有加密数据，请使用原账号和密码登录以迁移，不能重新初始化");
        Map<String,Object> empty=emptyState(username);
        initializeAccount(empty,username,password,null);
        unlock(username,password);
    }
    public synchronized void unlock(String account,String password) throws Exception {
        account=account.trim();
        if(account.isEmpty()||account.length()>64||password.isEmpty()||password.length()>128)throw new ApiException(401,"账号或密码不正确");
        try(Connection c=config.connect(true)) {
            if(memberCount(c)==0) {
                Path source=config.data.resolve("papers.vault");
                if(!Files.exists(source))throw new ApiException(409,"当前没有可登录的账号，请先点击“注册”创建账号。");
                byte[] encoded=Files.readAllBytes(source);Map<String,Object> imported;
                try{imported=Vault.readBackup(encoded,password);}catch(ApiException e){throw new ApiException(401,"账号或密码不正确，或原数据文件已损坏");}
                String savedAccount=Main.string(imported,"username");
                if(!savedAccount.isEmpty()&&!savedAccount.equals(account))throw new ApiException(401,"账号或密码不正确");
                imported.put("username",Vault.validateUsername(account));
                Path backups=config.data.resolve("backups");Files.createDirectories(backups);
                String stamp=DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS").format(LocalDateTime.now());
                Files.write(backups.resolve("pre-mysql-"+stamp+".vault"),encoded,StandardOpenOption.CREATE_NEW);
                initializeAccount(imported,account,password,HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(encoded)));
            }
        }
        try(Connection c=config.connect(true);PreparedStatement statement=c.prepareStatement("SELECT u.id,u.username,u.password_hash,u.password_ciphertext FROM lw_user u JOIN lw_workspace_member m ON m.user_id=u.id JOIN lw_member_role r ON r.member_id=m.id WHERE m.workspace_id=? AND u.username=? AND u.status='enabled' AND m.status='enabled' AND r.role_code='administrator'")) {
            statement.setString(1,workspace);statement.setString(2,account);
            try(ResultSet rs=statement.executeQuery()) {
                if(!rs.next()||!DatabaseCrypto.verifyPassword(password,rs.getString("password_hash")))throw new ApiException(401,"账号或密码不正确");
                String verifiedId=rs.getString("id"),verifiedHash=rs.getString("password_hash");
                if(rs.getString("password_ciphertext").isEmpty()) {
                    // A concurrent password change must not receive a copy of the previous password.
                    execute(c,"UPDATE lw_user SET password_ciphertext=? WHERE id=? AND password_hash=? AND password_ciphertext=''",crypto.encryptLoginPassword(verifiedId,password),verifiedId,verifiedHash);
                }
                userId=verifiedId;username=rs.getString("username");backupCipher=new Vault.BackupCipher(password);
            }
        }
    }
    public synchronized Map<String,Object> read(){
        try(Connection c=config.connect(true)) {
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);c.setAutoCommit(false);
            try{requireAccount(c);Map<String,Object> result=mapper.read(c,username);c.commit();return result;}
            catch(Exception e){rollback(c);throw e;}
        }catch(ApiException e){throw e;}catch(Exception e){throw failure(e);}
    }
    public synchronized <T>T mutate(Function<Map<String,Object>,T> action) throws Exception {
        try(Connection c=config.connect(true)) {
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);c.setAutoCommit(false);
            try{
                lock(c);requireAccount(c);Map<String,Object> before=mapper.read(c,username);
                Map<String,Object> after=Json.object(Json.parse(Json.write(before)));T result=action.apply(after);
                Vault.validateState(after);mapper.writeChanges(c,before,after);bump(c);c.commit();return result;
            }catch(Exception e){rollback(c);throw e;}
        }
    }
    public synchronized void changePassword(String current,String next) throws Exception {
        Vault.validatePassword(next);
        try(Connection c=config.connect(true)) {
            c.setAutoCommit(false);
            try{
                lock(c);requireAccount(c);String saved=scalar(c,"SELECT password_hash FROM lw_user WHERE id=? FOR UPDATE",userId);
                if(!DatabaseCrypto.verifyPassword(current,saved))throw new ApiException(401,"当前密码不正确");
                execute(c,"UPDATE lw_user SET password_hash=?,password_ciphertext=?,version=version+1,updated_at=UTC_TIMESTAMP(6) WHERE id=?",DatabaseCrypto.hashPassword(next),crypto.encryptLoginPassword(userId,next),userId);
                c.commit();backupCipher=new Vault.BackupCipher(next);
            }catch(Exception e){rollback(c);throw e;}
        }
    }
    synchronized String recoveryEmail(String account) throws Exception {
        try(Connection c=config.connect(true)) {
            return scalar(c,"SELECT u.recovery_email FROM lw_user u JOIN lw_workspace_member m ON m.user_id=u.id JOIN lw_member_role r ON r.member_id=m.id WHERE u.username=? AND u.status='enabled' AND m.status='enabled' AND r.role_code='administrator'",account);
        }
    }
    synchronized void bindRecoveryEmail(String email) throws Exception {
        try(Connection c=config.connect(true)) {
            c.setAutoCommit(false);
            try { lock(c);requireAccount(c);execute(c,"UPDATE lw_user SET recovery_email=?,version=version+1,updated_at=UTC_TIMESTAMP(6) WHERE id=?",email,userId);c.commit(); }
            catch(Exception error){rollback(c);throw error;}
        }
    }
    synchronized MysqlStore resetAccountPassword(String account,String next) throws Exception {
        Vault.validatePassword(next);
        try(Connection c=config.connect(true)) {
            c.setAutoCommit(false);
            try {
                String id=scalar(c,"SELECT u.id FROM lw_user u JOIN lw_workspace_member m ON m.user_id=u.id JOIN lw_member_role r ON r.member_id=m.id WHERE u.username=? AND u.status='enabled' AND m.status='enabled' AND r.role_code='administrator' FOR UPDATE",account);
                if(id.isEmpty())throw new ApiException(400,"验证码不正确或已失效，请重新获取");
                execute(c,"UPDATE lw_user SET password_hash=?,password_ciphertext=?,version=version+1,updated_at=UTC_TIMESTAMP(6) WHERE id=?",DatabaseCrypto.hashPassword(next),crypto.encryptLoginPassword(id,next),id);c.commit();
            }catch(Exception error){rollback(c);throw error;}
        }
        return loginAccount(account,next);
    }
    public synchronized byte[] backup() throws Exception {
        if(backupCipher==null)throw new ApiException(401,"请先登录");
        return backupCipher.encrypt(read());
    }
    public Path attachmentDirectory() { return config.data.resolve("attachments").resolve(workspace); }
    public synchronized byte[] encodeBackup(Map<String,Object> state) throws Exception {
        if(backupCipher==null)throw new ApiException(401,"请先登录");
        return backupCipher.encrypt(state);
    }
    public synchronized void restore(byte[] encoded,String password) throws Exception {
        if(encoded.length>8*1024*1024||password.length()>128)throw new ApiException(400,"备份文件过大或密码格式不正确");
        Map<String,Object> loaded=Vault.readBackup(encoded,password);
        restoreState(loaded);
    }
    public synchronized void restoreState(Map<String,Object> loaded) throws Exception {
        Vault.validateState(loaded);
        // Importing another account's backup creates independent entities in this workspace.
        if(!username.equals(Main.string(loaded,"username"))) reidentify(loaded);
        mutate(state->{state.put("customers",loaded.get("customers"));state.put("papers",loaded.get("papers"));state.put("writers",new ArrayList<>(WriterService.profiles(loaded)));return null;});
    }
    private static void reidentify(Map<String,Object> state) {
        Map<String,String> ids=new HashMap<>();
        for(Object item:WriterService.profiles(state))remapIds(Json.object(item),ids,"id");
        for(Object item:Json.array(state.get("customers")))remapIds(Json.object(item),ids,"id");
        for(Object item:Json.array(state.get("papers"))) {
            Map<String,Object> paper=Json.object(item);
            remapIds(paper,ids,"id","customerId","activeSubmissionId","writerId","writerAssignmentId");
            for(Object a:WriterAssignments.all(paper))remapIds(Json.object(a),ids,"id","writerId");
            for(Object sub:Json.array(paper.get("submissions")))remapIds(Json.object(sub),ids,"id");
            for(Object tx:Json.array(paper.get("transactions")))remapIds(Json.object(tx),ids,"id");
            for(Object account:PublicationFees.accounts(paper))remapIds(Json.object(account),ids,"id","submissionId");
            for(Object tx:Json.array(paper.get("transactions")))remapIds(Json.object(tx),ids,"reversalOf","correctsTransactionId","publicationAccountId","writerId","writerAssignmentId");
            for(Object event:FinancialLedger.audits(paper))remapIds(Json.object(event),ids,"id","transactionId","reversalOf","correctsTransactionId","publicationAccountId","writerId","writerAssignmentId");
            for(Object file:AttachmentService.files(paper))remapIds(Json.object(file),ids,"transactionId");
            for(Object event:Json.array(paper.get("history")))remapIds(Json.object(event),ids,"id","submissionId");
        }
    }
    private static void remapIds(Map<String,Object> entity,Map<String,String> ids,String... fields) {
        for(String field:fields) {
            String value=Main.string(entity,field);
            if(!value.isEmpty())entity.put(field,ids.computeIfAbsent(value,id->UUID.randomUUID().toString()));
        }
    }
    private void initializeAccount(Map<String,Object> state,String account,String password,String sourceHash) throws Exception {
        Vault.validateState(state);
        try(Connection c=config.connect(true)) {
            c.setAutoCommit(false);
            try{
                lock(c);
                if(memberCount(c)>0)throw new ApiException(409,"数据库已初始化，未覆盖现有账号或业务记录，请直接登录");
                if(sourceHash!=null)importLegacyFiles(state);
                String id=UUID.randomUUID().toString(),member=UUID.randomUUID().toString();
                execute(c,"INSERT INTO lw_user(id,username,password_hash,password_ciphertext,status,version,created_at,updated_at) VALUES(?,?,?,?,'enabled',1,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",id,account,DatabaseCrypto.hashPassword(password),crypto.encryptLoginPassword(id,password));
                execute(c,"INSERT INTO lw_workspace_member(id,workspace_id,user_id,status,created_at) VALUES(?,?,?,'enabled',UTC_TIMESTAMP(6))",member,workspace,id);
                execute(c,"INSERT INTO lw_member_role(member_id,role_code) VALUES(?,'administrator')",member);
                mapper.writeChanges(c,emptyState(account),state);
                if(sourceHash!=null)execute(c,"UPDATE lw_storage_meta SET legacy_import_sha256=? WHERE workspace_id=?",sourceHash,workspace);
                bump(c);c.commit();
            }catch(Exception e){rollback(c);throw e;}
        }
    }
    private static Map<String,Object> emptyState(String username){Map<String,Object> state=new LinkedHashMap<>();state.put("schema",2);state.put("username",username);state.put("customers",new ArrayList<>());state.put("papers",new ArrayList<>());return state;}
    private void importLegacyFiles(Map<String,Object> state) throws Exception {
        List<Map<String,Object>> entries=AttachmentService.all(state);if(entries.isEmpty())return;
        AttachmentService source=new AttachmentService(new Vault(config.data));byte[] key=source.key(false);
        Path destination=attachmentDirectory();Files.createDirectories(destination);Path keyPath=destination.resolve("files.key");
        if(Files.exists(keyPath)&&!Arrays.equals(Base64.getDecoder().decode(Files.readString(keyPath).trim()),key))throw new IllegalStateException("旧稿件密钥与目标附件目录不匹配");
        if(!Files.exists(keyPath))Files.copy(source.directory.resolve("files.key"),keyPath);
        for(Map<String,Object> file:entries) {
            String id=Main.string(file,"id");Path plain=Files.createTempFile(destination,"migrate-",".tmp");
            try {
                try(java.io.InputStream input=Files.newInputStream(source.blob(id))){AttachmentService.decrypt(input,plain,key,id,PaperService.number(file.get("size")));}
                if(Files.size(plain)!=PaperService.number(file.get("size"))||!AttachmentService.hash(plain).equals(Main.string(file,"sha256")))throw new IllegalStateException("旧稿件文件完整性校验失败");
                Files.copy(source.blob(id),destination.resolve(id+".bin"),StandardCopyOption.REPLACE_EXISTING);
            }finally{Files.deleteIfExists(plain);}
        }
    }
    private void requireAccount(Connection c)throws SQLException {
        if(userId.isEmpty()||scalar(c,"SELECT u.id FROM lw_user u JOIN lw_workspace_member m ON m.user_id=u.id JOIN lw_member_role r ON r.member_id=m.id WHERE u.id=? AND m.workspace_id=? AND u.status='enabled' AND m.status='enabled' AND r.role_code='administrator'",userId,workspace).isEmpty())throw new ApiException(401,"账号已失效，请重新登录");
    }
    private long memberCount(Connection c)throws SQLException{return Long.parseLong(scalar(c,"SELECT COUNT(*) FROM lw_workspace_member WHERE workspace_id=?",workspace));}
    private void lock(Connection c)throws SQLException {try(PreparedStatement s=c.prepareStatement("SELECT state_revision FROM lw_workspace WHERE id=? FOR UPDATE")){s.setString(1,workspace);try(ResultSet r=s.executeQuery()){if(!r.next())throw new SQLException("Workspace missing");}}}
    private void bump(Connection c)throws SQLException{execute(c,"UPDATE lw_workspace SET state_revision=state_revision+1,updated_at=UTC_TIMESTAMP(6) WHERE id=?",workspace);}

    private void initializeSchema() throws Exception {
        try(Connection ignored=config.connect(true)){}
        catch(SQLException e){
            if(e.getErrorCode()!=1049)throw e;
            try(Connection c=config.connect(false);Statement statement=c.createStatement()){statement.executeUpdate("CREATE DATABASE IF NOT EXISTS `"+config.database()+"` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");}
        }
        String script=Files.readString(config.root.resolve("db/mysql/V001__initial_schema.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        try(Connection c=config.connect(true)){
            String lockName="paperdesk-schema-"+config.database();
            if(!scalar(c,"SELECT GET_LOCK(?,15)",lockName).equals("1"))throw new IllegalStateException("数据库结构正由另一个实例初始化，请稍后重试");
            try{
                try(Statement statement=c.createStatement()){for(String sql:script.split(";"))if(!sql.isBlank())statement.execute(sql);}
                String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=1");
                if(!saved.isEmpty()&&!saved.equals(checksum))throw new IllegalStateException("已执行的数据库迁移脚本校验不一致，请勿修改已发布的 V001 脚本");
                execute(c,"INSERT IGNORE INTO lw_schema_version(version,description,checksum,installed_at) VALUES(1,?,?,UTC_TIMESTAMP(6))","客户、论文、写作、投稿、流水及角色关联初始结构",checksum);
                migrateCustomerCooperationDate(c);
                migratePaperServiceType(c);
                migrateCustomerPaymentDeposit(c);
                migratePaperFiles(c);
                migrateFollowUpReason(c);
                migrateCustomerClassification(c);
                migrateServiceTermination(c);
                migratePublicationFees(c);
                migrateFinancialAudit(c);
                migrateAuthorBio(c);
                migrateExpectedPublication(c);
                migrateFollowUpTasks(c);
                migrateRecoveryEmail(c);
                migrateLoginPasswordCopy(c);
                migrateWriters(c);
                migrateWriterAssignments(c);
                execute(c,"INSERT IGNORE INTO lw_workspace(id,name,state_revision,created_at,updated_at) VALUES(?,?,0,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",WORKSPACE,"知序工作空间");
                seedRoles(c);
            }finally{scalar(c,"SELECT RELEASE_LOCK(?)",lockName);}
        }
    }
    private void migrateWriterAssignments(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V017__writer_assignments.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=17");
        if(!saved.isEmpty()){if(!saved.equals(checksum))throw new IllegalStateException("V017 checksum mismatch");return;}
        for(String sql:script.split(";"))if(!sql.isBlank()) {
            if(sql.strip().startsWith("ALTER TABLE")) {
                String[] tokens=sql.strip().split("\\s+");
                String exists=scalar(c,"SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?",tokens[2],tokens[5]);
                if(!exists.isEmpty())continue;
            }
            try(Statement statement=c.createStatement()){statement.execute(sql);}
        }
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(17,?,?,UTC_TIMESTAMP(6))","Writer assignments",checksum);
    }
    private void migrateWriters(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V016__writer_profiles.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=16");
        if(!saved.isEmpty()){if(!saved.equals(checksum))throw new IllegalStateException("V016 数据库迁移脚本校验不一致");return;}
        try(Statement statement=c.createStatement()){for(String sql:script.split(";"))if(!sql.isBlank())statement.execute(sql);}
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(16,?,?,UTC_TIMESTAMP(6))","写作者档案",checksum);
    }
    private void migrateCustomerCooperationDate(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V002__customer_cooperation_date.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=2");
        if(!saved.isEmpty()) {
            if(!saved.equals(checksum))throw new IllegalStateException("已执行的 V002 数据库迁移脚本校验不一致，请勿修改已发布的脚本");
            return;
        }
        // MySQL DDL commits implicitly. If recording the version failed after ALTER, retry safely.
        String column=scalar(c,"SELECT CONCAT(data_type,':',is_nullable) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='lw_customer' AND column_name='cooperation_started_at'");
        if(column.isEmpty()) {
            try(Statement statement=c.createStatement()){for(String sql:script.split(";"))if(!sql.isBlank())statement.execute(sql);}
        } else if(!column.equals("date:YES"))throw new IllegalStateException("客户合作开始日期字段格式不兼容，需要允许为空的 DATE 字段");
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(2,?,?,UTC_TIMESTAMP(6))","客户合作开始日期",checksum);
    }
    private void migratePaperServiceType(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V003__paper_service_type.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=3");
        if(!saved.isEmpty()) {
            if(!saved.equals(checksum))throw new IllegalStateException("已执行的 V003 数据库迁移脚本校验不一致，请勿修改已发布的脚本");
            return;
        }
        String column=scalar(c,"SELECT CONCAT(data_type,':',character_maximum_length,':',is_nullable,':',column_default) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='lw_paper' AND column_name='service_type'");
        if(column.isEmpty()) {
            try(Statement statement=c.createStatement()){for(String sql:script.split(";"))if(!sql.isBlank())statement.execute(sql);}
        } else if(!column.equals("varchar:20:NO:full"))throw new IllegalStateException("论文服务类型字段格式不兼容，需要默认 full 的 VARCHAR(20) 非空字段");
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(3,?,?,UTC_TIMESTAMP(6))","论文全包与半包服务类型",checksum);
    }
    private void migrateCustomerPaymentDeposit(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V004__customer_payment_deposit.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=4");
        if(!saved.isEmpty()) {
            if(!saved.equals(checksum))throw new IllegalStateException("已执行的 V004 数据库迁移脚本校验不一致，请勿修改已发布的脚本");
            return;
        }
        String column=scalar(c,"SELECT CONCAT(data_type,':',is_nullable,':',column_default) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='lw_paper' AND column_name='contract_deposit_cents'");
        if(column.isEmpty()) {
            try(Statement statement=c.createStatement()){for(String sql:script.split(";"))if(!sql.isBlank())statement.execute(sql);}
        } else if(!column.equals("bigint:NO:0"))throw new IllegalStateException("客户定金字段格式不兼容，需要默认 0 的 BIGINT 非空字段");
        String constraint=scalar(c,"SELECT constraint_type FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='lw_paper' AND constraint_name='ck_paper_contract_deposit' AND enforced='YES'");
        if(!constraint.equals("CHECK"))throw new IllegalStateException("客户定金金额约束缺失，请检查 V004 升级状态");
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(4,?,?,UTC_TIMESTAMP(6))","客户收款定金约定",checksum);
    }
    private void migratePaperFiles(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V005__paper_files.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=5");
        if(!saved.isEmpty()) {
            if(!saved.equals(checksum))throw new IllegalStateException("V005 数据库迁移脚本校验不一致");
            return;
        }
        try(Statement statement=c.createStatement()){for(String sql:script.split(";"))if(!sql.isBlank())statement.execute(sql);}
        if(scalar(c,"SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='lw_submission' AND column_name='manuscript_id'").equals("0"))
            try(Statement statement=c.createStatement()){statement.execute("ALTER TABLE lw_submission ADD COLUMN manuscript_id VARCHAR(36) NOT NULL DEFAULT '' COMMENT '本次投稿使用的论文文件版本 UUID'");}
        // Recreating the V005 table must also restore extensions from an already installed V010.
        if(!scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=10").isEmpty()) {
            String extensions=Files.readString(config.root.resolve("db/mysql/V010__submission_costs_and_financial_audit.sql"),StandardCharsets.UTF_8);
            try(Statement statement=c.createStatement()) {
                for(String sql:extensions.split(";"))if(sql.stripLeading().startsWith("ALTER TABLE lw_paper_file "))try{statement.execute(sql);}
                catch(SQLException e){if(!Set.of(1060,1061,1091).contains(e.getErrorCode()))throw e;}
            }
        }
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(5,?,?,UTC_TIMESTAMP(6))","论文文件与稿件版本",checksum);
    }
    private void migrateFollowUpTasks(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V013__follow_up_tasks.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=13");
        if(!saved.isEmpty()){if(!saved.equals(checksum))throw new IllegalStateException("V013 数据库迁移脚本校验不一致");return;}
        try(Statement statement=c.createStatement()){for(String sql:script.split(";"))if(!sql.isBlank())statement.execute(sql);}
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(13,?,?,UTC_TIMESTAMP(6))","独立跟进事项与处理历史",checksum);
    }
    private void migrateRecoveryEmail(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V014__account_recovery_email.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=14");
        if(!saved.isEmpty()){if(!saved.equals(checksum))throw new IllegalStateException("V014 数据库迁移脚本校验不一致");return;}
        String column=scalar(c,"SELECT CONCAT(data_type,':',character_maximum_length,':',is_nullable,':',column_default) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='lw_user' AND column_name='recovery_email'");
        if(column.isEmpty())try(Statement statement=c.createStatement()){statement.execute(script);}
        else if(!column.equals("varchar:254:NO:"))throw new IllegalStateException("账号找回邮箱字段格式不兼容");
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(14,?,?,UTC_TIMESTAMP(6))","账号密码找回邮箱",checksum);
    }

    private void migrateLoginPasswordCopy(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V015__login_password_copy.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=15");
        if(!saved.isEmpty()){if(!saved.equals(checksum))throw new IllegalStateException("V015 数据库迁移脚本校验不一致");return;}
        String column=scalar(c,"SELECT CONCAT(data_type,':',character_maximum_length,':',is_nullable,':',column_default) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='lw_user' AND column_name='password_ciphertext'");
        if(column.isEmpty())try(Statement statement=c.createStatement()){statement.execute(script);}
        else if(!column.equals("varchar:1024:NO:"))throw new IllegalStateException("登录密码加密副本字段格式不兼容");
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(15,?,?,UTC_TIMESTAMP(6))","登录密码加密副本",checksum);
    }

    private void migrateExpectedPublication(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V012__expected_publication.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=12");
        if(!saved.isEmpty()){if(!saved.equals(checksum))throw new IllegalStateException("已执行的 V012 数据库迁移脚本校验不一致");return;}
        if(scalar(c,"SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='lw_submission' AND column_name='expected_published_at'").equals("0"))
            try(Statement statement=c.createStatement()){statement.execute(script);}
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(12,?,?,UTC_TIMESTAMP(6))","投稿预计发表日期",checksum);
    }

    private void migrateAuthorBio(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V011__author_bio.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=11");
        if(!saved.isEmpty()) {
            if(!saved.equals(checksum))throw new IllegalStateException("已执行的 V011 数据库迁移脚本校验不一致");
            return;
        }
        String column=scalar(c,"SELECT CONCAT(data_type,':',character_maximum_length,':',is_nullable,':',column_default) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='lw_paper' AND column_name='author_bio'");
        if(column.isEmpty()) {
            try(Statement statement=c.createStatement()){for(String sql:script.split(";"))if(!sql.isBlank())statement.execute(sql);}
        }else if(!column.equals("varchar:2000:NO:"))throw new IllegalStateException("作者简介字段格式不兼容");
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(11,?,?,UTC_TIMESTAMP(6))","论文作者简介",checksum);
    }
    private void migrateFollowUpReason(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V006__follow_up_reason.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=6");
        if(!saved.isEmpty()) {
            if(!saved.equals(checksum))throw new IllegalStateException("已执行的 V006 数据库迁移脚本校验不一致");
            return;
        }
        String column=scalar(c,"SELECT CONCAT(data_type,':',character_maximum_length,':',is_nullable,':',column_default) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='lw_paper' AND column_name='follow_up_reason'");
        if(column.isEmpty()) {
            try(Statement statement=c.createStatement()){for(String sql:script.split(";"))if(!sql.isBlank())statement.execute(sql);}
        }else if(!column.equals("varchar:1000:NO:"))throw new IllegalStateException("跟进事项字段格式不兼容，需要默认空字符串的 VARCHAR(1000) 非空字段");
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(6,?,?,UTC_TIMESTAMP(6))","论文跟进事项与由来",checksum);
    }
    private void migrateCustomerClassification(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V007__customer_classification.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=7");
        if(!saved.isEmpty()) {
            if(!saved.equals(checksum))throw new IllegalStateException("已执行的 V007 数据库迁移脚本校验不一致");
            return;
        }
        List<String> statements=Arrays.stream(script.split(";")).filter(sql->!sql.isBlank()).toList();
        String[] columns={"customer_type","referrer"},formats={"varchar:20:NO:","varchar:200:NO:"};
        if(statements.size()!=columns.length)throw new IllegalStateException("V007 数据库迁移脚本格式不正确");
        // Resume each ALTER independently after an interrupted MySQL DDL operation.
        for(int i=0;i<columns.length;i++) {
            String column=scalar(c,"SELECT CONCAT(data_type,':',character_maximum_length,':',is_nullable,':',column_default) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='lw_customer' AND column_name=?",columns[i]);
            if(column.isEmpty()) {
                try(Statement statement=c.createStatement()){statement.execute(statements.get(i));}
            }else if(!column.equals(formats[i]))throw new IllegalStateException("客户分类字段格式不兼容："+columns[i]);
        }
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(7,?,?,UTC_TIMESTAMP(6))","客户类型与介绍人",checksum);
    }
    private void migrateServiceTermination(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V008__service_termination.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=8");
        if(!saved.isEmpty()) {
            if(!saved.equals(checksum))throw new IllegalStateException("已执行的 V008 数据库迁移脚本校验不一致");
            return;
        }
        try(Statement statement=c.createStatement()){for(String sql:script.split(";"))if(!sql.isBlank())statement.execute(sql);}
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(8,?,?,UTC_TIMESTAMP(6))","论文服务终止及独立结算",checksum);
    }
    private void migratePublicationFees(Connection c) throws Exception {
        String script=Files.readString(config.root.resolve("db/mysql/V009__publication_fees.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=9");
        if(!saved.isEmpty()) {
            if(!saved.equals(checksum))throw new IllegalStateException("已执行的 V009 数据库迁移脚本校验不一致");
            return;
        }
        try(Statement statement=c.createStatement()){for(String sql:script.split(";"))if(!sql.isBlank())statement.execute(sql);}
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(9,?,?,UTC_TIMESTAMP(6))","版面费承担方式及利润核算",checksum);
    }
    private void migrateFinancialAudit(Connection c)throws Exception{
        String script=Files.readString(config.root.resolve("db/mysql/V010__submission_costs_and_financial_audit.sql"),StandardCharsets.UTF_8);
        String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(script.getBytes(StandardCharsets.UTF_8)));
        String saved=scalar(c,"SELECT checksum FROM lw_schema_version WHERE version=10");
        if(!saved.isEmpty()){if(!saved.equals(checksum))throw new IllegalStateException("已执行的 V010 数据库迁移脚本校验不一致");return;}
        try(Statement statement=c.createStatement()){
            for(String sql:script.split(";"))if(!sql.isBlank())try{statement.execute(sql);}catch(SQLException e){
                // MySQL DDL commits independently: resume safely after an interrupted upgrade.
                if(!sql.stripLeading().startsWith("ALTER TABLE ")||!Set.of(1060,1061,1091).contains(e.getErrorCode()))throw e;
            }
        }
        execute(c,"INSERT INTO lw_financial_audit(id,workspace_id,paper_id,action,actor,event_at,transaction_id,type,amount_cents,occurred_at,method,note,reason) SELECT UUID(),t.workspace_id,t.paper_id,'record',COALESCE(NULLIF(t.actor,''),'历史记录（操作人未知）'),t.created_at,t.id,t.type,t.amount_cents,t.occurred_at,t.method,t.note,'迁移前历史流水；操作人资料不可恢复' FROM lw_financial_transaction t WHERE NOT EXISTS(SELECT 1 FROM lw_financial_audit a WHERE a.workspace_id=t.workspace_id AND a.transaction_id=t.id AND a.action='record')");
        execute(c,"INSERT INTO lw_schema_version(version,description,checksum,installed_at) VALUES(10,?,?,UTC_TIMESTAMP(6))","投稿版面费分账、收支冲销、凭证与操作留痕",checksum);
    }
    private void seedRoles(Connection c)throws SQLException{
        String[][] roles={{"administrator","空间管理员","当前本机账号，负责全部业务"},{"manager","业务主管","预留：业务管理及任务分配"},{"writer","写作人员","预留：分配给自己的写作任务"},{"submission","投稿专员","预留：分配给自己的投稿记录"},{"finance","财务人员","预留：收支与费用管理"},{"readonly","只读人员","预留：授权范围内的只读查看"}};
        for(String[] role:roles)execute(c,"INSERT IGNORE INTO lw_role(code,name,description) VALUES(?,?,?)",(Object[])role);
        String[][] permissions={{"customer.read","查看客户"},{"customer.write","维护客户"},{"paper.read","查看论文"},{"paper.write","维护论文"},{"writing.read","查看写作任务"},{"writing.write","维护写作任务"},{"writing.assign","分配写作任务"},{"submission.read","查看投稿"},{"submission.write","维护投稿"},{"submission.assign","分配投稿"},{"credential.reveal","显式查看投稿密码"},{"finance.read","查看费用流水"},{"finance.write","登记收支"},{"finance.reverse","财务冲正（预留）"},{"export.customer","导出客户汇总"},{"export.paper","导出论文"},{"export.writing","导出写作记录"},{"export.submission","导出投稿"},{"export.finance","导出流水"},{"backup.download","下载加密备份"},{"backup.restore","恢复业务备份"},{"member.manage","管理空间成员（预留）"},{"role.manage","管理角色（预留）"}};
        for(String[] permission:permissions){execute(c,"INSERT IGNORE INTO lw_permission(code,name) VALUES(?,?)",(Object[])permission);execute(c,"INSERT IGNORE INTO lw_role_permission(role_code,permission_code) VALUES('administrator',?)",permission[0]);}
    }
    static String scalar(Connection c,String sql,Object...parameters)throws SQLException{
        try(PreparedStatement s=c.prepareStatement(sql)){for(int i=0;i<parameters.length;i++)s.setObject(i+1,parameters[i]);try(ResultSet r=s.executeQuery()){return r.next()?Objects.toString(r.getObject(1),""):"";}}
    }
    static int execute(Connection c,String sql,Object...parameters)throws SQLException{
        try(PreparedStatement s=c.prepareStatement(sql)){for(int i=0;i<parameters.length;i++)s.setObject(i+1,parameters[i]);return s.executeUpdate();}
    }
    private static void rollback(Connection c){try{c.rollback();}catch(SQLException ignored){}}
    private static IllegalStateException failure(Exception e){return new IllegalStateException("数据库读取失败，请检查 MySQL 服务、连接配置及密钥文件",e);}
}
