package top.protium.acornary

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class TerminalModelsTest {
    @Test fun decimalValidationPreservesPrecisionAndRejectsAmbiguity() {
        assertEquals("0.000000000000001", validateAmount("0.000000000000001", Amount("0.1", "mL")))
        listOf("0", "-1", "0.100000000000001", "1e-3", "NaN", " 0.1", "00.1", ".1").forEach {
            assertTrue("Accepted $it", runCatching { validateAmount(it, Amount("0.1", "mL")) }.isFailure)
        }
    }
    @Test fun upcomingIncludesOverdueAndExcludesUnknownContainerAndEnded() {
        val today = LocalDate.now(ZoneId.of("Pacific/Kiritimati"))
        fun item(id: String, days: Long) = StockItem(id, id, 1, reminder = Reminder(today.plusDays(days).toString()))
        val overdue = item("overdue", -5)
        val end = item("end", 7)
        val list = listOf(item("later", 8), end, overdue, StockItem("unknown", "Unknown", 1), item("container", 0).copy(is_container = true), item("done", 0).copy(terminal = true))
        assertEquals(listOf("overdue", "end"), upcoming(list, "Pacific/Kiritimati").map { it.id })
    }
    @Test fun serverProjectionParsesUnknownFieldsAndNullableReminder() {
        val item = wire.decodeFromString<StockItem>("""{"id":"item_a","name":"牛奶","revision":2,"state":null,"reminder":{"basis":[]},"future_field":true}""")
        assertNull(item.reminder.date)
        assertEquals("余量未记录", item.quantity())
        assertFalse(item.copy(terminal = true).canConsume)
        assertFalse(item.copy(is_container = true).canOpen)
    }
}
