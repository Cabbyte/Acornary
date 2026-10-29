package top.protium.acornary;
import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;
@Entity(tableName = "pending_operations")
public class PendingOperation {
    @PrimaryKey @NonNull public String key = "";
    @NonNull public String scope = "";
    @NonNull public String itemId = "";
    @NonNull public String command = "";
    @NonNull public String json = "";
    public long createdAt;
    public PendingOperation(@NonNull String key, @NonNull String scope, @NonNull String itemId, @NonNull String command, @NonNull String json, long createdAt) {
        this.key = key; this.scope = scope; this.itemId = itemId; this.command = command; this.json = json; this.createdAt = createdAt;
    }
}
