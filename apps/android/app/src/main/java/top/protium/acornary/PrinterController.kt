package top.protium.acornary

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.*
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class PrinterDevice(val address: String, val name: String)
data class PrinterState(
    val scanning: Boolean = false, val busy: Boolean = false, val printing: Boolean = false,
    val connected: Boolean = false, val deviceName: String? = null, val devices: List<PrinterDevice> = emptyList(),
    val message: String = "请开机并断开其他应用对 D101 的连接。", val progress: Int = 0,
    val uncertain: Boolean = false, val battery: Int? = null,
    val keepConnected: Boolean = true, val automaticConnection: Boolean = false,
)

/** An interruption marker, never a queue: contains no item, account, bitmap or Bluetooth identity. */
class PrintRecovery(context: Context) {
    private val store = context.getSharedPreferences("print_recovery", Context.MODE_PRIVATE)
    fun pending() = store.getBoolean("pending", false)
    fun mark() { check(store.edit().putBoolean("pending", true).commit()) { "无法保存打印状态，标签尚未发送。" } }
    fun clear() { check(store.edit().remove("pending").commit()) { "无法保存确认结果，请核对纸张。" } }
}

class PrinterMemory(context: Context, name: String = "printer_device") {
    private val store = context.getSharedPreferences(name, Context.MODE_PRIVATE)
    fun device(): PrinterDevice? = store.getString("address", null)?.takeIf { android.bluetooth.BluetoothAdapter.checkBluetoothAddress(it) }
        ?.let { PrinterDevice(it, store.getString("name", "D101") ?: "D101") }
    fun remember(device: PrinterDevice) { check(store.edit().putString("address", device.address).putString("name", device.name).commit()) { "无法记住打印机，请重试。" } }
    fun keep() = store.getBoolean("keep", true)
    fun keep(value: Boolean) { check(store.edit().putBoolean("keep", value).commit()) { "无法保存连接设置，请重试。" } }
}

