package top.protium.acornary

import java.security.MessageDigest
import java.time.*
import java.time.format.DateTimeFormatter
import java.util.Locale

enum class InventoryFilter(val title: String) { RECENT("最近"), URGENT("临期"), ALL("全部") }
fun recentItems(items: List<StockItem>, timezone: String, days: Int = 7, now: Instant = Instant.now()): List<StockItem> {
    val zone = ZoneId.of(timezone)
    val start = now.atZone(zone).toLocalDate().minusDays((days - 1).toLong()).atStartOfDay(zone).toInstant()
    return items.filter { !it.is_container && !it.terminal && it.label_updated_at?.let { value ->
        runCatching { Instant.parse(value).let { date -> !date.isBefore(start) && !date.isAfter(now) } }.getOrDefault(false)
    } == true }.sortedWith(compareByDescending<StockItem> { it.label_updated_at?.let(Instant::parse) }.thenByDescending { it.id })
}
fun printFingerprint(item: StockItem, size: LabelSize): String {
    val label = LabelContent.item(item)
    // Actual visible values only; unrelated revisions, movements, opening and quantity do not alter a label.
    val fields = listOf("label-v2", size.key, item.id, label.name, label.specification, label.date ?: "", if (label.date == null) "" else label.dateTitle, label.url, label.suffix)
    val canonical = fields.joinToString("") { "${it.toByteArray(Charsets.UTF_8).size}:$it" }
    return MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray()).joinToString("") { "%02x".format(it) }
}
fun recentLabel(item: StockItem, timezone: String) = item.label_updated_at?.let {
    runCatching { Instant.parse(it).atZone(ZoneId.of(timezone)).format(DateTimeFormatter.ofPattern("M/d HH:mm", Locale.CHINESE)) }.getOrDefault("待同步")
} ?: "待同步"

data class BrowseState(val filter: InventoryFilter = InventoryFilter.RECENT, val days: Int = 7,
    val query: String = "", val searching: Boolean = false, val location: String? = null, val opening: Int = 0)
fun visibleInventory(state: TerminalState, browse: BrowseState): List<StockItem> {
    val items = state.snapshot?.items ?: return emptyList()
    val timezone = state.session?.household?.timezone ?: ZoneId.systemDefault().id
    val filtered = when(browse.filter) {
        InventoryFilter.RECENT -> recentItems(items, timezone, browse.days)
        InventoryFilter.URGENT -> upcoming(items, timezone)
        InventoryFilter.ALL -> items.filterNot { it.terminal }.sortedWith(compareBy<StockItem> { it.name.lowercase(Locale.CHINESE) }.thenBy { it.id })
    }
    return filtered.filter { item -> item.matches(browse.query) && (browse.location == null || browse.location in item.location_ids) &&
        (browse.opening == 0 || !item.is_container && when(browse.opening) { 1 -> item.opening_state == "OPENED" || item.opened_at != null; 2 -> item.opening_state == "SEALED"; else -> item.opening_state == null && item.opened_at == null }) }
}
