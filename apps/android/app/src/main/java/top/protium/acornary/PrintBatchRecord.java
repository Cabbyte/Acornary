package top.protium.acornary;
import androidx.annotation.NonNull;
import androidx.room.*;
@Entity(tableName="print_batches", indices={@Index("scope")})
public class PrintBatchRecord {
 @PrimaryKey @NonNull public String id;
 @NonNull public String scope;
 @NonNull public String size;
 public int density;
 @NonNull public String status;
 public long createdAt;
 public PrintBatchRecord(@NonNull String id,@NonNull String scope,@NonNull String size,int density,@NonNull String status,long createdAt) {
  this.id=id;this.scope=scope;this.size=size;this.density=density;this.status=status;this.createdAt=createdAt;
 }
}
