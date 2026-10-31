package top.protium.acornary

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.math.BigDecimal
import java.time.LocalDate
import java.time.ZoneId

val wire = Json { ignoreUnknownKeys = true; encodeDefaults = true }
const val ORIGIN = "https://acornary.protium.top"
const val API = "$ORIGIN/api/terminal/v1"
const val CALLBACK = "$ORIGIN/android/oauth/callback"

@Serializable data class Household(val id: String, val name: String, val timezone: String)
@Serializable data class Account(val id: String, val name: String)
@Serializable data class SessionContext(val account: Account, val household: Household, val commands: List<String> = emptyList()) {
    val scope get() = "${account.id}:${household.id}"
}
@Serializable data class Amount(val value: String, val unit: String)
@Serializable data class Reminder(val date: String? = null, val basis: List<String> = emptyList())
@Serializable data class StockItem(
    val id: String, val name: String, val revision: Int,
    val brand: String = "", val specification: String = "",
    val is_container: Boolean = false, val terminal: Boolean = false, val state: String? = null,
    val opening_state: String? = null, val opened_at: String? = null,
    val expiry_date: String? = null, val expiry_kind: String? = null, val after_opening_days: Int? = null,
    val remaining: Amount? = null, val accuracy: String? = null, val reminder: Reminder = Reminder(),
    val created_at: String? = null, val label_updated_at: String? = null,
    val location_ids: List<String> = emptyList(), val location: String = "未记录位置",
) {
    val canOpen get() = !terminal && !is_container && opening_state != "OPENED" && opened_at == null
    val canConsume get() = !terminal && !is_container
    fun quantity() = remaining?.let { "${it.value} ${if (it.unit == "count") "份" else if (it.unit == "percent") "%" else it.unit}" } ?: "余量未记录"
    fun matches(search: String) = "$name $brand $specification".contains(search.trim(), ignoreCase = true)
}
@Serializable data class StockSnapshot(val version: Int = 1, val household: Household, val synced_at: String, val items: List<StockItem>)
@Serializable data class Note(val id: String, val title: String? = null, val body: String, val updated_at: String)
@Serializable data class ItemDetail(val item: StockItem, val notes: List<Note> = emptyList(), val household: Household, val synced_at: String)
@Serializable data class HistoryChange(val path: String, val before: JsonElement? = null, val after: JsonElement? = null)
@Serializable data class HistoryEvent(val id: String, val event_type: String, val occurred_at: String, val recorded_at: String, val changes: List<HistoryChange> = emptyList())
@Serializable data class HistoryPage(val data: List<HistoryEvent> = emptyList(), val next_cursor: String? = null)
@Serializable data class AuthConfig(val version: Int, val client_id: String, val resource: String, val redirect_uri: String, val authorization_endpoint: String, val token_endpoint: String, val revocation_endpoint: String, val scopes: List<String>) {
    fun validate() {
        require(version == 1 && client_id.isNotBlank() && resource == API && redirect_uri == CALLBACK)
        require(authorization_endpoint == "$ORIGIN/api/auth/oauth2/authorize" && token_endpoint == "$ORIGIN/api/auth/oauth2/token" && revocation_endpoint == "$ORIGIN/api/auth/oauth2/revoke")
    }
}
fun upcoming(items: List<StockItem>, timezone: String): List<StockItem> {
    val end = LocalDate.now(ZoneId.of(timezone)).plusDays(7)
    return items.filter { !it.terminal && !it.is_container && it.reminder.date?.let { d -> LocalDate.parse(d) <= end } == true }
        .sortedWith(compareBy<StockItem> { it.reminder.date }.thenBy { it.name }.thenBy { it.id })
}
fun validateAmount(input: String, remaining: Amount): String {
    require(input.length in 1..80 && Regex("^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$").matches(input)) { "请输入正数，不使用科学计数法。" }
    val value = BigDecimal(input)
    require(value > BigDecimal.ZERO && value <= BigDecimal(remaining.value)) { "消耗量必须大于零，且不超过剩余量。" }
    return value.toPlainString()
}
