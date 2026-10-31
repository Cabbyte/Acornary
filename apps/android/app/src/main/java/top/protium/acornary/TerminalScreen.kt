package top.protium.acornary

import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import android.view.WindowManager
import android.net.Uri
import android.os.SystemClock
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.Image
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.border
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
fun TerminalScreen(model: TerminalViewModel, activity: ComponentActivity) {
    val state by model.state.collectAsStateWithLifecycle()
    TerminalWorkspace(state,model,activity)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TerminalWorkspace(state:TerminalState,model:TerminalViewModel,activity:ComponentActivity) {
    val prefs by model.prefs.collectAsStateWithLifecycle()
    val page by model.page.collectAsStateWithLifecycle()
    val browse by model.browse.collectAsStateWithLifecycle()
    val interaction by model.lastInteraction.collectAsStateWithLifecycle()
    val printerState by model.printer.state.collectAsStateWithLifecycle()
    val batch by model.printJournal.state.collectAsStateWithLifecycle()
    BackHandler(enabled=batch?.visible==true) {model.printJournal.leave()}
    val inventoryScroll = rememberLazyListState()
    val detailScroll = remember(state.selected?.id) { androidx.compose.foundation.ScrollState(0) }
    var printerSettings by remember { mutableStateOf(false) }
    var filters by remember { mutableStateOf(false) }
    var scanning by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var inputAwake by remember { mutableStateOf(false) }
    var submissionAwake by remember { mutableStateOf(false) }
    val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val inputActive = editing || WindowInsets.isImeVisible
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(inputActive, interaction) {
        inputAwake = inputActive
        if (inputActive) { delay((300_000 - (SystemClock.elapsedRealtime() - interaction)).coerceAtLeast(0)); inputAwake = false }
    }
    LaunchedEffect(state.busy) { submissionAwake = state.busy; if (state.busy) { delay(30_000); submissionAwake = false } }
    val keep = lifecycle.isAtLeast(Lifecycle.State.RESUMED) && (submissionAwake || scanning || inputAwake || (printerState.busy && !printerState.automaticConnection) || printerState.scanning || batch?.busy == true || batch?.preparing == true)
    DisposableEffect(keep) {
        if(keep) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }
    LaunchedEffect(state.message) { state.message?.let { snackbar.showSnackbar(it); model.repo.message(null) } }
    LaunchedEffect(browse.filter, browse.days, browse.query, browse.location, browse.opening) { inventoryScroll.scrollToItem(0) }
    fun navigate(index: Int) { model.printJournal.leave { model.page.value = index; if (index == 2) model.settingsPage.value = "root" } }
    fun login(switch: Boolean = false) { scope.launch {
        try { if (switch) model.repo.logout(); model.repo.auth.begin(activity, switch) }
        catch (_: Exception) { model.repo.message("无法打开登录页面，请检查网络及浏览器。") }
    } }
    fun printItem(item: StockItem) { model.printJournal.open(listOf(item), LabelSize.from(prefs.labelSize), prefs.printDensity, forceSingle = true) }
    val visible = remember(state.snapshot, state.session, browse) { visibleInventory(state, browse) }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Row(Modifier.fillMaxSize().padding(padding).safeDrawingPadding().imePadding()) {
            Surface(color = MaterialTheme.colorScheme.background) {
                Column(Modifier.width(56.dp).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Image(painterResource(R.drawable.ac_brand), "松仓", Modifier.padding(top=12.dp,bottom=8.dp).size(24.dp))
                    CompactNavigation("物品", AcGlyph.ITEMS, page == 0 && batch?.visible != true) { navigate(0) }
                    CompactNavigation("扫码", AcGlyph.SCAN, page == 1 && batch?.visible != true) { navigate(1) }
                    Spacer(Modifier.weight(1f))
                    CompactNavigation("设置", AcGlyph.SETTINGS, page == 2 && batch?.visible != true) { navigate(2) }
                }
            }
            VerticalDivider()
            Column(Modifier.weight(1f).fillMaxHeight().background(MaterialTheme.colorScheme.surface).padding(horizontal=8.dp)) {
                val review = batch
                if (review?.visible == true) {
                    BatchPrintPane(review, model) { printerSettings = true }
                } else {
                    if (page != 2) BrowseToolbar(page, state, browse, model, { filters = true }, {
                        model.printJournal.open(visible, LabelSize.from(prefs.labelSize), prefs.printDensity)
                    })
                    if (state.authExpired) StatusLine("授权已失效") { TextButton(onClick = { login() }) { Text("重新登录") } }
                    else if (state.session != null && !state.online) StatusLine("离线，显示上次缓存")
                    else if (state.session != null && SyncScheduler.isStale(activity, state.snapshot?.synced_at)) StatusLine("库存数据待更新") {
                        TextButton(onClick = { model.refresh() }, enabled = !state.syncing) { Text("刷新") }
                    }
                    if (state.pending.isNotEmpty()) FlowRow(Modifier.fillMaxWidth(), verticalArrangement=Arrangement.Center) {
                        Text("上一笔操作结果待确认", color=MaterialTheme.colorScheme.error,modifier=Modifier.padding(vertical=12.dp))
                        TextButton(onClick = { model.resolve(state.pending.first(), false) }, enabled = !state.busy) { Text("核对结果") }
                        TextButton(onClick = { model.resolve(state.pending.first(), true) }, enabled = !state.busy) { Text("原请求重试") }
                    }
                    if (review?.id != null && review.pages.any { it.status == "PENDING" || it.status == "UNCERTAIN" }) StatusLine("上次打印批次尚未完成") {
                        TextButton(onClick = model.printJournal::show) { Text("查看") }
                    }
                    when {
                        state.loading -> Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center) { CircularProgressIndicator() }
                        page == 2 -> SettingsPane(state,prefs,model,activity,{ login(true) },{ login() },{ printerSettings = true })
                        state.session == null -> Column(Modifier.fillMaxSize(),verticalArrangement=Arrangement.Center,horizontalAlignment=Alignment.CenterHorizontally) {
                            Text("登录松仓，查看家庭库存",style=MaterialTheme.typography.titleLarge)
                            Button(onClick = { login() },shape=MaterialTheme.shapes.small,modifier=Modifier.padding(16.dp).heightIn(min=48.dp)) { Text("登录") }
                        }
                        else -> BoxWithConstraints(Modifier.weight(1f).padding(bottom=8.dp)) {
                            val left = (maxWidth * .4f).coerceIn(224.dp,320.dp).coerceAtMost(maxWidth - 297.dp)
                            Row(Modifier.fillMaxSize(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                                Box(Modifier.width(left).fillMaxHeight()) {
                                    if (page == 1) CameraPane({ model.select(it) }, { scanning = it })
                                    else InventoryList(visible,state,browse,model,inventoryScroll)
                                }
                                VerticalDivider()
                                Box(Modifier.weight(1f).fillMaxHeight()) { DetailPane(state,model,::printItem,detailScroll) { editing = it } }
                            }
                        }
                    }
                }
            }
        }
    }
    if (filters) InventoryFilters(state,browse,{ model.browse.value = it },{ filters = false })
    if (printerSettings) PrinterPane(model) { printerSettings = false }
}

