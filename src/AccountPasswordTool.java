import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.io.PrintStream;
import java.sql.*;
import java.util.*;

/** Local database administrator tool; deliberately not exposed through the web application. */
public final class AccountPasswordTool {
    public static void main(String[] args) {
        System.setOut(new PrintStream(System.out,true,StandardCharsets.UTF_8));
        System.setErr(new PrintStream(System.err,true,StandardCharsets.UTF_8));
        if(args.length==1&&Set.of("--help","-h").contains(args[0])) { usage();return; }
        if(!(args.length==1&&args[0].equals("list"))&&!(args.length==2&&args[0].equals("show")&&!args[1].isBlank())) {
            usage();System.exit(2);return;
        }
        try {
            Path root=Path.of(System.getProperty("app.root",".")).toAbsolutePath().normalize();
            Path data=Path.of(System.getProperty("app.data",root.resolve("data").toString())).toAbsolutePath().normalize();
            DatabaseConfig config=new DatabaseConfig(root,data);
            if(!config.storage.equals("mysql"))throw new IllegalStateException("此工具仅支持 MySQL 存储模式。");
            Class.forName("com.mysql.cj.jdbc.Driver");
            try(Connection connection=config.connect(true)) {
                connection.setReadOnly(true);
                if(args[0].equals("list"))list(connection);
                else show(connection,config,args[1].trim());
            }
        } catch(Exception error) {
            // Driver/decryption exceptions must not leak connection details or secrets.
            System.err.println(error instanceof IllegalStateException?error.getMessage():"读取失败，请检查数据库连接、V015 迁移和匹配的 database.key。未显示密码。");
            System.exit(1);
        }
    }
    private static void usage() {
        System.out.println("用法：AccountPasswordTool list | show <登录账号>");
        System.out.println("list 仅列出账号及密码副本状态；show 解密指定账号的密码并显示在当前终端。");
    }
    private static void list(Connection connection)throws Exception {
        List<Object> accounts=new ArrayList<>();
        try(Statement statement=connection.createStatement();ResultSet rows=statement.executeQuery("SELECT username,status,password_ciphertext<>'' AS available FROM lw_user ORDER BY username")) {
            while(rows.next())accounts.add(Map.of("username",rows.getString("username"),"status",rows.getString("status"),"passwordAvailable",rows.getBoolean("available")));
        }
        System.out.println(Json.write(accounts));
    }
    private static void show(Connection connection,DatabaseConfig config,String username)throws Exception {
        try(PreparedStatement statement=connection.prepareStatement("SELECT id,username,password_hash,password_ciphertext FROM lw_user WHERE username=?")) {
            statement.setString(1,username);
            try(ResultSet row=statement.executeQuery()) {
                if(!row.next())throw new IllegalStateException("账号不存在。");
                String encrypted=row.getString("password_ciphertext");
                if(encrypted.isEmpty())throw new IllegalStateException("该账号尚无密码副本。请先用原密码成功登录一次，或完成密码重置后再查询；旧密码哈希无法还原。");
                DatabaseCrypto crypto=new DatabaseCrypto(config.keyFile(),false);
                String password=crypto.decryptLoginPassword(row.getString("id"),encrypted);
                if(!DatabaseCrypto.verifyPassword(password,row.getString("password_hash")))throw new IllegalStateException("密码副本与当前密码不匹配，未显示密码。请通过系统修改或重置密码。");
                System.out.println(Json.write(Map.of("username",row.getString("username"),"password",password)));
            }
        }
    }
}
