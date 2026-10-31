package top.protium.acornary;
import androidx.annotation.NonNull;
import androidx.room.*;
@Entity(tableName="print_pages", primaryKeys={"batchId","position"}, indices={@Index(value={"scope","fingerprint","status"})})
public class PrintPageRecord {
 @NonNull public String batchId;
 public int position;
 @NonNull public String scope;
 @NonNull public String itemId;
 @NonNull public String fingerprint;
 @NonNull public String json;
 @NonNull public String status;
 public long updatedAt;
 public PrintPageRecord(@NonNull String batchId,int position,@NonNull String scope,@NonNull String itemId,@NonNull String fingerprint,@NonNull String json,@NonNull String status,long updatedAt) {
  this.batchId=batchId;this.position=position;this.scope=scope;this.itemId=itemId;this.fingerprint=fingerprint;this.json=json;this.status=status;this.updatedAt=updatedAt;
 }
}
