package top.protium.acornary;
import androidx.room.Database;
import androidx.room.RoomDatabase;
@Database(entities = {CacheEntry.class, PendingOperation.class}, version = 1, exportSchema = false)
public abstract class TerminalDatabase extends RoomDatabase { public abstract TerminalDao dao(); }
