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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
private fun PrintWindow(title: String, busy: Boolean, dismiss: () -> Unit, content: @Composable () -> Unit) {
    Dialog(onDismissRequest = { if (!busy) dismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = !busy, dismissOnClickOutside = !busy)) {
        Surface(Modifier.fillMaxWidth(0.96f).fillMaxHeight(0.94f), shape = MaterialTheme.shapes.extraLarge) {
            Column(Modifier.padding(16.dp)) {
                Row {
                    Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                    IconButton(onClick = dismiss, enabled = !busy) { Icon(Icons.Outlined.Close, "关闭打印窗口") }
                }
                content()
            }
        }
    }
}

@Composable
private fun Preview(bitmap: Bitmap) {
    Image(bitmap.asImageBitmap(), "标签预览，与实际打印使用同一张位图", Modifier.fillMaxWidth().aspectRatio(bitmap.width.toFloat() / bitmap.height).background(Color.White), filterQuality = FilterQuality.None)
}

@Composable
private fun PrinterFeedback(state: PrinterState, printer: PrinterController) {
    Text(state.message, color = if (state.uncertain) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
    if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
    if (state.printing) Text("已发送 ${state.progress}% · 正在等待打印机确认", style = MaterialTheme.typography.labelMedium)
    if (state.uncertain) {
        Text("请检查是否已经出纸。确认后可手动补打，应用不会恢复旧任务。", style = MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick = printer::acknowledge, enabled = !state.busy) { Text("已核对纸张") }
    }
}

@Composable
fun PrinterPane(model: TerminalViewModel, dismiss: () -> Unit) {
    val context = LocalContext.current
    val printer = model.printer
    val state by printer.state.collectAsStateWithLifecycle()
    val prefs by model.prefs.collectAsStateWithLifecycle()
    val size = LabelSize.from(prefs.labelSize)
    val bitmap = remember(size) { LabelRenderer.render(LabelContent.test(size), size) }
    val permissions = arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    fun permitted() = permissions.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
    var denied by remember { mutableStateOf(false) }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        denied = !permitted()
        if (!denied) printer.scan() else printer.message("连接打印机需要附近设备权限。")
    }
    DisposableEffect(Unit) { onDispose { printer.stopScan() } }
    PrintWindow("打印机与标签", state.busy, dismiss) {
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(state.deviceName ?: "NIIMBOT D101", style = MaterialTheme.typography.titleMedium)
                state.battery?.let { Text("打印机电量 $it%", style = MaterialTheme.typography.bodySmall) }
                PrinterFeedback(state, printer)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { if (permitted()) printer.scan() else request.launch(permissions) }, enabled = !state.busy && !state.scanning) { Text("搜索 D101") }
                    if (state.connected) OutlinedButton(onClick = printer::disconnect, enabled = !state.busy) { Text("断开") }
                }
                if (state.scanning) { LinearProgressIndicator(Modifier.fillMaxWidth()); TextButton(onClick = printer::stopScan) { Text("停止搜索") } }
                state.devices.forEach { device ->
                    OutlinedButton(onClick = { printer.connect(device) }, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) { Text("连接 ${device.name} · ${device.address.takeLast(5)}") }
                }
                if (denied) TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) }) { Text("打开权限设置") }
                TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) }, enabled = !state.busy) { Text("系统蓝牙设置") }
                Text("离开应用或进入待机后断开连接；再次打印时手动连接。", style = MaterialTheme.typography.bodySmall)
            }
            VerticalDivider()
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
              Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("标签纸尺寸", style = MaterialTheme.typography.titleMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { LabelSize.entries.forEach { option ->
                    FilterChip(selected = option == size, onClick = { model.preferences { it.copy(labelSize = option.key) } }, label = { Text(option.title) }, enabled = !state.busy)
                } }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("浓度", modifier = Modifier.padding(top = 14.dp))
                    (1..3).forEach { value -> FilterChip(selected = prefs.printDensity == value, onClick = { model.preferences { it.copy(printDensity = value) } }, label = { Text(value.toString()) }, enabled = !state.busy) }
                }
                Preview(bitmap)
                Text("测试标签不对应库存，请勿贴到实际物品上。请确认纸卷尺寸与上方一致。", style = MaterialTheme.typography.bodySmall)
              }
                Button(onClick = { printer.print(bitmap, prefs.printDensity) }, enabled = state.connected && !state.busy && !state.uncertain, modifier = Modifier.fillMaxWidth()) { Text("打印测试标签（1 张）") }
            }
        }
    }
}

@Composable
fun PrintLabelDialog(original: StockItem, scope: String, model: TerminalViewModel, dismiss: () -> Unit, settings: () -> Unit) {
    var item by remember(original.id, scope) { mutableStateOf(original) }
    var printed by remember { mutableStateOf(false) }
    val prefs by model.prefs.collectAsStateWithLifecycle()
    val printer = model.printer
    val state by printer.state.collectAsStateWithLifecycle()
    val inventory by model.state.collectAsStateWithLifecycle()
    val size = LabelSize.from(prefs.labelSize)
    val rendered = remember(item, size) { runCatching { LabelRenderer.render(LabelContent.item(item), size) } }
    PrintWindow("打印物品标签", state.busy, dismiss) {
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            Column(Modifier.weight(1.15f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(item.name, style = MaterialTheme.typography.titleMedium)
                Text(item.location, style = MaterialTheme.typography.bodyMedium)
                rendered.getOrNull()?.let { Preview(it) }
                rendered.exceptionOrNull()?.let { Text(it.message ?: "无法生成标签。", color = MaterialTheme.colorScheme.error) }
                Text("${size.title} · 浓度 ${prefs.printDensity} · 1 张", style = MaterialTheme.typography.labelLarge)
                Text("打印前会联网核对最新资料。标签二维码仅标识这件物品，不包含登录凭据。", style = MaterialTheme.typography.bodySmall)
            }
            VerticalDivider()
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(state.deviceName ?: "尚未连接打印机", style = MaterialTheme.typography.titleMedium)
                PrinterFeedback(state, printer)
                Button(onClick = {
                    val preview = item
                    printer.print(rendered.getOrThrow(), prefs.printDensity, completed = { printed = true }) {
                        val fresh = model.repo.itemForLabel(preview.id, scope)
                        if (fresh.revision != preview.revision || LabelContent.item(fresh) != LabelContent.item(preview)) { item = fresh; false } else true
                    }
                }, enabled = !printed && rendered.isSuccess && state.connected && !state.busy && !state.uncertain && inventory.online && inventory.session?.scope == scope && !inventory.busy && inventory.pending.isEmpty(), modifier = Modifier.fillMaxWidth()) { Text(if (printed) "已打印 1 张" else "打印 1 张") }
                OutlinedButton(onClick = settings, enabled = !state.busy) { Text("打印机与纸张设置") }
                if (!inventory.online) Text("当前离线，联网核对资料后才能打印。", color = MaterialTheme.colorScheme.error)
                Text("完成后如需再次打印，请重新打开预览确认。", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
