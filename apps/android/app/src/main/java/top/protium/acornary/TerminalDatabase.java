package top.protium.acornary;
import androidx.room.Database;
import androidx.room.RoomDatabase;
import androidx.room.migration.Migration;
import androidx.sqlite.db.SupportSQLiteDatabase;
@Database(entities = {CacheEntry.class, PendingOperation.class, PrintBatchRecord.class, PrintPageRecord.class}, version = 2, exportSchema = false)
public abstract class TerminalDatabase extends RoomDatabase {
 public abstract TerminalDao dao();
 public static final Migration MIGRATION_1_2 = new Migration(1,2) {
  @Override public void migrate(SupportSQLiteDatabase db) {
   db.execSQL("CREATE TABLE IF NOT EXISTS print_batches (id TEXT NOT NULL,scope TEXT NOT NULL,size TEXT NOT NULL,density INTEGER NOT NULL,status TEXT NOT NULL,createdAt INTEGER NOT NULL,PRIMARY KEY(id))");
   db.execSQL("CREATE INDEX IF NOT EXISTS index_print_batches_scope ON print_batches(scope)");
   db.execSQL("CREATE TABLE IF NOT EXISTS print_pages (batchId TEXT NOT NULL,position INTEGER NOT NULL,scope TEXT NOT NULL,itemId TEXT NOT NULL,fingerprint TEXT NOT NULL,json TEXT NOT NULL,status TEXT NOT NULL,updatedAt INTEGER NOT NULL,PRIMARY KEY(batchId,position))");
   db.execSQL("CREATE INDEX IF NOT EXISTS index_print_pages_scope_fingerprint_status ON print_pages(scope,fingerprint,status)");
  }
 };
}