@Composable
private fun CompactNavigation(label: String,glyph: AcGlyph,active: Boolean,onClick:()->Unit) {
    Surface(color=if(active) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.background,
        shape=MaterialTheme.shapes.small,modifier=Modifier.width(56.dp).heightIn(min=56.dp).semantics { selected=active }.clickable(role=Role.Tab,onClick=onClick)) {
        Column(Modifier.padding(vertical=6.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(2.dp)) {
            AcIcon(glyph);Text(label,style=MaterialTheme.typography.labelSmall)
        }
    }
}
@Composable internal fun StatusLine(text:String,content:@Composable RowScope.()->Unit = {}) {
    Row(Modifier.fillMaxWidth().heightIn(min=32.dp),verticalAlignment=Alignment.CenterVertically) {
        Text(text,Modifier.weight(1f),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
        content()
    }
}
@Composable
private fun BrowseToolbar(page:Int,state:TerminalState,browse:BrowseState,model:TerminalViewModel,filters:()->Unit,batch:()->Unit) {
    var more by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = remember { FocusRequester() }
    Row(Modifier.fillMaxWidth().heightIn(min=48.dp),verticalAlignment=Alignment.CenterVertically) {
        if (page == 0 && state.session != null) {
            if (browse.searching) {
                IconButton(onClick={ model.browse.value=browse.copy(query="",searching=false);keyboard?.hide() }) { AcIcon(AcGlyph.BACK,"退出搜索") }
                BasicTextField(value=browse.query,onValueChange={ model.browse.value=browse.copy(query=it);model.interact() },singleLine=true,
                    textStyle=MaterialTheme.typography.bodyMedium.copy(color=MaterialTheme.colorScheme.onSurface),
                    keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),keyboardActions=KeyboardActions(onSearch={keyboard?.hide()}),
                    modifier=Modifier.weight(1f).heightIn(min=48.dp).focusRequester(focus).testTag("inventory-search"),
                    decorationBox={ inner -> Box(Modifier.fillMaxWidth().padding(vertical=12.dp),contentAlignment=Alignment.CenterStart) { if(browse.query.isEmpty()) Text("搜索名称、品牌、规格",color=MaterialTheme.colorScheme.onSurfaceVariant);inner() } })
                IconButton(onClick={model.browse.value=browse.copy(query="")}) {AcIcon(AcGlyph.CLOSE,"清除搜索")}
                LaunchedEffect(Unit) {focus.requestFocus()}
            } else {
                InventoryFilter.entries.forEach { option ->
                    TextButton(onClick={model.browse.value=browse.copy(filter=option)},shape=MaterialTheme.shapes.small,
                        colors=ButtonDefaults.textButtonColors(contentColor=if(browse.filter==option) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)) {
                        Text(option.title,style=if(browse.filter==option) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium)
                    }
                }
                Spacer(Modifier.weight(1f))
                IconButton(onClick={model.browse.value=browse.copy(searching=true)}) {AcIcon(AcGlyph.SEARCH,"搜索物品")}
            }
            IconButton(onClick=filters) {AcIcon(AcGlyph.FILTER,"筛选物品")}
            IconButton(onClick=batch,enabled=state.snapshot!=null && !state.busy && visibleInventory(state,browse).any {it.canConsume}) {AcIcon(AcGlyph.SELECT,"批量打印当前结果")}
        } else { Text(if(page==1) "扫码" else "松仓",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge) }
        Box {
            IconButton(onClick={more=true}) { AcIcon(AcGlyph.MORE,"更多选项") }
            DropdownMenu(expanded=more,onDismissRequest={more=false}) {
                DropdownMenuItem(text={Text("刷新库存")},enabled=state.session!=null&&!state.syncing,onClick={more=false;model.refresh()})
                DropdownMenuItem(text={Text("设备状态")},onClick={more=false;model.settingsPage.value="device";model.page.value=2})
            }
        }
    }
    if(state.syncing) LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp))
}

