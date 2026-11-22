import java.math.BigDecimal;
import java.util.*;

/** Small strict JSON codec for the dependency-free local service. */
public final class Json {
    private final String source;
    private int position;
    private Json(String source) { this.source = source; }
    public static Object parse(String source) {
        Json parser = new Json(source);
        Object result = parser.value(0); parser.space();
        if (parser.position != source.length()) throw new IllegalArgumentException("Trailing JSON content");
        return result;
    }
    @SuppressWarnings("unchecked")
    public static Map<String, Object> object(Object value) {
        if (!(value instanceof Map<?, ?>)) throw new IllegalArgumentException("Expected object");
        return (Map<String, Object>) value;
    }
    @SuppressWarnings("unchecked")
    public static List<Object> array(Object value) {
        if (!(value instanceof List<?>)) throw new IllegalArgumentException("Expected array");
        return (List<Object>) value;
    }
    public static String write(Object value) { StringBuilder out = new StringBuilder(); writeValue(value, out); return out.toString(); }
    private static void writeValue(Object value, StringBuilder out) {
        if (value == null) out.append("null");
        else if (value instanceof String s) quote(s, out);
        else if (value instanceof Boolean || value instanceof Number) out.append(value);
        else if (value instanceof Map<?, ?> map) {
            out.append('{'); boolean first = true;
            for (var entry : map.entrySet()) {
                if (!first) out.append(','); first = false;
                quote(entry.getKey().toString(), out); out.append(':'); writeValue(entry.getValue(), out);
            }
            out.append('}');
        } else if (value instanceof Iterable<?> list) {
            out.append('['); boolean first = true;
            for (Object item : list) { if (!first) out.append(','); first = false; writeValue(item, out); }
            out.append(']');
        } else throw new IllegalArgumentException("Unsupported JSON value");
    }
    private static void quote(String s, StringBuilder out) {
        out.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\""); case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n"); case '\r' -> out.append("\\r"); case '\t' -> out.append("\\t");
                default -> { if (c < 32) out.append(String.format("\\u%04x", (int)c)); else out.append(c); }
            }
        }
        out.append('"');
    }
    private Object value(int depth) {
        if (depth > 64) throw new IllegalArgumentException("JSON nesting too deep");
        space();
        if (position >= source.length()) throw new IllegalArgumentException("Missing JSON value");
        char c = source.charAt(position);
        if (c == '"') return string();
        if (c == '{') {
            position++; space(); Map<String, Object> map = new LinkedHashMap<>();
            if (take('}')) return map;
            do {
                space(); if (position >= source.length() || source.charAt(position) != '"') throw new IllegalArgumentException("Invalid object key");
                String key = string(); space(); expect(':');
                if (map.containsKey(key)) throw new IllegalArgumentException("Duplicate key");
                map.put(key, value(depth + 1)); space();
                if (take('}')) return map; expect(',');
            } while (true);
        }
        if (c == '[') {
            position++; space(); List<Object> list = new ArrayList<>();
            if (take(']')) return list;
            do { list.add(value(depth + 1)); space(); if (take(']')) return list; expect(','); } while (true);
        }
        for (String literal : List.of("true", "false", "null")) if (source.startsWith(literal, position)) {
            position += literal.length(); return literal.equals("null") ? null : literal.equals("true");
        }
        int start = position;
        if (take('-') && position == source.length()) throw new IllegalArgumentException("Invalid number");
        if (!take('0')) {
            if (position >= source.length() || source.charAt(position) < '1' || source.charAt(position) > '9') throw new IllegalArgumentException("Invalid number");
            while (position < source.length() && Character.isDigit(source.charAt(position))) position++;
        }
        if (take('.')) digits();
        if (take('e') || take('E')) { if (!take('+')) take('-'); digits(); }
        try { return new BigDecimal(source.substring(start, position)); }
        catch (NumberFormatException e) { throw new IllegalArgumentException("Invalid number"); }
    }
    private String string() {
        expect('"'); StringBuilder out = new StringBuilder();
        while (position < source.length()) {
            char c = source.charAt(position++);
            if (c == '"') return out.toString();
            if (c < 32) throw new IllegalArgumentException("Invalid string character");
            if (c == '\\') {
                if (position >= source.length()) throw new IllegalArgumentException("Invalid escape");
                char escaped = source.charAt(position++);
                switch (escaped) {
                    case '"', '\\', '/' -> out.append(escaped);
                    case 'b' -> out.append('\b'); case 'f' -> out.append('\f');
                    case 'n' -> out.append('\n'); case 'r' -> out.append('\r'); case 't' -> out.append('\t');
                    case 'u' -> {
                        if (position + 4 > source.length()) throw new IllegalArgumentException("Invalid unicode escape");
                        try { out.append((char)Integer.parseInt(source.substring(position, position + 4), 16)); }
                        catch (NumberFormatException e) { throw new IllegalArgumentException("Invalid unicode escape"); }
                        position += 4;
                    }
                    default -> throw new IllegalArgumentException("Invalid escape");
                }
            } else out.append(c);
        }
        throw new IllegalArgumentException("Unterminated string");
    }
    private void digits() {
        int start = position;
        while (position < source.length() && Character.isDigit(source.charAt(position))) position++;
        if (start == position) throw new IllegalArgumentException("Missing digits");
    }
    private void space() { while (position < source.length() && " \t\r\n".indexOf(source.charAt(position)) >= 0) position++; }
    private boolean take(char c) { if (position < source.length() && source.charAt(position) == c) { position++; return true; } return false; }
    private void expect(char c) { if (!take(c)) throw new IllegalArgumentException("Expected " + c); }
}
