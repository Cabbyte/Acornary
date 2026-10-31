package top.protium.acornary

import java.net.URI
import java.nio.ByteBuffer
import java.util.Base64
import java.util.UUID

/** The same reversible UUID representation used by the web labels; never an authorization token. */
object ItemLink {
    private val compact = Regex("^[A-Za-z0-9_-]{22}$")
    fun encode(id: String): String {
        require(Regex("^item_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$").matches(id)) { "物品编号无效，不能生成标签。" }
        val uuid = UUID.fromString(id.removePrefix("item_"))
        require(uuid.variant() == 2 && uuid.version() in 1..8)
        val bytes = ByteBuffer.allocate(16).putLong(uuid.mostSignificantBits).putLong(uuid.leastSignificantBits).array()
        return "$ORIGIN/i/${Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)}"
    }
    fun parse(raw: String): String? = runCatching {
        val url = URI(raw)
        require(url.scheme == "https" && url.host == "acornary.protium.top")
        require(url.port == -1 && url.userInfo == null && url.query == null && url.fragment == null)
        require(url.rawPath == url.path)
        val value = url.path.removePrefix("/i/")
        require(url.path == "/i/$value" && compact.matches(value))
        val bytes = Base64.getUrlDecoder().decode(value)
        require(bytes.size == 16 && Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) == value)
        val b = ByteBuffer.wrap(bytes)
        val uuid = UUID(b.long, b.long)
        require(uuid.variant() == 2 && uuid.version() in 1..8)
        "item_$uuid"
    }.getOrNull()
}
