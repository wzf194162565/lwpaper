import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.BindException;
import java.net.InetSocketAddress;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** 本机论文投稿管理服务，支持加密文件或 MySQL 存储。 */
public class Main {
    private final AccountRegistry accounts;
    private final Path webRoot;
    private final int port;
    private final SmtpMailer mailer;
    private final RecoveryCodes recoveryCodes;
    private final RecoveryCodes registrationCodes;
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    private final Map<String, List<Long>> attempts = new ConcurrentHashMap<>();
    private record Session(String csrf, long expires, ApplicationStore store) {}
    private static final long SESSION_MS = 8 * 60 * 60 * 1000L;

    private Main(ApplicationStore store, Path data, Path web, int port, DatabaseConfig config) {
        this.accounts = new AccountRegistry(store, data);
        this.webRoot = web;
        this.port = port;
        this.mailer=new SmtpMailer(config);
        this.recoveryCodes=new RecoveryCodes(mailer::sendCode);
        this.registrationCodes=new RecoveryCodes(mailer::sendRegistrationCode);
    }

    public static void main(String[] args) throws Exception {
        int port = Integer.parseInt(System.getProperty("app.port", "8080"));
        Path root = Path.of(System.getProperty("app.root", ".")).toAbsolutePath().normalize();
        Path data = Path.of(System.getProperty("app.data", root.resolve("data").toString())).toAbsolutePath().normalize();
        DatabaseConfig config = new DatabaseConfig(root, data);
        if(System.getProperty("app.fileMaxMb")==null)System.setProperty("app.fileMaxMb",config.value("app.fileMaxMb","APP_FILE_MAX_MB","50"));
        AttachmentService.maxBytes();
        Files.createDirectories(data);
        FileChannel channel = FileChannel.open(data.resolve("app.lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        FileLock lock = channel.tryLock();
        if (lock == null) {
            channel.close();
            System.out.println("知序已经在运行，当前数据目录正由另一个服务实例使用：");
            System.out.println(data);
            System.out.println("请使用已启动的服务；若要在 IDEA 中运行，请先停止之前启动的服务。");
            return;
        }
        Main app;
        HttpServer server;
        try {
            ApplicationStore store = config.storage.equals("mysql") ? new MysqlStore(config) : new Vault(data);
            app = new Main(store, data, root.resolve("web"), port, config);
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        } catch (Exception e) {
            lock.release();
            channel.close();
            if (e instanceof BindException) {
                System.out.println("端口 " + port + " 已被其他程序占用，服务未启动。");
                System.out.println("请停止占用该端口的程序，或通过 VM 参数 -Dapp.port=8088 更换端口。");
                return;
            }
            throw e;
        }
        ExecutorService executor = Executors.newFixedThreadPool(8);
        server.setExecutor(executor);
        server.createContext("/", app::handle);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.stop(1);
            executor.shutdown();
            try { lock.release(); channel.close(); } catch (IOException ignored) {}
        }));
        server.start();
        System.out.println("Paper Desk is ready: http://127.0.0.1:" + port);
        System.out.println("Storage: " + app.accounts.storageType());
        System.out.println("Data and keys: " + data);
        System.out.println("Press Ctrl+C to stop.");
    }

    private void handle(HttpExchange ex) throws IOException {
        try {
            headers(ex);
            String host = ex.getRequestHeaders().getFirst("Host");
            if (!Set.of("127.0.0.1:" + port, "localhost:" + port).contains(host == null ? "" : host)) throw new ApiException(403, "请通过本机地址访问系统");
            String path = ex.getRequestURI().getPath();
            if (!path.startsWith("/api/")) { serveStatic(ex, path); return; }
            String method = ex.getRequestMethod();
            if (!Set.of("GET", "POST", "PUT", "DELETE").contains(method)) throw new ApiException(405, "不支持的请求方法");
            boolean mutation = !method.equals("GET");
            if (mutation) {
                String origin = ex.getRequestHeaders().getFirst("Origin");
                if (origin != null && !origin.equals("http://" + host)) throw new ApiException(403, "请求来源无效");
                String type = ex.getRequestHeaders().getFirst("Content-Type");
                boolean binary=method.equals("POST")&&(path.matches("/api/papers/[0-9a-f\\-]{36}/files")||path.equals("/api/restore-archive"));
                String expected=binary?"application/octet-stream":"application/json";
                if (type == null || !type.toLowerCase(Locale.ROOT).split(";",2)[0].trim().equals(expected)) throw new ApiException(415, "请求格式不正确");
            }
            if (path.equals("/api/session") && method.equals("GET")) {
                Session session = session(ex);
                json(ex, 200, Map.ofEntries(Map.entry("initialized",accounts.initialized()),Map.entry("authenticated",session!=null),Map.entry("username",session==null?"":session.store().username()),Map.entry("csrf",session==null?"":session.csrf()),Map.entry("storage",accounts.storageType()),Map.entry("recoveryEmail",session==null?"":accounts.recoveryEmail(session.store().username())),Map.entry("fileMaxBytes",AttachmentService.maxBytes()),Map.entry("customerReceiptTotalsSupported",true),Map.entry("customerReceiptsSupported",true),Map.entry("writerPaymentsSupported",true),Map.entry("terminationSupported",true),Map.entry("publicationFeesSupported",true))); return;
            }
            if(path.equals("/api/register/code")&&method.equals("POST")) {
                Map<String,Object> body=body(ex);
                String username=Vault.validateUsername(string(body,"username")),email=AccountRegistry.registrationEmail(string(body,"email"));
                if(!mailer.configured())throw new ApiException(503,"邮箱验证码服务尚未配置，请联系管理员");
                synchronized(accounts) {
                    accounts.requireRegistrationAvailable(username);
                    registrationCodes.send(username,email,ex.getRemoteAddress().getAddress().getHostAddress(),true);
                }
                json(ex,200,Map.of("message","注册验证码已发送至 QQ 邮箱，请查收。","retryAfter",60));return;
            }
            if(path.equals("/api/register")&&method.equals("POST")) {
                throttle(ex);Map<String,Object> body=body(ex);
                String username=Vault.validateUsername(string(body,"username")),password=string(body,"password"),email=AccountRegistry.registrationEmail(string(body,"email"));
                Vault.validatePassword(password);
                synchronized(accounts) {
                    accounts.requireRegistrationAvailable(username);
                    registrationCodes.consume(username,email,string(body,"code"),ex.getRemoteAddress().getAddress().getHostAddress());
                    accounts.register(username,password,email);registrationCodes.invalidate(username);
                    attempts.remove(ex.getRemoteAddress().getAddress().getHostAddress());
                }
                json(ex,200,Map.of("ok",true,"username",username,"message","注册成功，请使用账号和密码登录。"));return;
            }
            if ((path.equals("/api/setup") || path.equals("/api/login")) && method.equals("POST")) {
                throttle(ex);
                Map<String, Object> credentials = body(ex);
                String username = string(credentials, "username"), password = string(credentials, "password");
                // Keep credential verification and session issuance atomic with password changes.
                synchronized (accounts) {
                    ApplicationStore store = switch (path) {
                        case "/api/login" -> accounts.login(username, password);
                        default -> accounts.setup(username, password);
                    };
                    attempts.remove(ex.getRemoteAddress().getAddress().getHostAddress());
                    json(ex, 200, Map.of("csrf", newSession(ex, store), "username", store.username(),"recoveryEmail",accounts.recoveryEmail(store.username())));
                }
                return;
            }
            if(path.equals("/api/password-reset/code")&&method.equals("POST")) {
                Map<String,Object> body=body(ex);
                String username=Vault.validateUsername(string(body,"username")),email=SmtpMailer.email(string(body,"email"));
                if(!mailer.configured())throw new ApiException(503,"邮箱验证码服务尚未配置，请联系管理员");
                synchronized(accounts) {
                    String bound="";
                    try { bound=accounts.recoveryEmail(username); } catch(ApiException error){if(error.status!=404)throw error;}
                    recoveryCodes.send(username,email,ex.getRemoteAddress().getAddress().getHostAddress(),email.equals(bound));
                }
                json(ex,200,Map.of("message","如果账号与绑定邮箱匹配，验证码将发送至该邮箱，请查收。","retryAfter",60));return;
            }
            if(path.equals("/api/password-reset")&&method.equals("POST")) {
                Map<String,Object> body=body(ex);
                String username=Vault.validateUsername(string(body,"username")),email=SmtpMailer.email(string(body,"email")),next=string(body,"newPassword");
                Vault.validatePassword(next);
                synchronized(accounts) {
                    recoveryCodes.consume(username,email,string(body,"code"),ex.getRemoteAddress().getAddress().getHostAddress());
                    if(!email.equals(accounts.recoveryEmail(username)))throw new ApiException(400,"验证码不正确或已失效，请重新获取");
                    ApplicationStore store=accounts.resetPassword(username,next);invalidateSessions(store);recoveryCodes.invalidate(username);
                }
                json(ex,200,Map.of("ok",true));return;
            }
            Session session = session(ex);
            if (session == null) throw new ApiException(401, "登录已失效，请重新登录");
            if (mutation && !session.csrf().equals(ex.getRequestHeaders().getFirst("X-CSRF-Token"))) throw new ApiException(403, "请求校验失败，请刷新页面");
            ApplicationStore vault = session.store();
            PaperService papers = new PaperService(vault);
            BusinessService business = new BusinessService(vault);
            if(path.equals("/api/account/recovery-email")&&method.equals("GET")) {
                json(ex,200,Map.of("email",accounts.recoveryEmail(vault.username())));return;
            }
            if (path.equals("/api/logout") && method.equals("POST")) {
                sessions.remove(cookie(ex));
                ex.getResponseHeaders().set("Set-Cookie", "paper_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
                json(ex, 200, Map.of("ok", true)); return;
            }
            if (path.equals("/api/password") && method.equals("POST")) {
                throttle(ex);
                Map<String, Object> body = body(ex);
                synchronized (accounts) {
                    if (session(ex) != session) throw new ApiException(401, "登录已失效，请重新登录");
                    vault.changePassword(string(body, "currentPassword"), string(body, "newPassword"));
                    recoveryCodes.invalidate(vault.username());
                    invalidateSessions(vault);
                    json(ex, 200, Map.of("csrf", newSession(ex, vault)));
                }
                return;
            }
            if (path.equals("/api/papers") && method.equals("GET")) { json(ex, 200, papers.list()); return; }
            if (path.equals("/api/account/authors") && method.equals("GET")) { json(ex, 200, business.accountAuthors()); return; }
            if (path.equals("/api/papers") && method.equals("POST")) { json(ex, 201, papers.create(body(ex))); return; }
            if (path.equals("/api/customers") && method.equals("GET")) { json(ex, 200, business.customers()); return; }
            if (path.equals("/api/customers") && method.equals("POST")) { json(ex, 201, business.createCustomer(body(ex))); return; }
            if (path.startsWith("/api/customers/") && !path.substring("/api/customers/".length()).contains("/")) {
                String id = path.substring("/api/customers/".length());
                switch (method) {
                    case "GET" -> json(ex, 200, business.customer(id));
                    case "PUT" -> json(ex, 200, business.updateCustomer(id, body(ex)));
                    case "DELETE" -> { business.deleteCustomer(id, body(ex)); json(ex, 200, Map.of("ok", true)); }
                    default -> throw new ApiException(405, "不支持的请求方法");
                }
                return;
            }
            if (path.startsWith("/api/papers/")) {
                String[] parts = path.substring("/api/papers/".length()).split("/");
                String id = parts[0];
                if(parts.length==2&&parts[1].equals("followups")&&method.equals("POST")) {
                    json(ex,201,papers.saveFollowUp(id,null,body(ex)));return;
                }
                if(parts.length==3&&parts[1].equals("followups")&&method.equals("PUT")) {
                    json(ex,200,papers.saveFollowUp(id,parts[2],body(ex)));return;
                }
                if(parts.length==2&&parts[1].equals("publication-fee")&&method.equals("PUT")) {
                    json(ex,200,papers.publicationFee(id,body(ex)));return;
                }
                if(parts.length==2&&parts[1].equals("termination")&&Set.of("POST","PUT").contains(method)) {
                    json(ex,200,papers.terminate(id,body(ex),method.equals("PUT")));return;
                }
                if(parts.length==2&&parts[1].equals("files")&&method.equals("POST")) {
                    long version;
                    try{version=Long.parseLong(Objects.toString(ex.getRequestHeaders().getFirst("X-Paper-Version"),""));}catch(NumberFormatException e){throw new ApiException(400,"请提供论文版本号");}
                    String length=ex.getRequestHeaders().getFirst("Content-Length");
                    if(length!=null&&Long.parseLong(length)>AttachmentService.maxBytes())throw new ApiException(413,"文件超过允许大小");
                    json(ex,201,new AttachmentService(vault).upload(id,decodedHeader(ex,"X-File-Name"),decodedHeader(ex,"X-File-Note"),version,Objects.toString(ex.getRequestHeaders().getFirst("X-Upload-Id"),""),ex.getRequestBody(),Objects.toString(ex.getRequestHeaders().getFirst("X-Transaction-Id"),"")));return;
                }
                if(parts.length==3&&parts[1].equals("files")&&method.equals("GET")) {
                    synchronized(vault) {
                        AttachmentService files=new AttachmentService(vault);
                        Map<String,Object> file=AttachmentService.find(PaperService.find(vault.read(),id),parts[2]);
                        Path plain=files.download(id,parts[2]);
                        try{sendFile(ex,plain,Main.string(file,"filename"));}finally{Files.deleteIfExists(plain);}
                    }return;
                }
                if (parts.length == 2 && parts[1].equals("submissions") && method.equals("POST")) { json(ex, 201, business.addSubmission(id, body(ex))); return; }
                if (parts.length == 3 && parts[1].equals("submissions")) {
                    switch (method) {
                        case "PUT" -> json(ex, 200, business.updateSubmission(id, parts[2], body(ex)));
                        case "DELETE" -> json(ex, 200, business.deleteSubmission(id, parts[2], body(ex)));
                        default -> throw new ApiException(405, "不支持的请求方法");
                    }
                    return;
                }
                if (parts.length == 4 && parts[1].equals("submissions") && parts[3].equals("credentials") && method.equals("POST")) { json(ex, 200, business.submissionCredentials(id, parts[2])); return; }
                if (parts.length == 1) {
                    switch (method) {
                        case "GET" -> json(ex, 200, papers.get(id));
                        case "PUT" -> json(ex, 200, papers.update(id, body(ex)));
                        case "DELETE" -> {
                            synchronized(vault) {
                                List<Map<String,Object>> files=AttachmentService.files(PaperService.find(vault.read(),id)).stream().map(Json::object).toList();
                                papers.delete(id, body(ex));new AttachmentService(vault).removeBlobs(files);
                            }
                            json(ex, 200, Map.of("ok", true));
                        }
                        default -> throw new ApiException(405, "不支持的请求方法");
                    }
                    return;
                }
                if (parts.length == 2 && parts[1].equals("credentials") && method.equals("POST")) { json(ex, 200, papers.credentials(id)); return; }
                if (parts.length == 2 && parts[1].equals("transactions") && method.equals("POST")) { json(ex, 201, papers.addTransaction(id, body(ex))); return; }
                if(parts.length==4&&parts[1].equals("transactions")&&parts[3].equals("reversal")&&method.equals("POST")){json(ex,200,papers.reverseTransaction(id,parts[2],body(ex)));return;}
                if (parts.length == 3 && parts[1].equals("transactions") && method.equals("DELETE")) { json(ex, 200, papers.deleteTransaction(id, parts[2], body(ex))); return; }
            }
            if (path.equals("/api/backup") && method.equals("GET")) {
                synchronized(vault) {
                    if(!AttachmentService.all(vault.read()).isEmpty()) {
                        Path archive=AttachmentArchive.backup(vault);
                        try{sendFile(ex,archive,"paper-desk-"+java.time.LocalDate.now()+".zip");}finally{Files.deleteIfExists(archive);}
                        return;
                    }
                    ex.getResponseHeaders().set("Content-Disposition", "attachment; filename=paper-desk-" + java.time.LocalDate.now() + ".vault");
                    send(ex, 200, "application/octet-stream", vault.backup()); return;
                }
            }
            if(path.equals("/api/restore-archive")&&method.equals("POST")) {
                AttachmentArchive.restore(vault,ex.getRequestBody(),decodedHeader(ex,"X-Backup-Password"));
                json(ex,200,Map.of("ok",true));return;
            }
            if (path.equals("/api/restore") && method.equals("POST")) {
                Map<String, Object> body = body(ex);
                try {
                    byte[] encoded=Base64.getDecoder().decode(string(body,"backup"));
                    if(encoded.length>8*1024*1024)throw new ApiException(413,"备份文件过大");
                    synchronized(vault) {
                        if(!AttachmentService.all(Vault.readBackup(encoded,string(body,"password"))).isEmpty())throw new ApiException(400,"包含稿件的备份请使用完整 ZIP 备份恢复");
                        List<Map<String,Object>> previous=AttachmentService.all(vault.read());
                        vault.restore(encoded,string(body,"password"));new AttachmentService(vault).removeBlobs(previous);
                    }
                }
                catch (IllegalArgumentException e) { throw new ApiException(400, "备份文件格式不正确"); }
                json(ex, 200, Map.of("ok", true)); return;
            }
            throw new ApiException(404, "请求的内容不存在");
        } catch (ApiException e) {
            if (e.status == 401) json(ex, e.status, Map.of("error", e.getMessage(), "authenticated", session(ex) != null,"code",ex.getRequestURI().getPath().equals("/api/login")?"INVALID_CREDENTIALS":"UNAUTHORIZED"));
            else json(ex, e.status, Map.of("error", e.getMessage()));
        }
        catch (Exception e) {
            System.err.println("Request failed: " + e.getClass().getSimpleName());
            json(ex, 500, Map.of("error", "操作未完成，请稍后重试；如持续出现，请检查存储服务、连接配置和磁盘空间"));
        } finally { ex.close(); }
    }

    private void serveStatic(HttpExchange ex, String path) throws IOException {
        if (!ex.getRequestMethod().equals("GET")) throw new ApiException(405, "不支持的请求方法");
        String file = switch (path) {
            case "/", "/index.html" -> "index.html";
            case "/app.js" -> "app.js";
            case "/business.js" -> "business.js";
            case "/files.js" -> "files.js";
            case "/ledger.js" -> "ledger.js";
            case "/followups.js" -> "followups.js";
            case "/styles.css" -> "styles.css";
            case "/favicon.svg" -> "favicon.svg";
            default -> throw new ApiException(404, "页面不存在");
        };
        String type = file.endsWith(".js") ? "text/javascript; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : file.endsWith(".svg") ? "image/svg+xml" : "text/html; charset=utf-8";
        send(ex, 200, type, Files.readAllBytes(webRoot.resolve(file)));
    }

    private void headers(HttpExchange ex) {
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        ex.getResponseHeaders().set("X-Frame-Options", "DENY");
        ex.getResponseHeaders().set("Referrer-Policy", "no-referrer");
        ex.getResponseHeaders().set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    }

    private void throttle(HttpExchange ex) {
        String ip = ex.getRemoteAddress().getAddress().getHostAddress();
        synchronized (attempts) {
            long now = System.currentTimeMillis();
            List<Long> list = attempts.computeIfAbsent(ip, k -> new ArrayList<>());
            list.removeIf(t -> t < now - 60_000);
            if (list.size() >= 5) throw new ApiException(429, "尝试次数过多，请一分钟后重试");
            list.add(now);
        }
    }

    private void invalidateSessions(ApplicationStore store) {
        sessions.entrySet().removeIf(entry -> entry.getValue().store().username().equals(store.username()));
    }

    private String newSession(HttpExchange ex, ApplicationStore store) {
        long now = System.currentTimeMillis();
        sessions.entrySet().removeIf(entry -> entry.getValue().expires < now);
        String token = Vault.token(), csrf = Vault.token();
        sessions.remove(cookie(ex));
        sessions.put(token, new Session(csrf, now + SESSION_MS, store));
        ex.getResponseHeaders().set("Set-Cookie", "paper_session=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800");
        return csrf;
    }

    private Session session(HttpExchange ex) {
        String token = cookie(ex);
        Session session = sessions.get(token);
        if (session != null && session.expires < System.currentTimeMillis()) { sessions.remove(token); return null; }
        return session;
    }

    private String cookie(HttpExchange ex) {
        String cookie = ex.getRequestHeaders().getFirst("Cookie");
        if (cookie != null) for (String item : cookie.split(";")) {
            String[] pair = item.trim().split("=", 2);
            if (pair.length == 2 && pair[0].equals("paper_session")) return pair[1];
        }
        return "";
    }

    private Map<String, Object> body(HttpExchange ex) throws IOException {
        byte[] bytes = ex.getRequestBody().readNBytes(12 * 1024 * 1024 + 1);
        if (bytes.length > 12 * 1024 * 1024) throw new ApiException(413, "请求过大，单次请求最多 12MB");
        try { return Json.object(Json.parse(new String(bytes, StandardCharsets.UTF_8))); }
        catch (IllegalArgumentException e) { throw new ApiException(400, "JSON 格式不正确"); }
    }

    static String string(Map<String, Object> body, String key) { return body.get(key) instanceof String s ? s : ""; }
    private void json(HttpExchange ex, int code, Object body) throws IOException { send(ex, code, "application/json; charset=utf-8", Json.write(body).getBytes(StandardCharsets.UTF_8)); }
    private void send(HttpExchange ex, int code, String type, byte[] bytes) throws IOException {
        ex.getResponseHeaders().set("Content-Type", type);
        ex.sendResponseHeaders(code, bytes.length);
        ex.getResponseBody().write(bytes);
    }
    private static String decodedHeader(HttpExchange ex,String name) {
        try{return URLDecoder.decode(Objects.toString(ex.getRequestHeaders().getFirst(name),""),StandardCharsets.UTF_8);}
        catch(IllegalArgumentException e){throw new ApiException(400,"文件请求参数格式无效");}
    }
    private void sendFile(HttpExchange ex,Path file,String name) throws IOException {
        String encoded=URLEncoder.encode(name,StandardCharsets.UTF_8).replace("+","%20");
        ex.getResponseHeaders().set("Content-Type","application/octet-stream");
        ex.getResponseHeaders().set("Content-Disposition","attachment; filename=paper-desk-download; filename*=UTF-8''"+encoded);
        ex.sendResponseHeaders(200,Files.size(file));
        try(OutputStream output=ex.getResponseBody()){Files.copy(file,output);}
    }
}

class ApiException extends RuntimeException {
    final int status;
    ApiException(int status, String message) { super(message); this.status = status; }
}
