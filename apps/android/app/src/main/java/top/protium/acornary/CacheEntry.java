package top.protium.acornary;
import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;
@Entity(tableName = "cache")
public class CacheEntry {
    @PrimaryKey @NonNull public String key = "";
    @NonNull public String json = "";
    public long updatedAt;
    public CacheEntry(@NonNull String key, @NonNull String json, long updatedAt) { this.key = key; this.json = json; this.updatedAt = updatedAt; }
}
