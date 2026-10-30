package top.protium.acornary

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.*
import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

data class PrinterDevice(val address: String, val name: String)
data class PrinterState(
    val scanning: Boolean = false, val busy: Boolean = false, val printing: Boolean = false,
    val connected: Boolean = false, val deviceName: String? = null, val devices: List<PrinterDevice> = emptyList(),
    val message: String = "请开机并断开其他应用对 D101 的连接。", val progress: Int = 0,
    val uncertain: Boolean = false, val battery: Int? = null,
)

/** An interruption marker, never a queue: contains no item, account, bitmap or Bluetooth identity. */
class PrintRecovery(context: Context) {
    private val store = context.getSharedPreferences("print_recovery", Context.MODE_PRIVATE)
    fun pending() = store.getBoolean("pending", false)
    fun mark() { check(store.edit().putBoolean("pending", true).commit()) { "无法保存打印状态，标签尚未发送。" } }
    fun clear() { check(store.edit().remove("pending").commit()) { "无法保存确认结果，请核对纸张。" } }
}

@SuppressLint("MissingPermission")
class PrinterController(context: Context, private val scope: CoroutineScope) {
    private val app = context.applicationContext
    private val adapter = app.getSystemService(BluetoothManager::class.java)?.adapter
    private val recovery = PrintRecovery(app)
    private val mutable = MutableStateFlow(PrinterState(uncertain = recovery.pending(), message = if (recovery.pending()) "上次打印结果待核对，请检查纸张后再打印。" else "请开机并断开其他应用对 D101 的连接。"))
    val state = mutable.asStateFlow()
    private var scanner: BluetoothLeScanner? = null
    private var scanJob: Job? = null
    private var job: Job? = null
    private var connection: D101BleConnection? = null
    private var protocol: D101Protocol? = null
    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(type: Int, result: ScanResult) {
            val name = result.scanRecord?.deviceName ?: return
            if (!name.startsWith("D101", true)) return
            scope.launch {
                if (mutable.value.scanning) {
                    val device = PrinterDevice(result.device.address, name)
                    mutable.update { it.copy(devices = (it.devices.filterNot { d -> d.address == device.address } + device).sortedBy { d -> d.name }) }
                }
            }
        }
        override fun onScanFailed(code: Int) { scope.launch { stopScan(); message("蓝牙扫描失败（$code），请稍后重试。") } }
    }
    fun message(value: String) { mutable.update { it.copy(message = value) } }
    fun scan() {
        if (mutable.value.busy) return
        stopScan()
        if (adapter?.isEnabled != true) { message("请先开启系统蓝牙。"); return }
        try {
            scanner = adapter.bluetoothLeScanner ?: error("蓝牙扫描不可用。")
            mutable.update { it.copy(scanning = true, devices = emptyList(), message = "正在搜索 D101…") }
            scanner!!.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback)
            scanJob = scope.launch { delay(12_000); stopScan(); message(if (state.value.devices.isEmpty()) "未找到 D101，请检查电源和其他应用的连接。" else "选择下方打印机进行连接。") }
        } catch (_: SecurityException) { stopScan(); message("需要附近设备权限，请在系统设置中允许。") }
        catch (error: Exception) { stopScan(); message(error.message ?: "无法搜索打印机。") }
    }
    fun stopScan() { scanJob?.cancel(); scanJob = null; runCatching { scanner?.stopScan(scanCallback) }; scanner = null; mutable.update { it.copy(scanning = false) } }
    fun connect(device: PrinterDevice) {
        if (state.value.busy) return
        stopScan(); connection?.close(); protocol = null
        mutable.update { it.copy(busy = true, connected = false, deviceName = device.name, battery = null, message = "正在连接并核验 D101…") }
        job = scope.launch {
            var link: D101BleConnection? = null
            try {
                check(adapter?.isEnabled == true) { "请先开启系统蓝牙。" }
                link = D101BleConnection(app) { reason -> if (connection === link) mutable.update { it.copy(connected = false, message = reason) } }
                connection = link
                withTimeout(20_000) {
                    val active = requireNotNull(link)
                    active.connect(adapter!!.getRemoteDevice(device.address))
                    val identified = D101Protocol(active)
                    val status = identified.identify()
                    protocol = identified
                    mutable.update { it.copy(connected = true, battery = status.battery, message = if (status.lidClosed == false) "D101 已连接，请关好上盖。" else if (status.paperInserted == false) "D101 已连接，请装入标签纸。" else "D101 已连接，可以打印。") }
                    Log.i("AcornaryPrint", "D101 model 2560 confirmed")
                }
            } catch (error: Exception) {
                link?.close(); mutable.update { it.copy(connected = false, message = readable(error)) }
            } finally { mutable.update { it.copy(busy = false) } }
        }
    }
    fun print(bitmap: Bitmap, density: Int, completed: () -> Unit = {}, validate: suspend () -> Boolean = { true }) {
        val current = protocol
        if (state.value.busy || recovery.pending()) return
        if (!state.value.connected || current == null) { message("请先在设置中连接 D101。"); return }
        stopScan()
        mutable.update { it.copy(busy = true, progress = 0, message = "正在核对标签…") }
        job = scope.launch {
            try {
                withTimeout(45_000) {
                    if (!validate()) { message("物品资料已变化，预览已刷新。请核对后再次点击打印。"); return@withTimeout }
                    val raster = withContext(Dispatchers.Default) { LabelRenderer.raster(bitmap) }
                    current.print(raster, density, starting = {
                        withContext(NonCancellable + Dispatchers.IO) { recovery.mark() }
                        currentCoroutineContext().ensureActive()
                        mutable.update { it.copy(printing = true, message = "正在打印 1 张，请保持应用在前台…") }
                        Log.i("AcornaryPrint", "Single label started")
                    }, progress = { progress -> mutable.update { it.copy(progress = progress) } })
                    withContext(NonCancellable + Dispatchers.IO) { recovery.clear() }
                    mutable.update { it.copy(message = "打印机已确认完成 1 张。", uncertain = false) }
                    completed()
                    Log.i("AcornaryPrint", "Single label completion confirmed")
                }
            } catch (error: Exception) {
                connection?.close(); protocol = null
                val uncertain = recovery.pending()
                mutable.update { it.copy(connected = false, uncertain = uncertain, message = if (uncertain) "${readable(error)} 出纸结果待核对；不会自动重打。" else "${readable(error)} 标签未发送。") }
                Log.i("AcornaryPrint", if (uncertain) "Print result uncertain; retry disabled" else "Print stopped before output")
            } finally { mutable.update { it.copy(busy = false, printing = false) } }
        }
    }
    fun acknowledge() {
        if (state.value.busy) return
        runCatching { recovery.clear() }.onSuccess { mutable.update { it.copy(uncertain = false, message = "已核对。需要补打时请重新预览并打印。") } }.onFailure { message(it.message ?: "确认失败，请重试。") }
    }
    fun disconnect() {
        stopScan(); job?.cancel(); connection?.close(); connection = null; protocol = null
        mutable.update { it.copy(connected = false, battery = null, message = if (recovery.pending()) "打印已中断，出纸结果待核对。" else "打印机已断开。", uncertain = recovery.pending()) }
    }
    fun background() { if (state.value.scanning || state.value.connected || state.value.busy) disconnect() }
    private fun readable(error: Exception) = when(error) {
        is TimeoutCancellationException -> "打印机连接或响应超时。"
        is CancellationException -> "操作已停止。"
        is SecurityException -> "附近设备权限不可用，请重新允许。"
        else -> error.message ?: "打印未完成，请重新连接。"
    }
}
