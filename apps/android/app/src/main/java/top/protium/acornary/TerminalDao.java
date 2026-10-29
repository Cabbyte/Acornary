package top.protium.acornary;
import androidx.room.*;
import java.util.List;
@Dao public interface TerminalDao {
    @Query("SELECT * FROM cache WHERE `key`=:key") CacheEntry get(String key);
    @Insert(onConflict = OnConflictStrategy.REPLACE) void put(CacheEntry entry);
    @Query("DELETE FROM cache") void clearCache();
    @Insert(onConflict = OnConflictStrategy.ABORT) void insert(PendingOperation operation);
    @Query("SELECT * FROM pending_operations WHERE scope=:scope ORDER BY createdAt") List<PendingOperation> pending(String scope);
    @Query("DELETE FROM pending_operations WHERE `key`=:key") void resolve(String key);
    @Query("DELETE FROM pending_operations") void clearPending();
    @Transaction default void clear() { clearCache(); clearPending(); }
    @Transaction default void snapshot(CacheEntry session, CacheEntry snapshot, boolean clear) {
        if (clear) clear();
        put(session); put(snapshot);
    }
}
