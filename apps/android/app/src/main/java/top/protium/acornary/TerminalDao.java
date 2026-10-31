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
    @Insert void insertPrintBatch(PrintBatchRecord batch);
    @Insert void insertPrintPages(List<PrintPageRecord> pages);
    @Query("SELECT * FROM print_batches WHERE scope=:scope ORDER BY createdAt DESC,id DESC") List<PrintBatchRecord> printBatches(String scope);
    @Query("SELECT * FROM print_pages WHERE batchId=:batchId ORDER BY position") List<PrintPageRecord> printPages(String batchId);
    @Query("SELECT DISTINCT fingerprint FROM print_pages WHERE scope=:scope AND status IN ('DONE','CONFIRMED')") List<String> printedFingerprints(String scope);
    @Query("SELECT COUNT(*) FROM print_pages WHERE scope=:scope AND fingerprint=:fingerprint AND status IN ('DONE','CONFIRMED')") int printed(String scope,String fingerprint);
    @Query("UPDATE print_pages SET status=:status,updatedAt=:time WHERE batchId=:id AND position=:position") int printPageStatus(String id,int position,String status,long time);
    @Query("UPDATE print_batches SET status=:status WHERE id=:id") int printBatchStatus(String id,String status);
    @Query("UPDATE print_pages SET status='UNCERTAIN' WHERE scope=:scope AND status='SENDING'") void recoverPrintPages(String scope);
    @Query("UPDATE print_batches SET status='STOPPED' WHERE scope=:scope AND status='RUNNING'") void recoverPrintBatches(String scope);
    @Query("DELETE FROM print_pages") void clearPrintPages();
    @Query("DELETE FROM print_batches") void clearPrintBatches();
    @Transaction default void createPrintBatch(PrintBatchRecord batch,List<PrintPageRecord> pages) { insertPrintBatch(batch); insertPrintPages(pages); }
    @Transaction default void recoverPrinting(String scope) { recoverPrintPages(scope); recoverPrintBatches(scope); }
    @Transaction default void clear() { clearCache(); clearPending(); clearPrintPages(); clearPrintBatches(); }
    @Transaction default void snapshot(CacheEntry session, CacheEntry snapshot, boolean clear) {
        if (clear) clear();
        put(session); put(snapshot);
    }
}
