package top.protium.acornary

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun InventoryFilters(state:TerminalState,browse:BrowseState,change:(BrowseState)->Unit,dismiss:()->Unit) {
    var locations by remember {mutableStateOf(false)}
    AcPanel("筛选物品",dismiss) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            if(browse.filter==InventoryFilter.RECENT) {
                Text("最近范围",style=MaterialTheme.typography.titleSmall)
                FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {listOf(1,7,30).forEach {days->
                    FilterChip(selected=browse.days==days,onClick={change(browse.copy(days=days))},label={Text(if(days==1) "今天" else "$days 天")},modifier=Modifier.heightIn(min=48.dp))
                }}
            }
            Text("位置（含下级）",style=MaterialTheme.typography.titleSmall)
            Box {
                OutlinedButton(onClick={locations=true},shape=MaterialTheme.shapes.small,modifier=Modifier.heightIn(min=48.dp)) {Text(state.snapshot?.items?.find {it.id==browse.location}?.name?:"全部位置");AcIcon(AcGlyph.DOWN)}
                DropdownMenu(expanded=locations,onDismissRequest={locations=false}) {
                    DropdownMenuItem(text={Text("全部位置")},onClick={change(browse.copy(location=null));locations=false})
                    state.snapshot?.items?.filter {it.is_container}?.forEach {item->DropdownMenuItem(text={Text(item.name)},onClick={change(browse.copy(location=item.id));locations=false})}
                }
            }
            Text("开封状态",style=MaterialTheme.typography.titleSmall)
            FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {listOf("全部","已开封","未开封","未记录").forEachIndexed {index,text->
                FilterChip(selected=browse.opening==index,onClick={change(browse.copy(opening=index))},label={Text(text)},modifier=Modifier.heightIn(min=48.dp))
            }}
        }
        TextButton(onClick={change(browse.copy(days=7,location=null,opening=0))}) {Text("重置筛选")}
    }
}
