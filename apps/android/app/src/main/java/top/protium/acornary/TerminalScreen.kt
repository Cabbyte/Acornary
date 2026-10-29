package top.protium.acornary

import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import androidx.lifecycle.Lifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

fun friendlyDate(value: String?, timezone: String? = null): String = value?.let {
    runCatching { Instant.parse(it).atZone(ZoneId.of(timezone ?: ZoneId.systemDefault().id)).format(DateTimeFormatter.ofPattern("M月d日 HH:mm")) }.getOrDefault(it)
} ?: "尚未同步"
fun reminderBasis(item: StockItem) = item.reminder.basis.joinToString("、") { when (it) {
    "lifecycle.expiry.date", "EXPIRY_DATE", "expiry", "expiry_date" -> "到期日期"
    "lifecycle.opening.opened_at + lifecycle.expiry.after_opening_days", "AFTER_OPENING", "after_opening", "after_opening_days" -> "开封保质期"
    else -> it
} }
fun lifecycleLabel(item: StockItem) = if (item.is_container) "容器" else if (item.terminal) when(item.state) { "CONSUMED" -> "已消耗"; "DISPOSED" -> "已丢弃"; "LOST" -> "已丢失"; "ARCHIVED" -> "已归档"; else -> "已结束" } else if (item.opening_state == "OPENED" || item.opened_at != null) "已开封" else if (item.opening_state == "SEALED") "未开封" else "开封状态未记录"

fun historyLabel(value: String) = mapOf("CREATE" to "创建", "UPDATE" to "更新", "EDIT" to "编辑", "MOVE" to "移动", "OPEN" to "开封", "CONSUME_ITEMS" to "整件消耗", "CONSUME_CONTENT" to "部分消耗", "CORRECT" to "纠正", "ATTRIBUTE_BIND" to "添加资料", "ATTRIBUTE_UPDATE" to "更新资料", "ATTRIBUTE_REMOVE" to "移除资料", "ATTRIBUTE_UPGRADE" to "升级资料", "NOTE_CREATE" to "添加笔记", "NOTE_UPDATE" to "更新笔记")[value] ?: "更新记录"
fun changeLabel(path: String) = mapOf("display_name" to "名称", "parent_id" to "位置", "catalog_node_id" to "商品", "lifecycle.state" to "生命周期", "lifecycle.opening.state" to "开封状态", "lifecycle.opening.opened_at" to "开封时间", "lifecycle.expiry.date" to "到期日期", "contents.remaining.value" to "剩余量", "contents.remaining" to "剩余量", "contents.accuracy" to "数量准确度")[path] ?: path

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TerminalScreen(model: TerminalViewModel, activity: MainActivity) {
    val state by model.state.collectAsStateWithLifecycle()
    val prefs by model.prefs.collectAsStateWithLifecycle()
    val page by model.page.collectAsStateWithLifecycle()
    val interaction by model.lastInteraction.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var scanning by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val inputActive = editing || WindowInsets.isImeVisible
    var inputAwake by remember { mutableStateOf(false) }
    var submissionAwake by remember { mutableStateOf(false) }
    LaunchedEffect(inputActive, interaction) {
        inputAwake = inputActive
        if (inputActive) { delay((300_000 - (SystemClock.elapsedRealtime() - interaction)).coerceAtLeast(0)); inputAwake = false }
    }
    LaunchedEffect(state.busy) {
        submissionAwake = state.busy
        if (state.busy) { delay(30_000); submissionAwake = false }
    }
    val keep = lifecycle.isAtLeast(Lifecycle.State.RESUMED) && (submissionAwake || scanning || inputAwake)
    DisposableEffect(keep) { activity.keepAwake(keep); onDispose { activity.keepAwake(false) } }
    LaunchedEffect(state.message) { state.message?.let { snackbar.showSnackbar(it); model.repo.message(null) } }
    fun login(switch: Boolean = false) { scope.launch {
        try {
            if (switch) model.repo.logout()
            model.repo.auth.begin(activity, switch)
        } catch (_: Exception) { model.repo.message("无法打开登录页面，请检查网络及浏览器。") }
    } }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Row(Modifier.fillMaxSize().padding(padding).safeDrawingPadding().imePadding()) {
            NavigationRail(Modifier.verticalScroll(rememberScrollState())) {
                Text("松仓", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(12.dp))
                listOf("临期", "库存", "扫码", "设置").forEachIndexed { index, label ->
                    NavigationRailItem(selected = page == index, onClick = { model.page.value = index },
                        icon = { Icon(listOf(Icons.Outlined.Schedule, Icons.Outlined.Inventory2, Icons.Outlined.QrCodeScanner, Icons.Outlined.Settings)[index], label) }, label = { Text(label) })
                }
            }
            VerticalDivider()
            Column(Modifier.weight(1f).padding(horizontal = 16.dp, vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(listOf("临期提醒", "家庭库存", "扫描物品", "终端设置")[page], style = MaterialTheme.typography.titleLarge)
                        val stale = SyncScheduler.isStale(activity, state.snapshot?.synced_at)
                        Text(state.session?.let { "${it.household.name} · ${if (!state.online) "离线 · " else ""}${if (stale) "数据待更新 · " else ""}${friendlyDate(state.snapshot?.synced_at, it.household.timezone)}" } ?: "登录后连接家庭库存",
                            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (state.syncing) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                    IconButton(onClick = { model.refresh() }, enabled = !state.syncing && state.session != null) { Icon(Icons.Outlined.Refresh, "刷新库存") }
                }
                if (state.pending.isNotEmpty()) {
                    val pending = state.pending.first()
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("上一笔操作结果待确认", Modifier.weight(1f), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelLarge)
                        TextButton(onClick = { model.resolve(pending, false) }, enabled = !state.busy) { Text("核对结果") }
                        TextButton(onClick = { model.resolve(pending, true) }, enabled = !state.busy) { Text("原请求重试") }
                    }
                }
                Spacer(Modifier.height(8.dp))
                when {
                    state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    page == 3 -> SettingsPane(state, prefs, model, activity, { login(true) }, { login() })
                    state.session == null -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Outlined.Inventory2, null, Modifier.size(48.dp))
                        Text("把家里的物品放在眼前", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(16.dp))
                        Text("登录松仓，选择家庭后即可查看和管理库存。")
                        Button(onClick = { login() }, modifier = Modifier.padding(16.dp)) { Text("登录松仓") }
                    }
                    page == 2 -> Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.weight(0.9f).fillMaxHeight()) { CameraPane(onItem = { model.select(it) }, onActive = { scanning = it }) }
                        Box(Modifier.weight(1.1f).fillMaxHeight()) { DetailPane(state, model, { editing = it }) }
                    }
                    else -> InventoryPane(page == 0, state, model) { editing = it }
                }
            }
        }
    }
}

