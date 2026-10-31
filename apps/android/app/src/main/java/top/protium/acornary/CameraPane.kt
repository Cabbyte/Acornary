package top.protium.acornary

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import kotlinx.coroutines.delay
import java.util.Locale

@Composable
@OptIn(ExperimentalLayoutApi::class)
fun CameraPane(onItem: (String) -> Unit, onActive: (Boolean) -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val lifecycleState by lifecycle.lifecycle.currentStateAsState()
    var allowed by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed = it }
    var result by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var automaticZoom by remember { mutableStateOf(true) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var maxZoom by remember { mutableFloatStateOf(1f) }
    var session by remember { mutableStateOf<FrontScanner?>(null) }
    val currentAuto by rememberUpdatedState(automaticZoom)
    val currentItem by rememberUpdatedState(onItem)
    val currentActive by rememberUpdatedState(onActive)
    LaunchedEffect(lifecycleState) {
        allowed = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }
    val active = allowed && lifecycleState.isAtLeast(Lifecycle.State.RESUMED) && result == null && error == null
    DisposableEffect(active) { currentActive(active); onDispose { currentActive(false) } }
    LaunchedEffect(active, attempt) { if (active) { delay(120_000); result = "扫描已暂停，点击继续后再次开启相机。" } }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (!allowed) {
            Text("前置摄像头扫码", style = MaterialTheme.typography.titleMedium)
            Text("相机只在此页面开启，不保存或上传图像。")
            Button(onClick = { permission.launch(Manifest.permission.CAMERA) }) { Text("允许使用相机") }
            TextButton(onClick = { context.startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) }) { Text("打开权限设置") }
        } else {
            if (active) {
                val preview = remember { PreviewView(context).apply {
                    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                    scaleType = PreviewView.ScaleType.FIT_CENTER
                } }
                DisposableEffect(lifecycle, preview, attempt) {
                    val capture = FrontScanner(context, lifecycle, preview, { currentAuto },
                        { ratio, maximum -> zoom = ratio; maxZoom = maximum },
                        { raw ->
                            val id = ItemLink.parse(raw)
                            result = when {
                                id != null -> "已识别物品，详情显示在右侧。"
                                raw.startsWith("acornary:print-test:") -> "打印测试二维码已识别，前摄可以正常扫码。"
                                else -> "不是有效的松仓物品二维码。"
                            }
                            if (id != null) currentItem(id)
                        }, { error = it })
                    session = capture; capture.start()
                    onDispose { session = null; capture.close() }
                }
                Card(Modifier.weight(1f).fillMaxWidth()) {
                    AndroidView({ preview }, Modifier.fillMaxSize().pointerInput(Unit) {
                        detectTapGestures { point -> session?.focus(point.x, point.y) }
                    })
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = automaticZoom, onClick = { automaticZoom = true; session?.zoom(1f) }, label = { Text("自动放大") })
                    listOf(1f, 2f, 3f).filter { it <= maxZoom }.forEach { ratio ->
                        FilterChip(selected = !automaticZoom && kotlin.math.abs(zoom - ratio) < 0.1f,
                            onClick = { automaticZoom = false; session?.zoom(ratio) }, label = { Text("${ratio.toInt()}×") })
                    }
                }
                Text("${String.format(Locale.ROOT, "%.1f", zoom)}× · 点按画面对焦；标签保持约 10–20 cm，模糊时稍微远离。", style = MaterialTheme.typography.bodySmall)
            } else {
                Text(error ?: result ?: "相机已暂停", style = MaterialTheme.typography.bodyLarge)
                Button(onClick = { error = null; result = null; attempt++ }) { Text("继续扫描") }
            }
        }
    }
}
