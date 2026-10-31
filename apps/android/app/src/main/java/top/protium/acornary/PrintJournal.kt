package top.protium.acornary

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.util.UUID

private const val pendingPage = "PENDING"
data class BatchLabel(val item: StockItem, val fingerprint: String, val status: String = pendingPage, val alreadyPrinted: Boolean = false)
data class BatchReview(
    val scope: String, val size: LabelSize, val density: Int, val pages: List<BatchLabel>,
    val selected: Set<String>, val id: String? = null, val visible: Boolean = true,
    val busy: Boolean = false, val preparing: Boolean = false, val message: String? = null,
)

/** A durable receipt, not a background/offline print queue. Only start() can submit pages. */
class PrintJournal(
    private val dao: TerminalDao, private val repo: TerminalRepository,
    private val printer: PrinterController, private val scope: CoroutineScope,
    private val sessionScope: () -> String? = { repo.state.value.session?.scope },
    private val readMany: suspend (List<String>, String) -> List<StockItem> = { ids, household -> repo.freshPrintItems(ids, household) },
    private val readOne: suspend (String, String) -> StockItem = { id, household -> repo.itemForLabel(id, household) },
) {
    private val mutable = MutableStateFlow<BatchReview?>(null)
    val state = mutable.asStateFlow()
    private var household: String? = null
    private var initialized = false
    private var generation = 0
    private var preparation: Job? = null
    private var afterStop: (() -> Unit)? = null
    private fun current(value: BatchReview) = sessionScope() == value.scope
    suspend fun scopeChanged(value: String?) {
        if (initialized && household == value) return
        initialized = true; preparation?.cancel(); household = value; generation++; afterStop = null; mutable.value = null
        if (value == null) return
        val epoch = generation
        val restored = withContext(Dispatchers.IO) {
            dao.recoverPrinting(value)
            val batch = dao.printBatches(value).firstOrNull() ?: return@withContext null
            if (batch.status == "DONE") return@withContext null
            val pages = dao.printPages(batch.id).map { BatchLabel(wire.decodeFromString<StockItem>(it.json), it.fingerprint, it.status) }
            if (pages.none { it.status == pendingPage || it.status == "UNCERTAIN" }) return@withContext null
            BatchReview(value, LabelSize.from(batch.size), batch.density, pages,
                pages.filter { it.status == pendingPage }.map { it.item.id }.toSet(), batch.id, visible = false,
                message = "上次批次已停止，不会自动继续。请核对结果后选择未完成标签。")
        }
        if (epoch == generation && sessionScope() == value) mutable.value = restored
    }
    fun show() { mutable.update { it?.copy(visible = true) } }
    fun open(items: List<StockItem>, size: LabelSize, density: Int, forceSingle: Boolean = false) {
        val account = sessionScope() ?: return
        if (mutable.value?.busy == true || printer.state.value.busy) return
        if (mutable.value?.pages?.any { it.status == "UNCERTAIN" } == true) { show(); return }
        val epoch = generation
        mutable.value = BatchReview(account, size, density, emptyList(), emptySet(), preparing = true)
        preparation = scope.launch {
            try {
                val printed = withContext(Dispatchers.IO) { dao.printedFingerprints(account).toSet() }
                val pages = items.filter { it.canConsume }.distinctBy { it.id }.map { item ->
                    val hash = printFingerprint(item, size)
                    BatchLabel(item, hash, alreadyPrinted = hash in printed)
                }
                val candidates = if (forceSingle) pages else pages.filterNot { it.alreadyPrinted }
                if (epoch == generation && sessionScope() == account) mutable.value = BatchReview(account, size, density, pages,
                    if (candidates.size <= 100) candidates.map { it.item.id }.toSet() else emptySet(),
                    message = if (candidates.size > 100) "候选超过 100 件，请手动选择最多 100 件，或取消后缩小筛选范围。" else null)
            } catch (error: Exception) { if (epoch == generation) mutable.update { it?.copy(preparing = false, message = error.message ?: "无法读取本机打印记录。") } }
        }
    }
    fun toggle(id: String) {
        mutable.update { old ->
            if (old == null || old.busy || old.preparing) old
            else {
                val page = old.pages.find { it.item.id == id }
                if (page == null || !page.item.canConsume || page.status == "UNCERTAIN") old
                else if (id !in old.selected && old.selected.size >= 100) old.copy(message = "每批最多 100 件。")
                else old.copy(selected = if (id in old.selected) old.selected - id else old.selected + id, message = null)
            }
        }
    }
    fun selectAll() {
        mutable.update { old ->
            if (old == null || old.busy || old.preparing) old
            else {
                val ids = old.pages.filter { it.item.canConsume && it.status != "UNCERTAIN" }.map { it.item.id }.toSet()
                if (ids.size > 100) old.copy(message = "当前结果超过 100 件，请缩小范围或手动选择。")
                else old.copy(selected = if (old.selected == ids) emptySet() else ids, message = null)
            }
        }
    }
    fun leave(action: () -> Unit = {}) {
        if (mutable.value?.busy == true) { afterStop = { mutable.update { it?.copy(visible = false) }; action() }; printer.requestStop() }
        else { preparation?.cancel(); mutable.update { it?.copy(visible = false, preparing = false) }; action() }
    }
    fun background() { if (mutable.value?.preparing == true) { preparation?.cancel(); mutable.update { it?.copy(preparing = false, message = "核对已暂停，返回后重新点击开始。") } } }
    fun acknowledge(id: String, printed: Boolean) {
        val review = mutable.value ?: return
        val batchId = review.id ?: return
        if (review.busy || review.preparing || !current(review)) return
        val position = review.pages.indexOfFirst { it.item.id == id && it.status == "UNCERTAIN" }
        if (position < 0) return
        scope.launch {
            try {
                val status = if (printed) "CONFIRMED" else pendingPage
                withContext(Dispatchers.IO) { check(dao.printPageStatus(batchId, position, status, System.currentTimeMillis()) == 1) }
                mutable.update { it?.copy(pages = it.pages.mapIndexed { index, page -> if (index == position) page.copy(status = status) else page },
                    selected = if (printed) it.selected - id else it.selected + id, message = "已核对纸张；补打仍需点击开始。") }
                if (mutable.value?.pages?.none { it.status == "UNCERTAIN" } == true) printer.acknowledge()
            } catch (error: Exception) { mutable.update { it?.copy(message = error.message ?: "未能保存核对结果。") } }
        }
    }
    fun start() {
        val review = mutable.value ?: return
        if (review.busy || review.preparing || !current(review) || review.selected.isEmpty() || review.selected.size > 100 || !printer.state.value.connected || printer.state.value.busy || printer.state.value.uncertain) return
        if (review.pages.any { it.status == "UNCERTAIN" }) return
        val chosen = review.pages.filter { it.item.id in review.selected }
        val epoch = generation
        mutable.update { it?.copy(preparing = true, message = null) }
        preparation = scope.launch {
            var createdId: String? = null
            try {
                val fresh = readMany(chosen.map { it.item.id }, review.scope).associateBy { it.id }
                check(epoch == generation && current(review)) { "家庭已变化。" }
                val changed = chosen.any { page -> fresh[page.item.id]?.let { !it.canConsume || printFingerprint(it, review.size) != page.fingerprint } != false }
                if (changed) {
                    mutable.update { old -> old?.copy(preparing = false,
                        pages = old.pages.map { page -> fresh[page.item.id]?.let { page.copy(item = it, fingerprint = printFingerprint(it, review.size)) } ?: page },
                        selected = old.selected.filter { fresh[it]?.canConsume != false }.toSet(),
                        message = "物品资料已变化，预览已刷新；已结束物品已取消勾选，请重新核对。") }
                    return@launch
                }
                val id = UUID.randomUUID().toString(); createdId = id
                val frozen = chosen.map { page -> page.copy(item = fresh.getValue(page.item.id), status = pendingPage) }
                withContext(Dispatchers.IO) {
                    check(epoch == generation && current(review))
                    dao.createPrintBatch(PrintBatchRecord(id, review.scope, review.size.key, review.density, "RUNNING", System.currentTimeMillis()),
                        frozen.mapIndexed { position, page -> PrintPageRecord(id, position, review.scope, page.item.id, page.fingerprint, wire.encodeToString(page.item), pendingPage, System.currentTimeMillis()) })
                }
                mutable.value = review.copy(id = id, pages = frozen, selected = frozen.map { it.item.id }.toSet(), busy = true, preparing = false, message = null)
                fun displayStatus(position: Int, status: String) {
                    if (epoch == generation) mutable.update { old -> if (old?.id != id) old else old.copy(pages = old.pages.mapIndexed { index, page -> if (index == position) page.copy(status = status) else page }) }
                }
                val accepted = printer.printSeries(frozen.mapIndexed { position, page -> PrinterPage(
                    image = { LabelRenderer.render(LabelContent.item(page.item), review.size) },
                    validate = {
                        check(epoch == generation && current(review)) { "家庭已变化。" }
                        val latest = readOne(page.item.id, review.scope)
                        check(latest.canConsume && printFingerprint(latest, review.size) == page.fingerprint) { "物品已结束或标签资料变化，请重新核对未完成标签。" }
                        true
                    }, starting = {
                        check(dao.printPageStatus(id, position, "SENDING", System.currentTimeMillis()) == 1) { "无法保存发送状态，已停止。" }
                        displayStatus(position, "SENDING")
                    }, completed = {
                        check(dao.printPageStatus(id, position, "DONE", System.currentTimeMillis()) == 1) { "无法保存打印确认，已停止。" }
                        displayStatus(position, "DONE")
                    }) }, review.density, finished = { count ->
                        withContext(Dispatchers.IO) { check(dao.printBatchStatus(id, if (count == frozen.size) "DONE" else "STOPPED") == 1) }
                        if (epoch == generation) {
                            mutable.update { it?.copy(busy = false, selected = it.pages.filter { page -> page.status == pendingPage }.map { page -> page.item.id }.toSet(), message = if (count == frozen.size) "已完成 $count 张。" else "已停止后续打印，已完成 $count 张。") }
                            afterStop?.invoke(); afterStop = null
                        }
                    }, failed = { error, _ ->
                        try {
                            withContext(Dispatchers.IO) { dao.recoverPrinting(review.scope); dao.printBatchStatus(id, "STOPPED") }
                        } finally {
                            if (epoch == generation) {
                                mutable.update { old -> old?.copy(busy = false, selected = emptySet(), pages = old.pages.map { if (it.status == "SENDING") it.copy(status = "UNCERTAIN") else it }, message = error.message ?: "打印已停止，请核对纸张。") }
                                withContext(Dispatchers.Main) { afterStop?.invoke(); afterStop = null }
                            }
                        }
                    })
                if (!accepted) {
                    withContext(Dispatchers.IO) { dao.printBatchStatus(id, "STOPPED") }
                    mutable.update { it?.copy(busy = false, message = "连接状态已变化，请等待重连后重新点击开始。") }
                }
            } catch (error: Exception) {
                createdId?.let { id -> withContext(NonCancellable + Dispatchers.IO) { runCatching { dao.printBatchStatus(id, "STOPPED") } } }
                if (epoch == generation) mutable.update { it?.copy(preparing = false, busy = false, message = error.message ?: "无法开始打印。") }
            }
        }
    }
}
