package top.protium.acornary

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable private fun PrintWindow(title:String,busy:Boolean,dismiss:()->Unit,content:@Composable ColumnScope.()->Unit) {
    Dialog(onDismissRequest={if(!busy)dismiss()},properties=DialogProperties(usePlatformDefaultWidth=false,dismissOnBackPress=!busy,dismissOnClickOutside=!busy)) {
        Surface(Modifier.fillMaxWidth(.96f).fillMaxHeight(.94f),shape=MaterialTheme.shapes.medium) {
            Column(Modifier.padding(12.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically) {
                    Text(title,Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
                    IconButton(onClick=dismiss,enabled=!busy) {AcIcon(AcGlyph.CLOSE,"关闭打印窗口")}
                }
                content()
            }
        }
    }
}
@Composable internal fun LabelPreview(bitmap:Bitmap) {
    Image(bitmap.asImageBitmap(),"标签预览，与实际打印使用同一张位图",Modifier.fillMaxWidth().height(112.dp).background(Color.White),contentScale=ContentScale.Fit,filterQuality=FilterQuality.None)
}
@Composable internal fun PrinterFeedback(state:PrinterState,printer:PrinterController) {
    Text(state.message,style=MaterialTheme.typography.bodySmall,color=if(state.uncertain) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
    if(state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    if(state.uncertain) {
        Text("请核对实际出纸情况，应用不会自动补打。",style=MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick=printer::acknowledge,enabled=!state.busy,shape=MaterialTheme.shapes.small) {Text("已核对纸张")}
    }
}
@OptIn(ExperimentalLayoutApi::class)
@Composable fun PrinterPane(model:TerminalViewModel,dismiss:()->Unit) {
    val context=LocalContext.current
    val printer=model.printer
    val state by printer.state.collectAsStateWithLifecycle()
    val prefs by model.prefs.collectAsStateWithLifecycle()
    val batch by model.printJournal.state.collectAsStateWithLifecycle()
    val locked=batch?.visible==true
    val size=if(locked) batch!!.size else LabelSize.from(prefs.labelSize)
    val density=if(locked) batch!!.density else prefs.printDensity
    val bitmap=remember(size) {LabelRenderer.render(LabelContent.test(size),size)}
    var denied by remember {mutableStateOf(false)}
    var changing by remember {mutableStateOf(false)}
    var advanced by remember {mutableStateOf(false)}
    var configure by remember {mutableStateOf(false)}
    var options by remember {mutableStateOf(false)}
    val permissions=arrayOf(Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT)
    fun permitted()=permissions.all {ContextCompat.checkSelfPermission(context,it)==PackageManager.PERMISSION_GRANTED}
    val request=rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {denied=!permitted();if(!denied)printer.scan() else printer.message("连接打印机需要附近设备权限。")}
    fun search() {changing=true;if(permitted())printer.scan()else request.launch(permissions)}
    DisposableEffect(Unit) {onDispose {printer.stopScan()}}
    PrintWindow("打印机",state.busy,dismiss) {
        Row(Modifier.weight(1f).fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(16.dp)) {
            Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("NIIMBOT D101",style=MaterialTheme.typography.titleMedium)
                        Text(if(state.connected) "已连接${state.battery?.let { " · 电量 $it%" }?:""}" else if(state.keepConnected&&state.deviceName!=null) "等待自动重连" else "尚未连接",style=MaterialTheme.typography.bodySmall)
                    }
                    Box {
                        IconButton(onClick={options=true},enabled=!state.busy) {AcIcon(AcGlyph.MORE,"打印机选项")}
                        DropdownMenu(expanded=options,onDismissRequest={options=false}) {
                            DropdownMenuItem(text={Text("更换打印机")},onClick={options=false;search()})
                            DropdownMenuItem(text={Text(if(state.keepConnected) "断开并暂停重连" else "恢复自动连接")},onClick={options=false;if(state.keepConnected)printer.disconnect()else printer.setKeepConnected(true)})
                            DropdownMenuItem(text={Text("连接与系统设置")},onClick={options=false;advanced=!advanced})
                        }
                    }
                }
                PrinterFeedback(state,printer)
                if(!state.connected||changing) {
                    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        Button(onClick=::search,enabled=!state.busy&&!state.scanning,shape=MaterialTheme.shapes.small) {Text("搜索 D101")}
                        if(state.deviceName!=null&&!state.keepConnected) OutlinedButton(onClick={printer.setKeepConnected(true)},enabled=!state.busy,shape=MaterialTheme.shapes.small) {Text("恢复连接")}
                    }
                    if(state.scanning) TextButton(onClick=printer::stopScan) {Text("停止搜索")}
                    state.devices.forEach {device->
                        if(!state.connected||device.name!=state.deviceName) OutlinedButton(onClick={changing=false;printer.connect(device)},enabled=!state.busy,shape=MaterialTheme.shapes.small,modifier=Modifier.fillMaxWidth()) {Text(device.name)}
                    }
                }
                if(denied) TextButton(onClick={context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:${context.packageName}")))}) {Text("打开权限设置")}
                if(advanced) {
                    Row(verticalAlignment=Alignment.CenterVertically) {Text("待机保持连接",Modifier.weight(1f));Switch(state.keepConnected,printer::setKeepConnected,enabled=!state.busy)}
                    Text("打印机保持开机，断线后自动重连。",style=MaterialTheme.typography.bodySmall)
                    TextButton(onClick={context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))},enabled=!state.busy) {Text("系统蓝牙设置")}
                }
            }
            VerticalDivider()
            Column(Modifier.weight(1f).fillMaxHeight(),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    Text("${size.title} · 浓度 $density",style=MaterialTheme.typography.titleSmall)
                    LabelPreview(bitmap)
                    Text("样张标记为打印测试，不对应库存。",style=MaterialTheme.typography.bodySmall)
                    if(locked) Text("当前批次已固定纸张，返回物品页后可调整。",style=MaterialTheme.typography.bodySmall)
                    TextButton(onClick={configure=!configure},enabled=!state.busy&&!locked) {Text("纸张与浓度")}
                    if(configure) {
                        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {LabelSize.entries.forEach {option->FilterChip(option==size,{model.preferences {it.copy(labelSize=option.key)}},label={Text(option.title)},enabled=!state.busy&&!locked)}}
                        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {(1..3).forEach {density->FilterChip(prefs.printDensity==density,{model.preferences {it.copy(printDensity=density)}},label={Text("浓度 $density")},enabled=!state.busy&&!locked)}}
                    }
                }
                Button(onClick={printer.print(bitmap,density)},enabled=state.connected&&!state.busy&&!state.uncertain&&!locked,shape=MaterialTheme.shapes.small,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {Text("打印测试标签（1 张）")}
            }
        }
    }
}
