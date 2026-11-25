import java.time.LocalDate;
import java.util.*;

/** Human-readable identifiers; UUIDs remain the stable relationship keys. */
final class PaperCodes {
    private static boolean valid(String code) { return code.matches("LW-[0-9]{4}-(QB|DF)[0-9]{8}[0-9]{2,}"); }
    static boolean needed(Map<String,Object> state) {
        Set<String> used=new HashSet<>();
        for(Object item:Json.array(state.get("papers"))) {
            String code=Main.string(Json.object(item),"code");
            if(!valid(code)||!used.add(code))return true;
        }
        return false;
    }
    static String prefix(Map<String,Object> paper) {
        String created=Main.string(paper,"createdAt");
        String year=created.length()>=4?created.substring(0,4):String.valueOf(LocalDate.now().getYear());
        String date=Main.string(paper,"submittedAt");
        List<Map<String,Object>> submissions=new ArrayList<>();
        for(Object item:Json.array(paper.getOrDefault("submissions",List.of())))submissions.add(Json.object(item));
        submissions.sort(Comparator.comparing(s->Main.string(s,"createdAt")));
        for(Map<String,Object> submission:submissions)if(!Main.string(submission,"submittedAt").isEmpty()){date=Main.string(submission,"submittedAt");break;}
        if(date.isEmpty())date=created.length()>=10?created.substring(0,10):LocalDate.now().toString();
        return "LW-"+year+"-"+(BusinessService.hasWriting(paper)?"QB":"DF")+date.replace("-","");
    }
    static String next(Map<String,Object> state,Map<String,Object> paper) {
        String prefix=prefix(paper);int maximum=0;
        for(Object item:Json.array(state.get("papers"))) {
            String code=Main.string(Json.object(item),"code");
            if(code.startsWith(prefix)&&valid(code)) {
                try { maximum=Math.max(maximum,Integer.parseInt(code.substring(prefix.length()))); }
                catch(NumberFormatException ignored) { throw new ApiException(400,"论文编号序号超出范围"); }
            }
        }
        return prefix+String.format(Locale.ROOT,"%02d",maximum+1);
    }
    static boolean migrate(Map<String,Object> state) {
        if(!needed(state))return false;
        List<Map<String,Object>> papers=new ArrayList<>();
        for(Object item:Json.array(state.get("papers")))papers.add(Json.object(item));
        papers.sort(Comparator.comparing((Map<String,Object> p)->Main.string(p,"createdAt")).thenComparing(p->Main.string(p,"id")));
        Set<String> used=new HashSet<>();
        for(Map<String,Object> paper:papers) {
            String code=Main.string(paper,"code");
            if(!valid(code)||!used.add(code)) { paper.put("code",next(state,paper));used.add(Main.string(paper,"code")); }
        }
        return true;
    }
}
