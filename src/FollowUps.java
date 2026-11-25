import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

/** Independent follow-up tasks; legacy paper fields remain a projection of the next task. */
final class FollowUps {
    static final Set<String> STATUSES=Set.of("pending","in_progress","completed","cancelled");
    private static String now(){return Instant.now().truncatedTo(ChronoUnit.MICROS).toString();}
    private static String timestamp(Object value){return Instant.parse(value.toString()).truncatedTo(ChronoUnit.MICROS).toString();}
    static boolean active(Map<String,Object> task){return Set.of("pending","in_progress").contains(Main.string(task,"status"));}
    static List<Object> tasks(Map<String,Object> paper){
        if(paper.containsKey("followUps"))return Json.array(paper.get("followUps"));
        List<Object> tasks=new ArrayList<>();
        if(!Main.string(paper,"followUpAt").isEmpty()){
            String id=UUID.nameUUIDFromBytes((Main.string(paper,"id")+":follow-up").getBytes(StandardCharsets.UTF_8)).toString();
            Map<String,Object> task=new LinkedHashMap<>();
            task.put("id",id);task.put("content",Main.string(paper,"followUpReason"));task.put("date",Main.string(paper,"followUpAt"));
            task.put("status","pending");task.put("note","");task.put("closedAt","");
            task.put("createdAt",timestamp(paper.get("createdAt")));task.put("updatedAt",timestamp(paper.get("updatedAt")));tasks.add(task);
        }
        return tasks;
    }
    static void initialize(Map<String,Object> paper){
        if(!paper.containsKey("followUps"))paper.put("followUps",tasks(paper));
        if(!paper.containsKey("followUpHistory")){
            paper.put("followUpHistory",new ArrayList<>());
            for(Object item:tasks(paper))record(paper,Json.object(item));
        }
    }
    static void project(Map<String,Object> paper){
        Map<String,Object> next=tasks(paper).stream().map(Json::object).filter(FollowUps::active)
            .min(Comparator.comparing(t->Main.string(t,"date"))).orElse(null);
        paper.put("followUpAt",next==null?"":next.get("date"));
        paper.put("followUpReason",next==null?"":next.get("content"));
    }
    // Existing paper editors still edit the next pending task, without discarding completed tasks.
    static void legacyUpdate(Map<String,Object> paper,String oldDate,String oldReason){
        if(oldDate.equals(Main.string(paper,"followUpAt"))&&oldReason.equals(Main.string(paper,"followUpReason")))return;
        String date=Main.string(paper,"followUpAt"),content=Main.string(paper,"followUpReason");
        Map<String,Object> next=tasks(paper).stream().map(Json::object).filter(FollowUps::active)
            .min(Comparator.comparing(t->Main.string(t,"date"))).orElse(null);
        if(next==null&&!date.isEmpty()){
            if(tasks(paper).size()>=1000)throw new ApiException(400,"每篇论文最多记录 1000 条跟进事项");
            next=new LinkedHashMap<>();next.put("id",UUID.randomUUID().toString());next.put("createdAt",now());next.put("note","");
            Json.array(paper.get("followUps")).add(next);
        }
        if(next!=null){
            if(!date.isEmpty()){next.put("date",date);next.put("content",content);}
            next.put("status",date.isEmpty()?"cancelled":active(next)?next.get("status"):"pending");next.put("closedAt",date.isEmpty()?now():"");next.put("updatedAt",now());record(paper,next);
        }
        project(paper);
    }
    static void save(Map<String,Object> paper,String taskId,Map<String,Object> input){
        initialize(paper);
        Map<String,Object> task=null;
        if(taskId!=null){
            for(Object item:tasks(paper))if(Main.string(Json.object(item),"id").equals(taskId))task=Json.object(item);
            if(task==null)throw new ApiException(404,"跟进事项不存在");
        }else if(tasks(paper).size()>=1000)throw new ApiException(400,"每篇论文最多记录 1000 条跟进事项");
        Map<String,Object> next=new LinkedHashMap<>();if(task!=null)next.putAll(task);next.putAll(input);
        String content=PaperService.text(next,"content",1000),date=PaperService.date(next,"date"),note=PaperService.text(next,"note",5000);
        String status=next.containsKey("status")?PaperService.text(next,"status",20):"pending";
        if(content.isEmpty())throw new ApiException(400,"请填写跟进事项内容");
        if(date.isEmpty())throw new ApiException(400,"请选择跟进日期");
        if(!STATUSES.contains(status))throw new ApiException(400,"请选择有效的事项状态");
        String now=now();
        if(task==null){task=new LinkedHashMap<>();task.put("id",UUID.randomUUID().toString());task.put("createdAt",now);Json.array(paper.get("followUps")).add(task);}
        boolean wasClosed=!Main.string(task,"closedAt").isEmpty()&&status.equals(Main.string(task,"status"));
        task.put("content",content);task.put("date",date);task.put("note",note);task.put("status",status);task.put("updatedAt",now);
        task.put("closedAt",active(task)?"":wasClosed?task.get("closedAt"):now);
        record(paper,task);project(paper);
    }
    static void record(Map<String,Object> paper,Map<String,Object> task){
        Map<String,Object> event=new LinkedHashMap<>(task);event.put("taskId",task.get("id"));event.put("id",UUID.randomUUID().toString());event.put("at",now());
        Json.array(paper.get("followUpHistory")).add(event);
    }
    static void validateStored(Map<String,Object> paper){
        if(!paper.containsKey("followUps"))return;
        List<Object> tasks=Json.array(paper.get("followUps"));if(tasks.size()>1000)throw new IllegalArgumentException();
        Set<String> ids=new HashSet<>();
        for(Object item:tasks){Map<String,Object> task=Json.object(item);validateTask(task);if(!ids.add(Main.string(task,"id")))throw new IllegalArgumentException();}
        Set<String> events=new HashSet<>();
        for(Object item:Json.array(paper.getOrDefault("followUpHistory",List.of()))){
            Map<String,Object> event=Json.object(item);validateTask(event);Instant.parse(Main.string(event,"at"));
            if(!ids.contains(Main.string(event,"taskId"))||!events.add(Main.string(event,"id")))throw new IllegalArgumentException();
        }
    }
    private static void validateTask(Map<String,Object> task){
        UUID.fromString(Main.string(task,"id"));
        if(!STATUSES.contains(Main.string(task,"status"))||PaperService.date(task,"date").isEmpty())throw new IllegalArgumentException();
        PaperService.text(task,"content",1000);PaperService.text(task,"note",5000);
        Instant.parse(Main.string(task,"createdAt"));Instant.parse(Main.string(task,"updatedAt"));
        String closed=Main.string(task,"closedAt");if(!closed.isEmpty())Instant.parse(closed);
        if(active(task)!=closed.isEmpty())throw new IllegalArgumentException();
    }
}