@Composable
private fun InventoryList(items:List<StockItem>,state:TerminalState,browse:BrowseState,model:TerminalViewModel,scroll:androidx.compose.foundation.lazy.LazyListState) {
    val timezone=state.session!!.household.timezone
    Column(Modifier.fillMaxSize()) {
        val qualifier=when(browse.filter) {InventoryFilter.RECENT->"${if(browse.days==1) "今天" else "近 ${browse.days} 天"} · ${items.size} 件";InventoryFilter.URGENT->"未来 7 天及已过提醒日 · ${items.size} 件";else->"${items.size} 件"}
        Text(qualifier,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(vertical=4.dp))
        if(items.isEmpty()) {
            val missing=browse.filter==InventoryFilter.RECENT && state.snapshot?.items?.any {it.canConsume && it.label_updated_at==null}==true
            Column(Modifier.fillMaxWidth().padding(top=16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text(if(missing) "同步后可查看最近变化" else "没有符合条件的物品",style=MaterialTheme.typography.bodyMedium)
                TextButton(onClick={model.browse.value=BrowseState(filter=InventoryFilter.ALL)}) {Text("查看全部")}
            }
        }
        LazyColumn(state=scroll,modifier=Modifier.weight(1f).testTag("inventory-list")) {
            items(items,key={it.id}) { item ->
                val selected=state.selected?.id==item.id
                Surface(color=if(selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,shape=MaterialTheme.shapes.small,
                    modifier=Modifier.fillMaxWidth().clickable { if(item.is_container) model.browse.value=browse.copy(location=item.id);model.select(item.id) }.semantics { this.selected=selected }) {
                    Row(Modifier.heightIn(min=60.dp).padding(horizontal=8.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                            Text(item.name,style=MaterialTheme.typography.titleSmall,maxLines=2,overflow=TextOverflow.Ellipsis)
                            Text(if(item.is_container) "查看位置" else "${item.quantity()} · ${item.location.substringAfterLast(" / ")}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis)
                        }
                        Text(when(browse.filter) {InventoryFilter.RECENT->recentLabel(item,timezone);InventoryFilter.URGENT->item.reminder.date?.removePrefix("${java.time.LocalDate.now().year}-") ?: "未记录";else->lifecycleLabel(item)},
                            style=MaterialTheme.typography.bodySmall,color=if(browse.filter==InventoryFilter.URGENT) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier=Modifier.widthIn(max=76.dp),maxLines=2,overflow=TextOverflow.Ellipsis)
                    }
                }
                HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}
