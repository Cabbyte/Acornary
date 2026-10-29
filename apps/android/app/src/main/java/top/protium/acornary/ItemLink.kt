package top.protium.acornary

import java.net.URI
import java.nio.ByteBuffer
import java.util.Base64
import java.util.UUID

/** The same reversible UUID representation used by the web labels; never an authorization token. */
object ItemLink {
    private val compact = Regex("^[A-Za-z0-9_-]{22}$")
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
