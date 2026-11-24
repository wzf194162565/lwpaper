import java.text.Normalizer;
import java.util.*;

/** Author associations are derived from paper bylines, without separate author records. */
final class AuthorRelations {
    static List<String> names(String byline) {
        Map<String, String> names = new LinkedHashMap<>();
        for (String part : byline.split("[、,，;；\\r\\n]+")) {
            String name = Normalizer.normalize(part, Normalizer.Form.NFKC).replaceAll("[\\p{Z}\\s]+", " ").trim();
            if (!name.isEmpty()) names.putIfAbsent(name.toLowerCase(Locale.ROOT), name);
        }
        return new ArrayList<>(names.values());
    }

    static Map<String, Object> summary(List<Object> papers) {
        Map<String, Map<String, Object>> authors = new LinkedHashMap<>();
        int missing = 0;
        for (Object item : papers) {
            Map<String, Object> paper = Json.object(item);
            List<String> names = names(Main.string(paper, "authors"));
            if (names.isEmpty()) missing++;
            for (String name : names) {
                Map<String, Object> author = authors.computeIfAbsent(name.toLowerCase(Locale.ROOT), key -> {
                    Map<String, Object> value = new LinkedHashMap<>(); value.put("name", name); value.put("paperCount", 0); return value;
                });
                author.put("paperCount", PaperService.number(author.get("paperCount")) + 1);
            }
        }
        List<Object> linked = new ArrayList<>(authors.values());
        linked.sort(Comparator.comparing(item -> Main.string(Json.object(item), "name")));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("authorCount", linked.size()); result.put("linkedAuthors", linked); result.put("unassignedAuthorPaperCount", missing);
        return result;
    }
}
