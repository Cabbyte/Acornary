package top.protium.acornary

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import java.time.ZoneId

/** Signature-protected display projection. Tokens never cross this boundary. */
class AmbientProvider : ContentProvider() {
    override fun onCreate() = true
    override fun getType(uri: Uri) = "vnd.android.cursor.item/vnd.acornary.ambient"
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
        require(uri.path == "/snapshot")
        val app = requireNotNull(context).terminal
        val state = app.repository.state.value
        val prefs = app.preferences.state.value
        val timezone = state.session?.household?.timezone ?: ZoneId.systemDefault().id
        val items = state.snapshot?.items?.let { upcoming(it, timezone) } ?: emptyList()
        val status = when {
            state.loading -> "正在读取库存"
            state.session == null -> "请登录松仓终端"
            !prefs.enabled -> "终端模式已暂停"
            state.snapshot == null -> "等待首次同步"
            !state.online -> "离线 · ${friendlyDate(state.snapshot.synced_at, timezone)}"
            SyncScheduler.isStale(app, state.snapshot.synced_at) -> "数据待更新 · ${friendlyDate(state.snapshot.synced_at, timezone)}"
            else -> "已同步 ${friendlyDate(state.snapshot.synced_at, timezone)}"
        }
        val lines = if (state.session == null) "打开终端连接家庭库存" else if (state.snapshot == null) "等待库存更新" else if (items.isEmpty()) "未来 7 天没有临期物品" else items.take(4).joinToString("\n") { "${it.name}\t${it.reminder.date} · ${it.location}" }
        return MatrixCursor(arrayOf("title", "status", "lines", "timezone", "rotation", "wave", "extra")).apply {
            addRow(arrayOf(state.session?.household?.name ?: "松仓", status, lines, timezone, prefs.rotation, if (prefs.enabled && prefs.wave) 1 else 0, (items.size - 4).coerceAtLeast(0)))
            setNotificationUri(app.contentResolver, ambientUri)
        }
    }
    override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException("Read only")
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException("Read only")
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException("Read only")
}
