package top.protium.acornary

import android.content.Context
import android.graphics.Bitmap
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

/** CI-only fake transport: exercises the actual owner/reconnect/print serialization, with no radio. */
class PrinterConnectionTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private class Link(val lost: (String) -> Unit) : D101Link {
        var closed = false
        var active = 0
        var maxActive = 0
        var heartbeatTimeout = false
        val commands = mutableListOf<Int>()
        override suspend fun connect(address: String) { check(!closed) }
        override suspend fun exchange(command: Int, data: ByteArray, response: Int?): NiimbotPacket? {
            check(!closed); active++; maxActive = maxOf(active, maxActive)
            try {
                delay(2); commands.add(command)
                if (command == 0xdc && heartbeatTimeout) withTimeout(1) { delay(100) }
                val bytes = when(command) {
                    0xc1 -> byteArrayOf(1)
                    0x40 -> byteArrayOf(10, 0)
                    0xdc -> ByteArray(13).also { it[9] = 1; it[10] = 4 }
                    0xa3 -> byteArrayOf(0, 1, 100, 100)
                    else -> byteArrayOf(1)
                }
                return response?.let { NiimbotPacket(it, bytes) }
            } finally { active-- }
        }
        override fun close() { closed = true }
    }
    private suspend fun until(condition: () -> Boolean) = withTimeout(5_000) { while (!condition()) delay(10) }
    private fun fixture(uncertain: Boolean = false, block: suspend (PrinterController, PrinterMemory, MutableList<Link>) -> Unit) = runBlocking {
        withContext(Dispatchers.Main) {
            val store = "printer-fixture-${UUID.randomUUID()}"
            val memory = PrinterMemory(context, store)
            memory.remember(PrinterDevice("02:00:00:00:00:01", "D101 fixture"))
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
            val links = mutableListOf<Link>()
            PrintRecovery(context).clear()
            if (uncertain) PrintRecovery(context).mark()
            val owner = PrinterController(context, scope, memory, { true }, { _, lost -> Link(lost).also { links.add(it) } }, 20, { 20 })
            try { block(owner, memory, links) }
            finally {
                owner.stopMaintenance(); scope.cancel()
                context.getSharedPreferences(store, Context.MODE_PRIVATE).edit().clear().commit()
                PrintRecovery(context).clear()
            }
        }
    }
    @Test fun backgroundKeepsLinkAndTimeoutReconnectsWithoutPrinting() = fixture { owner, memory, links ->
        PrintRecovery(context).clear()
        owner.startMaintenance()
        until { owner.state.value.connected }
        owner.background(); delay(50)
        assertTrue(owner.state.value.connected); assertFalse(links[0].closed)
        links[0].heartbeatTimeout = true
        until { links.size >= 2 && owner.state.value.connected }
        assertTrue(links[0].closed)
        assertTrue(links.all { 0x01 !in it.commands })
        owner.disconnect(); delay(80)
        assertFalse(memory.keep()); assertFalse(owner.wantsMaintenance())
        assertFalse(owner.state.value.connected); assertTrue(links.last().closed)
        assertEquals(2, links.size)
    }
    @Test fun restoredUncertainReceiptNeverReplaysOnReconnect() = fixture(true) { owner, _, links ->
        assertTrue(owner.state.value.uncertain)
        owner.startMaintenance(); until { owner.state.value.connected }
        owner.print(Bitmap.createBitmap(240, 96, Bitmap.Config.ARGB_8888), 2)
        links[0].lost("fixture disconnected")
        until { links.size >= 2 && owner.state.value.connected }
        assertTrue(PrintRecovery(context).pending())
        assertTrue(links.all { 0x01 !in it.commands })
    }
    @Test fun heartbeatAndSinglePrintNeverOverlap() = fixture { owner, _, links ->
        PrintRecovery(context).clear()
        owner.startMaintenance(); until { owner.state.value.connected }
        var completed = false
        val bitmap = Bitmap.createBitmap(240, 96, Bitmap.Config.ARGB_8888).apply { eraseColor(-1) }
        owner.print(bitmap, 2, { completed = true })
        until { completed && !owner.state.value.busy }
        delay(50)
        assertEquals(1, links.sumOf { it.commands.count { command -> command == 0x01 } })
        assertEquals(1, links.maxOf { it.maxActive })
        assertFalse(PrintRecovery(context).pending())
    }
    @Test fun failedDurableStartHookPreventsPhysicalOutput() = fixture { owner, _, links ->
        owner.startMaintenance(); until {owner.state.value.connected}
        var failed=false
        owner.printSeries(listOf(PrinterPage(
            image={Bitmap.createBitmap(240,96,Bitmap.Config.ARGB_8888).apply {eraseColor(-1)}},
            starting={throw java.io.IOException("fixture storage failure")}
        )),2,failed={_,_->failed=true})
        until {failed&&!owner.state.value.busy}
        assertTrue(links.all {0x01 !in it.commands})
        assertFalse(PrintRecovery(context).pending())
    }
    @Test fun failedDurableCompletionHookStopsRemainingPagesAndNeverReplays() = fixture { owner, _, links ->
        owner.startMaintenance(); until {owner.state.value.connected}
        var failed=false
        val page=PrinterPage(
            image={Bitmap.createBitmap(240,96,Bitmap.Config.ARGB_8888).apply {eraseColor(-1)}},
            completed={throw java.io.IOException("fixture receipt failure")}
        )
        owner.printSeries(listOf(page,page),2,failed={_,_->failed=true})
        until {failed&&!owner.state.value.busy}
        assertEquals(1,links.sumOf {link->link.commands.count {it==0x01}})
        assertTrue(PrintRecovery(context).pending());assertTrue(owner.state.value.uncertain)
        until {owner.state.value.connected};delay(50)
        assertEquals(1,links.sumOf {link->link.commands.count {it==0x01}})
    }
}
