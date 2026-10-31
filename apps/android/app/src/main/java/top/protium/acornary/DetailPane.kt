package top.protium.acornary

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch

@Composable
internal fun DetailPane(state:TerminalState,model:TerminalViewModel,onPrint:((StockItem)->Unit)?=null,
    scroll:ScrollState?=null,editing:(Boolean)->Unit) {
    val item=state.selected
    var consuming by remember(item?.id) {mutableStateOf(false)}
    var notes by rememberSaveable(item?.id) {mutableStateOf(false)}
    var history by rememberSaveable(item?.id) {mutableStateOf(false)}
    var loading by remember(item?.id) {mutableStateOf(false)}
    val scope=rememberCoroutineScope()
    DisposableEffect(consuming) {editing(consuming);onDispose {editing(false)}}
    if(item==null) {Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center) {Text("选择或扫描一个物品",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};return}
    val timezone=state.session?.household?.timezone
    val enabled=state.online&&!state.busy&&state.pending.isEmpty()&&!state.selectedOffline
    val scrolling=scroll?:rememberScrollState()
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(scrolling),verticalArrangement=Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically) {
                Text(item.name,Modifier.weight(1f),style=MaterialTheme.typography.titleLarge,maxLines=2,overflow=TextOverflow.Ellipsis)
                if(onPrint!=null && item.canConsume) IconButton(onClick={onPrint(item)},enabled=state.session!=null&&!state.busy) {AcIcon(AcGlyph.PRINT,"打印标签")}
            }
            if(item.brand.isNotBlank()||item.specification.isNotBlank()) Text("${item.brand} ${item.specification}".trim(),color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text(item.location,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${item.quantity()} · ${lifecycleLabel(item)}",style=MaterialTheme.typography.titleMedium)
            if(state.selectedOffline) Text("缓存详情 · 联网核对后可操作",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
            if(item.reminder.date!=null && item.reminder.date!=item.expiry_date) Text("提醒 ${item.reminder.date} · ${reminderBasis(item)}",style=MaterialTheme.typography.bodyMedium)
            Text("到期 ${item.expiry_date ?: "未记录"}",style=MaterialTheme.typography.bodyMedium)
            if(item.opened_at!=null) Text("${friendlyDate(item.opened_at,timezone)} 开封${item.after_opening_days?.let { " · 开封后 $it 天" } ?: ""}",style=MaterialTheme.typography.bodySmall)
            else item.after_opening_days?.let {Text("开封后保质期 $it 天",style=MaterialTheme.typography.bodySmall)}
            if(item.terminal) Text("此物品已结束，不能继续消耗或开封。",style=MaterialTheme.typography.bodySmall)
            if(item.is_container) Text("容器作为位置浏览，编辑请在电脑上完成。",style=MaterialTheme.typography.bodySmall)
            if(state.notes.isNotEmpty()) {
                HorizontalDivider()
                TextButton(onClick={notes=!notes},modifier=Modifier.fillMaxWidth()) {Text("笔记 · ${state.notes.size}",Modifier.weight(1f));AcIcon(AcGlyph.DOWN)}
                if(notes) state.notes.forEach {note->note.title?.let {Text(it,style=MaterialTheme.typography.titleSmall)};Text(note.body)}
            }
            HorizontalDivider()
            TextButton(onClick={history=!history;if(history&&!state.historyLoaded) scope.launch {loading=true;model.history().join();loading=false}},modifier=Modifier.fillMaxWidth()) {
                Text("操作历史",Modifier.weight(1f));AcIcon(AcGlyph.DOWN)
            }
            if(history) {
                if(loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                if(state.historyLoaded&&state.history.isEmpty()) Text("暂无操作历史",style=MaterialTheme.typography.bodySmall)
                state.history.forEach {event->
                    Text("${friendlyDate(event.occurred_at,timezone)} · ${historyLabel(event.event_type)}",style=MaterialTheme.typography.labelMedium)
                    event.changes.forEach {change->Text("${changeLabel(change.path)}：${change.before?:"—"} → ${change.after?:"—"}",style=MaterialTheme.typography.bodySmall)}
                }
                if(state.historyCursor!=null) TextButton(onClick={scope.launch {loading=true;model.history().join();loading=false}},enabled=state.online&&!loading) {Text("加载更多")}
            }
        }
        if(item.canConsume) {
            HorizontalDivider()
            Row(Modifier.fillMaxWidth().padding(top=4.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                if(item.canOpen) OutlinedButton(onClick={model.command("open_item",item)},enabled=enabled,shape=MaterialTheme.shapes.small,modifier=Modifier.heightIn(min=48.dp)) {Text("开封")}
                Button(onClick={consuming=true},enabled=enabled,shape=MaterialTheme.shapes.small,modifier=Modifier.weight(1f).heightIn(min=48.dp)) {Text("消耗")}
            }
        }
    }
    if(consuming) ConsumptionPanel(item,state,model,{consuming=false})
}

@Composable
private fun ConsumptionPanel(item:StockItem,state:TerminalState,model:TerminalViewModel,dismiss:()->Unit) {
    var amount by rememberSaveable(item.id) {mutableStateOf("")}
    var error by remember {mutableStateOf<String?>(null)}
    val prefs by model.prefs.collectAsStateWithLifecycle()
    LaunchedEffect(item.id) {val prefix="${item.id}|";if(prefs.draft.startsWith(prefix)) amount=prefs.draft.removePrefix(prefix)}
    val enabled=state.online&&!state.busy&&state.pending.isEmpty()&&!state.selectedOffline
    val remaining=item.remaining
    @Composable fun PartialSubmit(modifier:Modifier) {
        Button(onClick={
            val parsed=runCatching {validateAmount(amount,remaining!!)}
            if(parsed.isFailure) error=parsed.exceptionOrNull()?.message
            else {model.command("consume_item_content",item,parsed.getOrThrow());model.preferences {it.copy(draft="")};dismiss()}
        },enabled=enabled&&amount.isNotBlank(),shape=MaterialTheme.shapes.small,
            contentPadding=PaddingValues(horizontal=8.dp),modifier=modifier.heightIn(min=48.dp)) {Text("扣减该数量",maxLines=1)}
    }
    @Composable fun WholeSubmit(modifier:Modifier) {
        OutlinedButton(onClick={model.command("consume_items",item);dismiss()},enabled=enabled,shape=MaterialTheme.shapes.small,
            contentPadding=PaddingValues(horizontal=8.dp),modifier=modifier.heightIn(min=48.dp)) {Text("整件用完",maxLines=1)}
    }
    val partial=remaining!=null&&java.math.BigDecimal(remaining.value).signum()>0
    androidx.compose.ui.window.Dialog(onDismissRequest=dismiss,
        properties=androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false)) {
        BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding().imePadding(),contentAlignment=Alignment.Center) {
            val compact=maxHeight<132.dp
            Surface(Modifier.widthIn(max=740.dp).fillMaxWidth(.96f),shape=MaterialTheme.shapes.medium) {
                Row(Modifier.padding(8.dp),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).heightIn(max=if(compact)72.dp else 104.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                        Row(verticalAlignment=Alignment.CenterVertically) {
                            Text(item.name,Modifier.weight(1f),style=MaterialTheme.typography.titleSmall,maxLines=1,overflow=TextOverflow.Ellipsis)
                            IconButton(onClick=dismiss) {AcIcon(AcGlyph.CLOSE,"关闭消耗物品")}
                        }
                        if(compact) Text("${item.quantity()} · ${item.location.substringAfterLast(" / ")}",style=MaterialTheme.typography.bodySmall,maxLines=1,overflow=TextOverflow.Ellipsis)
                        else {
                            Text(item.location,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis)
                            Text("剩余 ${item.quantity()}",style=MaterialTheme.typography.bodySmall,maxLines=1,overflow=TextOverflow.Ellipsis)
                        }
                    }
                    Column(Modifier.weight(1f).heightIn(max=if(compact)72.dp else 104.dp).verticalScroll(rememberScrollState())) {
                        if(partial) {
                            OutlinedTextField(amount,{amount=it;error=null;model.interact();model.preferences {p->p.copy(draft="${item.id}|$it")}},
                                label={Text("消耗量（${remaining!!.unit}）",maxLines=1)},singleLine=true,
                                keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal),isError=error!=null,modifier=Modifier.fillMaxWidth())
                            error?.let {Text(it,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)}
                        } else Text("余量未知或为零，可确认整件用完。",style=MaterialTheme.typography.bodySmall)
                    }
                    if(compact) Row(Modifier.width(if(partial)260.dp else 140.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        if(partial) PartialSubmit(Modifier.weight(1f))
                        WholeSubmit(Modifier.weight(1f))
                    } else Column(Modifier.width(140.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                        if(partial) PartialSubmit(Modifier.fillMaxWidth())
                        WholeSubmit(Modifier.fillMaxWidth())
                    }
                }
            }
        }
    }
}