@Composable
internal fun InventoryPane(urgent: Boolean, state: TerminalState, model: TerminalViewModel, editing: (Boolean) -> Unit) {
    var search by rememberSaveable { mutableStateOf("") }
    var location by rememberSaveable { mutableStateOf<String?>(null) }
    var opening by rememberSaveable { mutableIntStateOf(0) }
    var menu by remember { mutableStateOf(false) }
    val all = state.snapshot?.items ?: emptyList()
    val visible = (if (urgent) upcoming(all, state.session!!.household.timezone) else all).filter {
        it.matches(search) && (location == null || it.location_ids.contains(location)) &&
            (opening == 0 || !it.is_container && when(opening) { 1 -> it.opening_state == "OPENED" || it.opened_at != null; 2 -> it.opening_state == "SEALED"; else -> it.opening_state == null && it.opened_at == null })
    }
    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(0.95f)) {
            if (!urgent) {
                OutlinedTextField(search, { search = it; model.interact() }, singleLine = true, label = { Text("名称或品牌") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, modifier = Modifier.fillMaxWidth())
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) {
                        TextButton(onClick = { menu = true }) { Text(all.find { it.id == location }?.name ?: "全部位置", maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("全部位置") }, onClick = { location = null; menu = false })
                            all.filter { it.is_container }.forEach { container -> DropdownMenuItem(text = { Text(container.name) }, onClick = { location = container.id; menu = false }) }
                        }
                    }
                    TextButton(onClick = { opening = (opening + 1) % 4 }) { Text(listOf("全部状态", "已开封", "未开封", "状态未知")[opening]) }
                }
            } else Text("已过提醒日及未来 7 天", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(bottom = 8.dp))
            if (visible.isEmpty()) Text(if (urgent) "没有需要提醒的物品" else "没有符合条件的库存", Modifier.padding(16.dp))
            LazyColumn(Modifier.weight(1f)) {
                items(visible, key = { it.id }) { item ->
                    Surface(color = if (state.selected?.id == item.id) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface, shape = MaterialTheme.shapes.medium) {
                        ListItem(modifier = Modifier.clickable { if (item.is_container) { location = item.id; model.select(item.id) } else model.select(item.id) },
                            headlineContent = { Text(item.name, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                            supportingContent = { Text("${item.location}\n${if (item.is_container) "查看容器中的物品" else item.quantity()}${if (urgent) " · ${item.reminder.date} · ${reminderBasis(item)}" else " · ${lifecycleLabel(item)}"}", maxLines = 3, overflow = TextOverflow.Ellipsis) })
                    }
                }
            }
        }
        VerticalDivider()
        Box(Modifier.weight(1.05f)) { DetailPane(state, model, editing) }
    }
}

