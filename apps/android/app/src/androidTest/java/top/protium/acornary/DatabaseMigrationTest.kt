package top.protium.acornary

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test

class DatabaseMigrationTest {
 @Test fun versionOneUpgradeRetainsCacheAndUncertainInventoryOperation() {
  val context=InstrumentationRegistry.getInstrumentation().targetContext
  val name="migration-print-v2.db";context.deleteDatabase(name)
  val file=context.getDatabasePath(name);file.parentFile!!.mkdirs()
  SQLiteDatabase.openOrCreateDatabase(file,null).use {old->
   old.execSQL("CREATE TABLE cache (`key` TEXT NOT NULL,json TEXT NOT NULL,updatedAt INTEGER NOT NULL,PRIMARY KEY(`key`))")
   old.execSQL("CREATE TABLE pending_operations (`key` TEXT NOT NULL,scope TEXT NOT NULL,itemId TEXT NOT NULL,command TEXT NOT NULL,json TEXT NOT NULL,createdAt INTEGER NOT NULL,PRIMARY KEY(`key`))")
   old.execSQL("INSERT INTO cache VALUES ('session','cached-family',1)")
   old.execSQL("INSERT INTO pending_operations VALUES ('request','A','item','consume_item_content','exact original payload',1)")
   old.version=1
  }
  fun open()=Room.databaseBuilder(context,TerminalDatabase::class.java,name).addMigrations(TerminalDatabase.MIGRATION_1_2).build()
  var db=open()
  try {
   assertEquals("cached-family",db.dao().get("session").json)
   assertEquals("exact original payload",db.dao().pending("A").single().json)
   db.dao().createPrintBatch(PrintBatchRecord("b","A","30x12",2,"RUNNING",1),listOf(PrintPageRecord("b",0,"A","item","hash","{}","SENDING",1)))
   db.close();db=open();db.dao().recoverPrinting("A")
   assertEquals("UNCERTAIN",db.dao().printPages("b").single().status)
   assertEquals("STOPPED",db.dao().printBatches("A").single().status)
   assertTrue(db.dao().printBatches("B").isEmpty())
   db.dao().clear();assertTrue(db.dao().printPages("b").isEmpty())
  } finally {db.close();context.deleteDatabase(name)}
 }
}
