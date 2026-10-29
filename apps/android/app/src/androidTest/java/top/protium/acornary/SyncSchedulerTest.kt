package top.protium.acornary

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class SyncSchedulerTest {
    @Test fun deniedForegroundServiceUsesPersistedFallbackAndItsStalenessWindow() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val diagnostics = context.getSharedPreferences("sync-diagnostics", Context.MODE_PRIVATE)
        val previous = diagnostics.all.toMap()
        try {
            SyncScheduler.foregroundDenied(context)
            assertTrue(context.getSharedPreferences("sync-diagnostics", Context.MODE_PRIVATE).getBoolean("foregroundDenied", false))
            assertFalse(SyncScheduler.fast(context))
            assertTrue(SyncScheduler.description(context).contains("后台同步受限"))
            assertFalse(SyncScheduler.isStale(context, Instant.now().minusSeconds(20 * 60).toString()))
            assertTrue(SyncScheduler.isStale(context, Instant.now().minusSeconds(31 * 60).toString()))
            SyncScheduler.retryFromForeground(context)
            assertFalse(diagnostics.getBoolean("foregroundDenied", false))
        } finally {
            diagnostics.edit().clear().also { editor ->
                previous.forEach { (key, value) -> if (value is Boolean) editor.putBoolean(key, value) }
            }.commit()
            SyncScheduler.schedule(context)
        }
    }
}
