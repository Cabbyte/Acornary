package top.protium.acornary

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.os.SystemClock
import android.util.Log
import android.util.Size
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.*
import androidx.camera.core.resolutionselector.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import com.google.mlkit.vision.barcode.*
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** One camera session, no saved frames. All control/state callbacks run on the main executor. */
@androidx.annotation.OptIn(ExperimentalGetImage::class, ExperimentalCamera2Interop::class)
class FrontScanner(
    private val context: Context, private val owner: LifecycleOwner, private val preview: PreviewView,
    private val automaticZoom: () -> Boolean, private val zoomChanged: (Float, Float) -> Unit,
    private val result: (String) -> Unit, private val error: (String) -> Unit,
) {
    private val running = AtomicBoolean(true)
    private val recognized = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor()
    private val main = ContextCompat.getMainExecutor(context)
    private var provider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    private var analysis: ImageAnalysis? = null
    private var cameraPreview: Preview? = null
    private var scanner: BarcodeScanner? = null
    private var lastZoom = 0L
    private var maximumZoom = 1f
    private val stateObserver = Observer<CameraState> {
        if (running.get() && it.error != null) error("相机正被占用或暂时不可用，请关闭其他相机应用后重试。")
    }
    private val zoomObserver = Observer<ZoomState> { if (running.get()) zoomChanged(it.zoomRatio, maximumZoom) }

    fun start() {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            if (running.get()) runCatching {
                val cp = future.get(); provider = cp
                val selector = CameraSelector.Builder().requireLensFacing(CameraSelector.LENS_FACING_FRONT)
                    .addCameraFilter { infos ->
                        // Pixel 3 exposes a fixed-focus wide selfie lens as well as the AF standard lens.
                        infos.sortedWith(compareByDescending<CameraInfo> {
                            val c = Camera2CameraInfo.from(it)
                            (c.getCameraCharacteristic(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f) > 0f
                        }.thenByDescending { Camera2CameraInfo.from(it).getCameraCharacteristic(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.maxOrNull() ?: 0f }
                            .thenBy { Camera2CameraInfo.from(it).getCameraCharacteristic(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.size ?: 0 }).take(1)
                    }.build()
                val stream = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setResolutionSelector(ResolutionSelector.Builder()
                        .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                        .setResolutionStrategy(ResolutionStrategy(Size(1920, 1440), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)).build())
                    .build().also { analysis = it }
                val view = Preview.Builder().build().also { cameraPreview = it; it.setSurfaceProvider(preview.surfaceProvider) }
                val bound = cp.bindToLifecycle(owner, selector, view, stream); camera = bound
                maximumZoom = (bound.cameraInfo.zoomState.value?.maxZoomRatio ?: 1f).coerceIn(1f, 4f)
                bound.cameraInfo.cameraState.observe(owner, stateObserver)
                bound.cameraInfo.zoomState.observe(owner, zoomObserver)
                val options = BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).enableAllPotentialBarcodes()
                    .setZoomSuggestionOptions(ZoomSuggestionOptions.Builder { ratio ->
                        if (!running.get() || !automaticZoom() || SystemClock.elapsedRealtime() - lastZoom < 800) false
                        else { main.execute { if (running.get() && automaticZoom()) zoom(ratio) }; true }
                    }.setMaxSupportedZoomRatio(maximumZoom).build()).build()
                val reader = BarcodeScanning.getClient(options); scanner = reader
                var reported = false
                stream.setAnalyzer(executor) { frame ->
                    val media = frame.image
                    if (!running.get() || recognized.get() || media == null) frame.close()
                    else {
                        if (!reported) { reported = true; Log.i("AcornaryCamera", "Front camera ${Camera2CameraInfo.from(bound.cameraInfo).cameraId}; analysis ${frame.width}x${frame.height}; max zoom $maximumZoom") }
                        try {
                            reader.process(InputImage.fromMediaImage(media, frame.imageInfo.rotationDegrees))
                                .addOnSuccessListener(main) { codes ->
                                    if (running.get() && !recognized.get()) codes.firstNotNullOfOrNull { it.rawValue }?.let {
                                        recognized.set(true); result(it)
                                    }
                                }.addOnFailureListener(main) { if (running.get()) error("识别暂时不可用，请重试。") }
                                .addOnCompleteListener { frame.close() }
                        } catch (_: Exception) { frame.close(); main.execute { if (running.get()) error("识别暂时不可用，请重试。") } }
                    }
                }
                preview.post { if (running.get()) focus(preview.width / 2f, preview.height / 2f) }
            }.onFailure { error("无法打开前置相机，请检查权限后重试。") }
        }, main)
    }
    fun zoom(ratio: Float) {
        if (!running.get()) return
        lastZoom = SystemClock.elapsedRealtime()
        camera?.cameraControl?.setZoomRatio(ratio.coerceIn(1f, maximumZoom))
    }
    fun focus(x: Float, y: Float) {
        val active = camera ?: return
        if (!running.get() || preview.width == 0 || preview.height == 0) return
        val point = preview.meteringPointFactory.createPoint(x, y)
        val action = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE).setAutoCancelDuration(5, TimeUnit.SECONDS).build()
        if (active.cameraInfo.isFocusMeteringSupported(action)) active.cameraControl.startFocusAndMetering(action)
    }
    fun close() {
        running.set(false)
        camera?.cameraInfo?.cameraState?.removeObserver(stateObserver)
        camera?.cameraInfo?.zoomState?.removeObserver(zoomObserver)
        analysis?.clearAnalyzer()
        listOfNotNull(cameraPreview, analysis).takeIf { it.isNotEmpty() }?.let { provider?.unbind(*it.toTypedArray()) }
        scanner?.close(); executor.shutdown()
    }
}
