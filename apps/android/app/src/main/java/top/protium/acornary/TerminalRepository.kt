package top.protium.acornary

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import java.time.Instant
import java.util.UUID

data class TerminalState(
    val loading: Boolean = true, val session: SessionContext? = null, val snapshot: StockSnapshot? = null,
    val selected: StockItem? = null, val notes: List<Note> = emptyList(), val history: List<HistoryEvent> = emptyList(),
    val historyCursor: String? = null, val historyLoaded: Boolean = false,
    val syncing: Boolean = false, val busy: Boolean = false, val online: Boolean = false,
    val message: String? = null, val pending: List<PendingOperation> = emptyList(), val selectedOffline: Boolean = false,
)

class TerminalRepository(private val context: Context, private val dao: TerminalDao, val auth: TerminalAuth) {
    val api = TerminalApi(auth)
    private val mutable = MutableStateFlow(TerminalState())
    val state: StateFlow<TerminalState> = mutable.asStateFlow()
    private val syncMutex = Mutex()
    private val commandMutex = Mutex()
    private val commitMutex = Mutex()
    @Volatile private var generation = 0

    fun connected(): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        return cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    }
    fun message(value: String?) { mutable.update { it.copy(message = value) } }
    suspend fun initialize() {
        withContext(Dispatchers.IO) {
            if (!auth.hasCredentials()) { dao.clear(); mutable.value = TerminalState(loading = false, online = connected()); return@withContext }
            val session = dao.get("session")?.json?.let { runCatching { wire.decodeFromString<SessionContext>(it) }.getOrNull() }
            val snapshot = session?.let { dao.get("${it.scope}:snapshot")?.json?.let { json -> runCatching { wire.decodeFromString<StockSnapshot>(json) }.getOrNull() } }
            mutable.value = TerminalState(loading = false, session = session, snapshot = snapshot, online = connected(), pending = session?.let { dao.pending(it.scope) } ?: emptyList())
        }
    }
    suspend fun refresh(): Boolean = syncMutex.withLock {
        if (!auth.hasCredentials()) return@withLock false
        if (!connected()) { mutable.update { it.copy(online = false) }; return@withLock false }
        val epoch = generation
        val started = android.os.SystemClock.elapsedRealtime()
        var succeeded = false
        mutable.update { it.copy(syncing = true, online = true) }
        try {
            withTimeout(30_000) {
                val session = wire.decodeFromString<SessionContext>(api.get("/context"))
                val snapshot = wire.decodeFromString<StockSnapshot>(api.get("/snapshot"))
                require(snapshot.version == 1 && snapshot.household.id == session.household.id)
                commitMutex.withLock {
                    if (epoch != generation) return@withTimeout
                    withContext(Dispatchers.IO) {
                        val previous = mutable.value.session
                        dao.snapshot(CacheEntry("session", wire.encodeToString(session), System.currentTimeMillis()),
                            CacheEntry("${session.scope}:snapshot", wire.encodeToString(snapshot), System.currentTimeMillis()), previous != null && previous.scope != session.scope)
                        mutable.update { old -> old.copy(loading = false, session = session, snapshot = snapshot, online = true,
                            selected = old.selected?.let { selected -> snapshot.items.find { it.id == selected.id } ?: selected }, pending = dao.pending(session.scope)) }
                    }
                }
            }
            succeeded = epoch == generation
            succeeded
        } catch (error: Exception) {
            if (error is CancellationException && error !is TimeoutCancellationException) throw error
            if (epoch == generation) handle(error)
            false
        } finally {
            withContext(NonCancellable + Dispatchers.IO) { SyncJournal.record(context, succeeded, android.os.SystemClock.elapsedRealtime() - started) }
            if (epoch == generation) mutable.update { it.copy(syncing = false) }
        }
    }
    suspend fun select(id: String) {
        selectedRequest = id
        val epoch = generation
        val session = mutable.value.session ?: return
        val cached = withContext(Dispatchers.IO) { dao.get("${session.scope}:detail:$id")?.json?.let { runCatching { wire.decodeFromString<ItemDetail>(it) }.getOrNull() } }
        val item = mutable.value.snapshot?.items?.find { it.id == id } ?: cached?.item
        if (epoch != generation || selectedRequest != id) return
        mutable.update { it.copy(selected = item, notes = cached?.notes ?: emptyList(), history = emptyList(), historyLoaded = false, historyCursor = null, selectedOffline = true, message = null) }
        if (!connected()) { if (item == null) message("离线缓存中没有这个物品，联网后再试。"); return }
        try {
            val detail = wire.decodeFromString<ItemDetail>(api.get("/items/$id"))
            require(detail.item.id == id && detail.household.id == session.household.id)
            commitMutex.withLock {
                if (epoch != generation) return
                withContext(Dispatchers.IO) { dao.put(CacheEntry("${session.scope}:detail:$id", wire.encodeToString(detail), System.currentTimeMillis())) }
                if (selectedRequest == id) mutable.update { it.copy(selected = detail.item, notes = detail.notes, selectedOffline = false, online = true) }
            }
        } catch (error: Exception) { if (epoch == generation && selectedRequest == id) handle(error) }
    }
    private var selectedRequest: String? = null
    suspend fun history() {
        val item = mutable.value.selected ?: return
        val cursor = mutable.value.historyCursor
        if (mutable.value.historyLoaded && cursor == null) return
        val epoch = generation
        try {
            val suffix = cursor?.let { "&cursor=${java.net.URLEncoder.encode(it, "UTF-8")}" } ?: ""
            val page = wire.decodeFromString<HistoryPage>(api.get("/items/${item.id}/history?limit=20$suffix"))
            if (epoch == generation && selectedRequest == item.id) mutable.update { it.copy(history = (it.history + page.data).distinctBy { h -> h.id }, historyCursor = page.next_cursor, historyLoaded = true) }
        } catch (error: Exception) { if (epoch == generation) handle(error) }
    }
    suspend fun command(name: String, item: StockItem, amount: String? = null, accuracy: String = "ESTIMATED") = commandMutex.withLock {
        val session = mutable.value.session ?: return@withLock
        if (!connected()) { message("当前离线，库存操作未提交。"); return@withLock }
        if (mutable.value.pending.isNotEmpty()) { message("请先核对上一笔结果待确认的操作。"); return@withLock }
        val key = UUID.randomUUID().toString()
        val body = buildJsonObject {
            put("idempotency_key", key)
            putJsonObject("expected_revisions") { put(item.id, item.revision) }
            when (name) {
                "open_item" -> { require(item.canOpen); put("item_id", item.id); put("opened_at", Instant.now().toString()) }
                "consume_items" -> { require(item.canConsume); putJsonArray("item_ids") { add(item.id) } }
                "consume_item_content" -> {
                    require(item.canConsume)
                    val remaining = requireNotNull(item.remaining)
                    put("item_id", item.id); put("accuracy", accuracy)
                    putJsonObject("amount") { put("value", validateAmount(requireNotNull(amount), remaining)); put("unit", remaining.unit) }
                }
                else -> error("不支持的操作")
            }
        }.toString()
        val operation = PendingOperation(key, session.scope, item.id, name, body, System.currentTimeMillis())
        commitMutex.withLock { withContext(Dispatchers.IO) { dao.insert(operation); mutable.update { it.copy(pending = dao.pending(session.scope)) } } }
        send(operation)
    }
    suspend fun resolve(operation: PendingOperation, retry: Boolean) = commandMutex.withLock {
        if (mutable.value.session?.scope != operation.scope) return@withLock
        if (!connected()) { message("联网后才能核对操作结果。"); return@withLock }
        try {
            val result = wire.parseToJsonElement(api.get("/operations/${operation.key}")).jsonObject
            if (result["status"]?.jsonPrimitive?.content == "committed") {
                finish(operation); message("已确认操作完成。"); refresh(); select(operation.itemId)
            } else if (retry) send(operation) else message("暂未查到已提交结果。可使用原请求重试，不会重复扣减。")
        } catch (error: Exception) { handle(error) }
    }
    private suspend fun send(operation: PendingOperation) {
        val epoch = generation
        mutable.update { it.copy(busy = true) }
        try {
            withTimeout(30_000) { api.post("/commands/${operation.command}", operation.json) }
            if (epoch != generation) return
            finish(operation); refresh(); select(operation.itemId); message("操作已完成。")
        } catch (error: Exception) {
            if (epoch != generation) return
            if (error is ApiFailure && error.status in 400..499 && error.status !in listOf(401, 408, 429) && error.code != "TERMINAL_AUTH_INVALID") {
                finish(operation)
                if (error.code == "REVISION_CONFLICT") { refresh(); select(operation.itemId); message("物品已被其他操作更新，请核对最新数据后重新提交。") }
                else handle(error)
            } else if (error is LoginRequired || error is ApiFailure && (error.status == 401 || error.code == "TERMINAL_AUTH_INVALID")) handle(error)
            else {
                val committed = runCatching { withTimeout(10_000) {
                    wire.parseToJsonElement(api.get("/operations/${operation.key}")).jsonObject["status"]?.jsonPrimitive?.content == "committed"
                } }.getOrDefault(false)
                if (epoch != generation) return
                if (committed) { finish(operation); refresh(); select(operation.itemId); message("已核对，操作完成。") }
                else message("结果待确认，请先核对；重试将使用同一请求，不会重复扣减。")
            }
        } finally { if (epoch == generation) mutable.update { it.copy(busy = false) } }
    }
    private suspend fun finish(operation: PendingOperation) = commitMutex.withLock {
        if (mutable.value.session?.scope == operation.scope) withContext(Dispatchers.IO) {
            dao.resolve(operation.key); mutable.update { it.copy(pending = dao.pending(operation.scope)) }
        }
    }
    suspend fun logout(revoke: Boolean = true) {
        commitMutex.withLock {
            generation++
            mutable.value = TerminalState(loading = false, online = connected())
            selectedRequest = null
            withContext(Dispatchers.IO) { dao.clear() }
        }
        if (revoke) auth.logout() else auth.clear()
    }
    private suspend fun handle(error: Exception) {
        if (error is CancellationException && error !is TimeoutCancellationException) throw error
        if (error is LoginRequired || error is ApiFailure && (error.status == 401 || error.code == "TERMINAL_AUTH_INVALID")) {
            logout(false); message("授权已失效，请重新登录。")
        } else if (error is ApiFailure) message(when(error.code) {
            "NOT_FOUND" -> "物品不存在或不属于当前家庭。"
            "MISSING_FACTS" -> "物品没有已知剩余量，请在电脑上补充后重试。"
            "INSUFFICIENT_CONTENT" -> "消耗量超过当前剩余量，请刷新详情后核对。"
            "UNIT_MISMATCH" -> "剩余量单位已变化，请刷新详情后重新输入。"
            "INVALID_TRANSITION" -> "物品已结束或当前生命周期不允许此操作。"
            "IDEMPOTENCY_CONFLICT" -> "此操作编号已有不同参数的提交，请核对操作历史。"
            else -> error.message
        })
        else { mutable.update { it.copy(online = connected()) }; message("暂时无法更新，仍显示上次成功同步的数据。") }
    }
}
