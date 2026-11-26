import javax.net.ssl.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** SMTP delivery with certificate-checked TLS; credentials and codes are never logged. */
public final class SmtpMailer {
    private final DatabaseConfig config;
    public SmtpMailer(DatabaseConfig config) { this.config = config; }
    public boolean configured() { return !setting("host", "").isBlank() && !setting("from", "").isBlank(); }
    private String setting(String name, String fallback) {
        String value=config.value("mail." + name, "MAIL_" + name.toUpperCase(Locale.ROOT), fallback);
        if(!name.equals("password"))value=value.strip();
        return name.equals("security")?value.toLowerCase(Locale.ROOT):value;
    }
    static String email(String value) {
        String result = value.trim().toLowerCase(Locale.ROOT);
        if (result.length() > 254 || !result.matches("[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\\.[a-z]{2,63}") || result.startsWith(".") || result.contains(".."))
            throw new ApiException(400, "请输入有效的邮箱地址");
        return result;
    }
    public void sendCode(String recipient, String code) throws Exception {
        sendCode(recipient,code,false);
    }
    public void sendRegistrationCode(String recipient,String code) throws Exception {
        sendCode(recipient,code,true);
    }
    private void sendCode(String recipient,String code,boolean registration) throws Exception {
        if (!configured()) throw new ApiException(503, "邮箱验证码服务尚未配置，请联系管理员");
        String host = setting("host", ""), security = setting("security", "starttls");
        String from = email(setting("from", "")), to = email(recipient);
        if (!Set.of("ssl", "starttls", "none").contains(security)) throw new ApiException(503, "邮箱验证码服务配置不正确");
        if (security.equals("none") && !Set.of("127.0.0.1", "localhost", "::1").contains(host)) throw new ApiException(503, "邮件服务器必须使用 TLS 加密连接");
        try {
            int port = Integer.parseInt(setting("port", security.equals("ssl") ? "465" : "587"));
            Socket socket = new Socket();
            socket.connect(new InetSocketAddress(host, port), 5000);socket.setSoTimeout(8000);
            try (Connection smtp = new Connection(socket)) {
                if (security.equals("ssl")) smtp.upgrade(host, port);
                smtp.expect(220);smtp.command("EHLO paper-desk", 250);
                if (security.equals("starttls")) { smtp.command("STARTTLS", 220);smtp.upgrade(host, port);smtp.command("EHLO paper-desk", 250); }
                String user = setting("username", ""), password = setting("password", "");
                if (!user.isEmpty()) {
                    smtp.command("AUTH LOGIN", 334);
                    smtp.command(Base64.getEncoder().encodeToString(user.getBytes(StandardCharsets.UTF_8)), 334);
                    smtp.command(Base64.getEncoder().encodeToString(password.getBytes(StandardCharsets.UTF_8)), 235);
                }
                smtp.command("MAIL FROM:<" + from + ">", 250);smtp.command("RCPT TO:<" + to + ">", 250, 251);smtp.command("DATA", 354);
                String purpose=registration?"注册账号":"重置密码";
                String subject = Base64.getEncoder().encodeToString(("知序 · "+purpose+"验证码").getBytes(StandardCharsets.UTF_8));
                String body = "您的"+purpose+"验证码为：" + code + "\n\n验证码 10 分钟内有效，仅可使用一次。请勿将验证码提供给他人。\n如非本人操作，请忽略本邮件。";
                smtp.write("From: " + from + "\r\nTo: " + to + "\r\nSubject: =?UTF-8?B?" + subject + "?=\r\nDate: " + DateTimeFormatter.RFC_1123_DATE_TIME.format(ZonedDateTime.now()) +
                    "\r\nMessage-ID: <" + UUID.randomUUID() + "@paper-desk.local>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
                    Base64.getMimeEncoder(76, new byte[]{13,10}).encodeToString(body.getBytes(StandardCharsets.UTF_8)) + "\r\n.\r\n");
                smtp.expect(250);
                try { smtp.command("QUIT", 221); } catch (IOException ignored) { }
            }
        } catch (Exception error) { throw new ApiException(503, "验证码邮件发送失败，请稍后重试或联系管理员检查邮件配置"); }
    }
    private static final class Connection implements AutoCloseable {
        private Socket socket;private BufferedReader input;private BufferedWriter output;
        Connection(Socket socket) throws IOException { this.socket=socket;streams(); }
        private void streams() throws IOException { input=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.US_ASCII));output=new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(),StandardCharsets.US_ASCII)); }
        void upgrade(String host,int port) throws IOException {
            SSLSocket tls=(SSLSocket)((SSLSocketFactory)SSLSocketFactory.getDefault()).createSocket(socket,host,port,true);
            socket=tls;SSLParameters parameters=tls.getSSLParameters();parameters.setEndpointIdentificationAlgorithm("HTTPS");tls.setSSLParameters(parameters);tls.setSoTimeout(8000);tls.startHandshake();streams();
        }
        void write(String value) throws IOException { output.write(value);output.flush(); }
        void command(String value,int... expected) throws IOException { write(value+"\r\n");expect(expected); }
        void expect(int... expected) throws IOException {
            String line;int code=-1;
            for(int count=0;count<100;count++) {
                line=input.readLine();if(line==null||line.length()<3||line.length()>4096)throw new IOException("Invalid SMTP response");
                try { code=Integer.parseInt(line.substring(0,3)); } catch(NumberFormatException error){throw new IOException("Invalid SMTP response");}
                if(line.length()==3||line.charAt(3)!='-') { for(int candidate:expected)if(code==candidate)return;throw new IOException("SMTP delivery rejected"); }
            }
            throw new IOException("SMTP response too long");
        }
        public void close() throws IOException { socket.close(); }
    }
}
