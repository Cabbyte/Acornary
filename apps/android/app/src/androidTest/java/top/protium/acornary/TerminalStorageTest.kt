package top.protium.acornary

import androidx.test.platform.app.InstrumentationRegistry
import androidx.room.Room
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class TerminalStorageTest {
    @Test fun cacheAndUncertainOperationSurviveDatabaseReopen() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "terminal-storage-test.db"
        context.deleteDatabase(name)
        fun open() = Room.databaseBuilder(context, TerminalDatabase::class.java, name).build()
        var db = open()
        try {
            db.dao().snapshot(CacheEntry("session", "household-A", 1), CacheEntry("A:snapshot", "valid", 1), true)
            db.dao().insert(PendingOperation("key", "A", "item", "consume_item_content", "{\"amount\":\"0.1\"}", 1))
            db.close(); db = open()
            assertEquals("valid", db.dao().get("A:snapshot").json)
            assertTrue(db.dao().pending("B").isEmpty())
            assertEquals("{\"amount\":\"0.1\"}", db.dao().pending("A").single().json)
            db.dao().snapshot(CacheEntry("session", "household-B", 2), CacheEntry("B:snapshot", "new", 2), true)
            assertNull(db.dao().get("A:snapshot")); assertTrue(db.dao().pending("A").isEmpty())
        } finally { db.close(); context.deleteDatabase(name) }
    }
    @Test fun vaultEncryptsRotatingCredentialsAndRecoversCorruption() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val vault = TokenVault(context, "test-terminal-auth.bin", "acornary.auth.test")
        val config = AuthConfig(1,"test",API,CALLBACK,"$ORIGIN/api/auth/oauth2/authorize","$ORIGIN/api/auth/oauth2/token","$ORIGIN/api/auth/oauth2/revoke",emptyList())
        try {
            vault.write(AuthRecord(config, state = "sensitive-test-token", refreshInFlight = true))
            assertTrue(vault.read()!!.refreshInFlight)
            val file = File(context.noBackupFilesDir, "test-terminal-auth.bin")
            assertFalse(file.readBytes().decodeToString().contains("sensitive-test-token"))
            file.writeText("corrupt")
            assertNull(vault.read())
        } finally { vault.clear() }
    }
}
