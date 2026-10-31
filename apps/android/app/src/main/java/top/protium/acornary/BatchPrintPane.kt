package top.protium.acornary

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun ColumnScope.BatchPrintPane(review:BatchReview,model:TerminalViewModel,
    journal:PrintJournal=model.printJournal,inventoryOverride:TerminalState?=null,printerSettings:()->Unit) {
    val printer by model.printer.state.collectAsStateWithLifecycle()
    val inventory=inventoryOverride?:model.state.collectAsStateWithLifecycle().value
    var previewId by remember(review.id) {mutableStateOf<String?>(null)}
    val active=if(review.busy) review.pages.find {it.status=="SENDING"}?:review.pages.firstOrNull {it.status=="PENDING"}
        else review.pages.find {it.item.id==previewId}?:review.pages.firstOrNull {it.item.id in review.selected}?:review.pages.firstOrNull()
    val completed=review.pages.count {it.status=="DONE"||it.status=="CONFIRMED"}
    val uncertain=review.pages.any {it.status=="UNCERTAIN"}
    Row(Modifier.fillMaxWidth().heightIn(min=48.dp),verticalAlignment=Alignment.CenterVertically) {
        IconButton(onClick={journal.leave()}) {AcIcon(AcGlyph.BACK,if(review.busy) "停止后续并返回" else "取消批量打印")}
        Text(if(review.busy) "打印 $completed / ${review.pages.size}" else "已选 ${review.selected.size} 件",Modifier.weight(1f),style=MaterialTheme.typography.titleMedium)
        if(!review.busy) TextButton(onClick=journal::selectAll,enabled=!review.preparing) {Text("全选当前结果")}
    }
    if(review.preparing) LinearProgressIndicator(Modifier.fillMaxWidth())
    BoxWithConstraints(Modifier.weight(1f).padding(bottom=8.dp)) {
        val left=(maxWidth*.4f).coerceIn(224.dp,320.dp).coerceAtMost(maxWidth-297.dp)
        Row(Modifier.fillMaxSize(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            LazyColumn(Modifier.width(left).fillMaxHeight()) {
                items(review.pages,key={it.item.id}) {page->
                    Surface(color=if(active?.item?.id==page.item.id) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,shape=MaterialTheme.shapes.small,
                        modifier=Modifier.fillMaxWidth().clickable(enabled=!review.busy) {previewId=page.item.id}) {
                        Row(Modifier.heightIn(min=60.dp).padding(end=8.dp),verticalAlignment=Alignment.CenterVertically) {
                            Checkbox(checked=page.item.id in review.selected,onCheckedChange={journal.toggle(page.item.id)},enabled=!review.busy&&!review.preparing&&page.item.canConsume&&page.status!="UNCERTAIN")
                            Column(Modifier.weight(1f).padding(vertical=6.dp)) {
                                Text(page.item.name,style=MaterialTheme.typography.titleSmall,maxLines=2,overflow=TextOverflow.Ellipsis)
                                Text(when(page.status){"SENDING"->"正在打印";"DONE"->"打印机已确认";"CONFIRMED"->"已核对出纸";"UNCERTAIN"->"出纸结果待核对";else->if(!page.item.canConsume) "已结束，不可打印" else if(page.alreadyPrinted) "本机已有成功记录" else "本机未记录"},
                                    style=MaterialTheme.typography.bodySmall,color=if(page.status=="UNCERTAIN") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    HorizontalDivider()
                }
            }
            VerticalDivider()
            Column(Modifier.weight(1f).fillMaxHeight(),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    Text("${review.size.title} · 浓度 ${review.density} · 每件一张",style=MaterialTheme.typography.labelMedium)
                    active?.let {page->
                        Text(page.item.name,style=MaterialTheme.typography.titleMedium,maxLines=2,overflow=TextOverflow.Ellipsis)
                        Text(page.item.location,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        val bitmap=remember(page.fingerprint,review.size) {runCatching {LabelRenderer.render(LabelContent.item(page.item),review.size)}}
                        bitmap.getOrNull()?.let {LabelPreview(it)}
                        bitmap.exceptionOrNull()?.let {Text(it.message?:"无法生成标签",color=MaterialTheme.colorScheme.error)}
                    }
                    if(review.busy) {
                        LinearProgressIndicator(progress={((completed+printer.progress/100f)/review.pages.size.coerceAtLeast(1)).coerceIn(0f,1f)},modifier=Modifier.fillMaxWidth())
                        Text(if(printer.stopping) "当前一张完成后停止后续打印" else "请保持此页面，打印完成后恢复待机。",style=MaterialTheme.typography.bodySmall)
                    }
                    review.message?.let {Text(it,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.primary)}
                    val pending=review.pages.firstOrNull {it.status=="UNCERTAIN"}
                    if(pending!=null) {
                        Text("请先核对 ${pending.item.name} 是否已经出纸。",color=MaterialTheme.colorScheme.error)
                        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick={journal.acknowledge(pending.item.id,true)},shape=MaterialTheme.shapes.small) {Text("已出纸")}
                            OutlinedButton(onClick={journal.acknowledge(pending.item.id,false)},shape=MaterialTheme.shapes.small) {Text("未出纸，需补打")}
                        }
                    } else if(printer.uncertain&&!review.busy) {
                        Text(printer.message,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
                        OutlinedButton(onClick=model.printer::acknowledge,shape=MaterialTheme.shapes.small) {Text("已核对纸张")}
                    }
                    if(!inventory.online) Text("当前离线，联网核对资料后才能打印。",color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
                    if(!printer.connected&&!review.busy) TextButton(onClick=printerSettings) {Text("连接打印机")}
                    else if(!review.busy) TextButton(onClick=printerSettings) {Text("打印机设置")}
                    if(review.pages.isNotEmpty()&&review.selected.isEmpty()&&review.id==null) Text("请选择需要打印的标签。已在本机打印过的也可勾选补打。",style=MaterialTheme.typography.bodySmall)
                }
                if(review.busy) OutlinedButton(onClick=model.printer::requestStop,enabled=!printer.stopping,shape=MaterialTheme.shapes.small,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {Text(if(printer.stopping) "正在停止后续…" else "停止后续打印")}
                else if(review.id!=null&&completed==review.pages.size&&review.selected.isEmpty()) Button(onClick={journal.leave()},shape=MaterialTheme.shapes.small,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {Text("完成")}
                else Button(onClick=journal::start,enabled=review.selected.isNotEmpty()&&!review.preparing&&printer.connected&&!printer.busy&&!printer.uncertain&&!uncertain&&inventory.online&&inventory.pending.isEmpty()&&!inventory.busy,
                    shape=MaterialTheme.shapes.small,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {Text(if(review.id==null) "开始打印 ${review.selected.size} 张" else "打印选中的 ${review.selected.size} 张")}
            }
        }
    }
}
