import java.util.Map;
import java.util.function.Function;

/** Business persistence boundary. A future database implementation must preserve atomic mutations. */
public interface BusinessStore {
    Map<String, Object> read();
    <T> T mutate(Function<Map<String, Object>, T> action) throws Exception;
}