@SuppressLint("MissingPermission")
class PrinterController(
    context: Context, private val scope: CoroutineScope,
    private val memory: PrinterMemory = PrinterMemory(context),
    private val available: () -> Boolean = { PrinterService.permitted(context) && context.getSystemService(BluetoothManager::class.java)?.adapter?.isEnabled == true },
    private val makeLink: (Context, (String) -> Unit) -> D101Link = { app, lost -> D101BleConnection(app, lost) },
    private val maintenanceInterval: Long = 15_000,
    private val retryDelay: (Int) -> Long = { reconnectDelay(it) },
) {
    private val app = context.applicationContext
    private val adapter = app.getSystemService(BluetoothManager::class.java)?.adapter
    private val recovery = PrintRecovery(app)
    private var target = memory.device()
    private val mutable = MutableStateFlow(PrinterState(deviceName = target?.name, keepConnected = memory.keep(), uncertain = recovery.pending(), message = if (recovery.pending()) "上次打印结果待核对，请检查纸张后再打印。" else "请开机并连接 D101；连接后将记住打印机。"))
    val state = mutable.asStateFlow()
    private var scanner: BluetoothLeScanner? = null
    private var scanJob: Job? = null
    private var job: Job? = null
    private var connection: D101Link? = null
    private val protocolMutex = Mutex()
    private var maintenance: Job? = null
    private var protocol: D101Protocol? = null
    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(type: Int, result: ScanResult) {
            val name = result.scanRecord?.deviceName ?: runCatching { result.device.name }.getOrNull() ?: return
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
            // D101 may expose separate Classic and BLE addresses with the same name.
            // Only re-offer the BLE address we actually verified, never a Classic-only bond.
            mutable.update { it.copy(scanning = true, devices = listOfNotNull(memory.device()), message = "正在搜索 D101…") }
            scanner!!.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback)
            scanJob = scope.launch { delay(12_000); stopScan(); message(if (state.value.devices.isEmpty()) "未找到 D101，请检查电源和其他应用的连接。" else "选择下方打印机进行连接。") }
        } catch (_: SecurityException) { stopScan(); message("需要附近设备权限，请在系统设置中允许。") }
        catch (error: Exception) { stopScan(); message(error.message ?: "无法搜索打印机。") }
    }
    fun stopScan() { scanJob?.cancel(); scanJob = null; runCatching { scanner?.stopScan(scanCallback) }; scanner = null; mutable.update { it.copy(scanning = false) } }
    fun wantsMaintenance() = target != null && state.value.keepConnected
    fun setKeepConnected(value: Boolean) {
        if (state.value.busy) return
        try {
            memory.keep(value)
            mutable.update { it.copy(keepConnected = value) }
            if (value) PrinterService.resume(app) else {
                stopMaintenance()
                app.stopService(Intent(app, PrinterService::class.java))
            }
        } catch (error: Exception) { message(readable(error)) }
    }
    fun startMaintenance() {
        if (maintenance?.isActive == true || !wantsMaintenance()) return
        maintenance = scope.launch {
            var failures = 0
            while (isActive && wantsMaintenance()) {
                if (available()) {
                    if (!state.value.busy && !state.value.scanning) {
                        if (!state.value.connected) {
                            target?.let { connect(it, automatic = true) }
                            job?.join()
                        } else {
                            val current = protocol
                            try {
                                protocolMutex.withLock {
                                    if (current != null && protocol === current && !state.value.busy) {
                                        val status = current.status()
                                        mutable.update { it.copy(battery = status.battery) }
                                        Log.d("AcornaryPrint", "Connection heartbeat confirmed")
                                    }
                                }
                            } catch (_: TimeoutCancellationException) { if (protocol === current) closeLink("打印机响应超时，将自动重连。") }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: Exception) { if (protocol === current) closeLink("打印机连接中断，将自动重连。") }
                        }
                    }
                } else if (state.value.connected) closeLink("蓝牙或权限不可用，恢复后将自动重连。")
                failures = if (state.value.connected) 0 else (failures + 1).coerceAtMost(4)
                delay(if (state.value.connected) maintenanceInterval else retryDelay(failures))
            }
        }
    }
    fun stopMaintenance() {
        maintenance?.cancel(); maintenance = null
        job?.cancel()
        closeLink(if (recovery.pending()) "出纸结果待核对；不会自动重打。" else "保持连接已暂停。")
    }
    fun connect(device: PrinterDevice, automatic: Boolean = false) {
        if (state.value.busy) return
        stopScan(); closeLink()
        target = device
        mutable.update { it.copy(busy = true, automaticConnection = automatic, deviceName = device.name, battery = null, message = if (automatic) "正在自动重连 D101…" else "正在连接并核验 D101…") }
        job = scope.launch {
            var link: D101Link? = null
            try {
                check(available()) { "请开启蓝牙并允许附近设备权限。" }
                protocolMutex.withLock {
                    link = makeLink(app) { reason -> if (connection === link) closeLink(if (wantsMaintenance()) "$reason 将自动重连。" else reason) }
                    connection = link
                    withTimeout(20_000) {
                        val active = requireNotNull(link)
                        active.connect(device.address)
                        val identified = D101Protocol(active)
                        val status = identified.identify()
                        memory.remember(device)
                        protocol = identified
                        mutable.update { it.copy(connected = true, battery = status.battery, message = if (recovery.pending()) "已重新连接，上次出纸结果仍待核对。" else if (status.lidClosed == false) "D101 已连接，请关好上盖。" else if (status.paperInserted == false) "D101 已连接，请装入标签纸。" else "D101 已连接，可以打印。") }
                        Log.i("AcornaryPrint", "D101 model 2560 confirmed")
                    }
                }
            } catch (error: Exception) {
                link?.close()
                mutable.update { it.copy(connected = false, message = readable(error) + if (automatic) " 将稍后重连。" else "") }
            } finally { mutable.update { it.copy(busy = false, automaticConnection = false) } }
        }
        // A foreground user action starts the connectedDevice service, before leaving the Activity.
        if (!automatic && wantsMaintenance()) PrinterService.resume(app)
    }
    private fun closeLink(reason: String? = null) {
        connection?.close(); connection = null; protocol = null
        mutable.update { it.copy(connected = false, battery = null, message = reason ?: it.message) }
    }
    fun print(bitmap: Bitmap, density: Int, completed: () -> Unit = {}, validate: suspend () -> Boolean = { true }) {
        val current = protocol
        if (state.value.busy || state.value.uncertain || recovery.pending()) return
        if (!state.value.connected || current == null) { message("请先在设置中连接 D101。"); return }
        stopScan()
        mutable.update { it.copy(busy = true, progress = 0, message = "正在核对标签…") }
        job = scope.launch {
            var mayHavePrinted = false
            try {
                withTimeout(45_000) {
                    if (!validate()) { message("物品资料已变化，预览已刷新。请核对后再次点击打印。"); return@withTimeout }
                    val raster = withContext(Dispatchers.Default) { LabelRenderer.raster(bitmap) }
                    protocolMutex.withLock {
                    check(protocol === current && state.value.connected) { "打印机已断开，请等待重连。" }
                    current.print(raster, density, starting = {
                        withContext(NonCancellable + Dispatchers.IO) { recovery.mark() }
                        mayHavePrinted = true
                        currentCoroutineContext().ensureActive()
                        mutable.update { it.copy(printing = true, message = "正在打印 1 张，请保持应用在前台…") }
                        Log.i("AcornaryPrint", "Single label started")
                    }, progress = { progress -> mutable.update { it.copy(progress = progress) } })
                    }
                    withContext(NonCancellable + Dispatchers.IO) { recovery.clear() }
                    mutable.update { it.copy(message = "打印机已确认完成 1 张。", uncertain = false) }
                    completed()
                    Log.i("AcornaryPrint", "Single label completion confirmed")
                }
            } catch (error: Exception) {
                connection?.close(); protocol = null
                // A failed receipt clear must never turn a physically sent label into "not sent".
                val uncertain = mayHavePrinted || recovery.pending()
                if (uncertain) withContext(NonCancellable + Dispatchers.IO) { runCatching { recovery.mark() } }
                mutable.update { it.copy(connected = false, uncertain = uncertain, message = if (uncertain) "${readable(error)} 出纸结果待核对；不会自动重打。" else "${readable(error)} 标签未发送。") }
                Log.i("AcornaryPrint", if (uncertain) "Print result uncertain; retry disabled" else "Print stopped before output")
            } finally { mutable.update { it.copy(busy = false, printing = false) } }
        }
    }
    fun acknowledge() {
        if (state.value.busy) return
        runCatching { recovery.clear() }.onSuccess { mutable.update { it.copy(uncertain = false, message = "已核对。需要补打时请重新预览并打印。") } }.onFailure { message(it.message ?: "确认失败，请重试。") }
    }
    /** Explicit disconnect also pauses retries, but leaves Android's system pairing intact. */
    fun disconnect() {
        try { memory.keep(false) } catch (error: Exception) { message(readable(error)); return }
        mutable.update { it.copy(keepConnected = false) }
        stopScan(); stopMaintenance()
        app.stopService(Intent(app, PrinterService::class.java))
        message("打印机已断开，自动重连已暂停。")
    }
    fun scopeChanged() { if (state.value.busy && !state.value.automaticConnection) job?.cancel() }
    fun background() {
        stopScan()
        // Physical jobs never continue/replay unseen; an idle persistent connection survives AOD.
        if (state.value.busy && !state.value.automaticConnection) job?.cancel()
        if (maintenance?.isActive != true) { job?.cancel(); closeLink() }
    }
    companion object {
        fun reconnectDelay(failure: Int): Long = when (failure) { 0, 1 -> 5_000; 2 -> 15_000; 3 -> 30_000; else -> 60_000 }
    }
    private fun readable(error: Exception) = when(error) {
        is TimeoutCancellationException -> "打印机连接或响应超时。"
        is CancellationException -> "操作已停止。"
        is SecurityException -> "附近设备权限不可用，请重新允许。"
        else -> error.message ?: "打印未完成，请重新连接。"
    }
}
