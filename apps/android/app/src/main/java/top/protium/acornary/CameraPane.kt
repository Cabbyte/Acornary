package top.protium.acornary

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
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
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.delay
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@Composable
@androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
fun CameraPane(onItem: (String) -> Unit, onActive: (Boolean) -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val lifecycleState by lifecycle.lifecycle.currentStateAsState()
    var allowed by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed = it }
    var result by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
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
                val preview = remember { PreviewView(context).apply { implementationMode = PreviewView.ImplementationMode.COMPATIBLE } }
                DisposableEffect(lifecycle, preview, attempt) {
                    val running = AtomicBoolean(true)
                    val recognized = AtomicBoolean(false)
                    val executor = Executors.newSingleThreadExecutor()
                    val scanner = BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build())
                    val future = ProcessCameraProvider.getInstance(context)
                    var provider: ProcessCameraProvider? = null
                    var analysis: ImageAnalysis? = null
                    var cameraPreview: Preview? = null
                    val main = ContextCompat.getMainExecutor(context)
                    future.addListener({
                        if (running.get()) runCatching {
                            provider = future.get()
                            cameraPreview = Preview.Builder().build().also { it.setSurfaceProvider(preview.surfaceProvider) }
                            analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build().also { stream ->
                                stream.setAnalyzer(executor) { frame ->
                                    val media = frame.image
                                    if (!running.get() || recognized.get() || media == null) frame.close()
                                    else scanner.process(InputImage.fromMediaImage(media, frame.imageInfo.rotationDegrees))
                                        .addOnSuccessListener(main) { codes ->
                                            if (running.get() && !recognized.get()) codes.firstOrNull()?.rawValue?.let { raw ->
                                                recognized.set(true)
                                                val id = ItemLink.parse(raw)
                                                result = if (id == null) "不是有效的松仓物品二维码。" else "已识别物品，详情显示在右侧。"
                                                if (id != null) currentItem(id)
                                            }
                                        }.addOnFailureListener(main) { if (running.get()) error = "识别暂时不可用，请重试。" }
                                        .addOnCompleteListener { frame.close() }
                                }
                            }
                            val camera = provider!!.bindToLifecycle(lifecycle, CameraSelector.DEFAULT_FRONT_CAMERA, cameraPreview, analysis)
                            camera.cameraInfo.cameraState.observe(lifecycle) { if (running.get() && it.error != null) error = "相机正被占用或暂时不可用，请关闭其他相机应用后重试。" }
                        }.onFailure { error = "无法打开前置相机，请检查权限后重试。" }
                    }, main)
                    onDispose {
                        running.set(false)
                        analysis?.clearAnalyzer()
                        listOfNotNull(cameraPreview, analysis).takeIf { it.isNotEmpty() }?.let { provider?.unbind(*it.toTypedArray()) }
                        scanner.close(); executor.shutdown()
                    }
                }
                Card(Modifier.weight(1f).fillMaxWidth()) { AndroidView({ preview }, Modifier.fillMaxSize()) }
                Text("把物品标签朝向前置摄像头", style = MaterialTheme.typography.bodyMedium)
            } else {
                Text(error ?: result ?: "相机已暂停", style = MaterialTheme.typography.bodyLarge)
                Button(onClick = { error = null; result = null; attempt++ }) { Text("继续扫描") }
            }
        }
    }
}