@Composable
internal fun DetailPane(state: TerminalState, model: TerminalViewModel, editing: (Boolean) -> Unit) {
    val item = state.selected
    var action by remember(item?.id) { mutableStateOf<String?>(null) }
    var amount by rememberSaveable(item?.id) { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val prefs by model.prefs.collectAsStateWithLifecycle()
    LaunchedEffect(item?.id) {
        val prefix = "${item?.id}|"
        if (prefs.draft.startsWith(prefix)) amount = prefs.draft.removePrefix(prefix)
    }
    DisposableEffect(action) { editing(action == "partial"); onDispose { editing(false) } }
    if (item == null) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("选择或扫描一个物品", color = MaterialTheme.colorScheme.onSurfaceVariant) }; return }
    val timezone = state.session?.household?.timezone
    val enabled = state.online && !state.busy && state.pending.isEmpty() && !state.selectedOffline
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(item.name, style = MaterialTheme.typography.titleLarge)
            if (item.brand.isNotBlank() || item.specification.isNotBlank()) Text("${item.brand} ${item.specification}", style = MaterialTheme.typography.bodyMedium)
            Text(item.location, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${lifecycleLabel(item)} · ${item.quantity()}", style = MaterialTheme.typography.titleMedium)
            if (state.selectedOffline) Text("缓存详情 · 联网核对后可操作", color = MaterialTheme.colorScheme.error)
            Text("提醒日期：${item.reminder.date ?: "未记录"}${reminderBasis(item).takeIf { it.isNotEmpty() }?.let { "（$it）" } ?: ""}")
            Text("到期日期：${item.expiry_date ?: "未记录"}")
            Text("开封时间：${item.opened_at?.let { friendlyDate(it, timezone) } ?: if (item.opening_state == "OPENED") "已开封，日期未知" else if (item.opening_state == "SEALED") "未开封" else "状态未记录"}")
            item.after_opening_days?.let { Text("开封后保质期：$it 天") }
            if (item.remaining == null && !item.is_container && !item.terminal) Text("未记录剩余量，无法部分消耗。", style = MaterialTheme.typography.bodySmall)
            if (item.terminal) Text("此物品已结束，不能继续消耗或开封。")
            if (item.is_container) Text("容器作为位置浏览，编辑请在电脑上完成。")
            HorizontalDivider()
            Text("笔记", style = MaterialTheme.typography.titleSmall)
            if (state.notes.isEmpty()) Text("没有笔记", style = MaterialTheme.typography.bodySmall)
            state.notes.forEach { note -> note.title?.let { Text(it, style = MaterialTheme.typography.titleSmall) }; Text(note.body) }
            HorizontalDivider()
            TextButton(onClick = { model.history() }, enabled = state.online && (!state.historyLoaded || state.historyCursor != null)) { Text(if (!state.historyLoaded) "查看操作历史" else if (state.historyCursor != null) "加载更多历史" else "已显示全部历史") }
            state.history.forEach { event ->
                Text("${friendlyDate(event.occurred_at, timezone)} · ${historyLabel(event.event_type)}", style = MaterialTheme.typography.labelLarge)
                event.changes.forEach { change -> Text("${changeLabel(change.path)}：${change.before ?: "—"} → ${change.after ?: "—"}", style = MaterialTheme.typography.bodySmall) }
            }
        }
        if (!item.is_container && !item.terminal) {
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (item.canOpen) FilledTonalButton(onClick = { model.command("open_item", item) }, enabled = enabled) { Text("开封") }
                if (item.remaining != null) FilledTonalButton(onClick = { action = "partial"; error = null }, enabled = enabled && java.math.BigDecimal(item.remaining.value).signum() > 0) { Text("部分消耗") }
                OutlinedButton(onClick = { action = "whole" }, enabled = enabled) { Text("整件消耗") }
            }
        }
    }
    if (action != null) AlertDialog(onDismissRequest = { action = null },
        title = { Text(if (action == "partial") "部分消耗" else "确认整件消耗") },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(item.name); Text(item.location)
            if (action == "partial") {
                Text("当前剩余 ${item.quantity()}")
                OutlinedTextField(amount, { amount = it; error = null; model.interact(); model.preferences { p -> p.copy(draft = "${item.id}|$it") } },
                    label = { Text("消耗量（${item.remaining!!.unit}）") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), isError = error != null)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            } else Text("将这件物品标记为已消耗。")
        } }, confirmButton = { TextButton(onClick = {
            if (action == "partial") {
                val validated = runCatching { validateAmount(amount, item.remaining!!) }
                if (validated.isFailure) { error = validated.exceptionOrNull()?.message; return@TextButton }
                model.command("consume_item_content", item, validated.getOrThrow()); amount = ""; model.preferences { it.copy(draft = "") }
            } else model.command("consume_items", item)
            action = null
        }, enabled = enabled) { Text("确认") } }, dismissButton = { TextButton(onClick = { action = null }) { Text("取消") } })
}

@Composable
private fun SettingsPane(state: TerminalState, prefs: TerminalPrefs, model: TerminalViewModel, activity: MainActivity, switch: () -> Unit, login: () -> Unit) {
    var maintenance by remember { mutableStateOf("正在检查…") }
    LaunchedEffect(prefs.enabled) { maintenance = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { TerminalMaintenance.apply(activity, prefs.enabled) } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        ListItem(headlineContent = { Text(state.session?.account?.name ?: "尚未登录") }, supportingContent = { Text(state.session?.household?.let { "${it.name} · ${it.timezone}" } ?: "使用现有松仓账号和家庭") }, trailingContent = {
            Row { if (state.session != null) { TextButton(onClick = switch) { Text("切换家庭") }; IconButton(onClick = { model.logout() }) { Icon(Icons.AutoMirrored.Outlined.Logout, "退出账号") } } else Button(onClick = login) { Text("登录") } }
        })
        HorizontalDivider()
        ListItem(headlineContent = { Text("终端模式") }, supportingContent = { Text("60 秒无操作后待机；插电约 5 分钟同步") }, trailingContent = { Switch(prefs.enabled, { next -> model.preferences { it.copy(enabled = next) } }) })
        ListItem(headlineContent = { Text("挥手唤醒") }, supportingContent = { Text("AOD 时短暂靠近并移开屏幕顶部；双击始终可用") }, trailingContent = { Switch(prefs.wave, { next -> model.preferences { it.copy(wave = next) } }, enabled = prefs.enabled) })
        ListItem(headlineContent = { Text("明暗主题") }, trailingContent = { Row { listOf("system" to "系统", "light" to "浅色", "dark" to "深色").forEach { (key, label) -> FilterChip(selected = prefs.theme == key, onClick = { model.preferences { it.copy(theme = key) } }, label = { Text(label) }, modifier = Modifier.padding(2.dp)) } } })
        ListItem(headlineContent = { Text("同步状态") }, supportingContent = { Text("${SyncScheduler.description(activity)}\n最后成功：${friendlyDate(state.snapshot?.synced_at, state.session?.household?.timezone)}") }, trailingContent = { TextButton(onClick = { model.refresh() }, enabled = state.session != null && !state.syncing) { Text("立即刷新") } })
        if (!activity.getSystemService(android.app.AlarmManager::class.java).canScheduleExactAlarms()) TextButton(onClick = { activity.startActivity(Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${activity.packageName}"))) }) { Text("允许精确同步闹钟") }
        ListItem(headlineContent = { Text("设备维护") }, supportingContent = { Text("$maintenance\nPixel 3 · Android ${android.os.Build.VERSION.RELEASE} · ${BuildConfig.VERSION_NAME}") })
    }
}
