package top.protium.acornary

import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.UUID

/** Bounded, read-only hardware probe. Selecting a device never triggers printing. */
@SuppressLint("MissingPermission")
class D101Probe(context: Context, private val update: (String) -> Unit, private val found: (BluetoothDevice) -> Unit) {
    private val app = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private val adapter = app.getSystemService(BluetoothManager::class.java).adapter
    private var gatt: BluetoothGatt? = null
    private var channel: BluetoothGattCharacteristic? = null
    private var stream = NiimbotStream()
    private var scanning = false
    private var closed = false
    private var expected: Int? = null
    private fun report(value: String) { handler.post { if (!closed) update(value) } }
    private val timeout = Runnable { report("连接或协议响应超时，请确认打印机未被其他应用占用。"); disconnect() }
    private val scanTimeout = Runnable {
        if (scanning) { stopScan(); report("扫描完成，选择发现的打印机。未发现时请检查电源。") }
    }
    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(type: Int, result: ScanResult) {
            val name = result.scanRecord?.deviceName ?: result.device.name ?: ""
            if (name.startsWith("D101", ignoreCase = true)) handler.post { if (!closed && scanning) found(result.device) }
        }
        override fun onScanFailed(code: Int) { scanning = false; report("蓝牙扫描失败：$code") }
    }
    fun scan() {
        if (adapter?.isEnabled != true) { report("请先开启系统蓝牙"); return }
        stopScan()
        scanning = true
        report("正在搜索 D101…")
        adapter.bluetoothLeScanner.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback)
        handler.postDelayed(scanTimeout, 12000)
    }
    fun stopScan() {
        handler.removeCallbacks(scanTimeout)
        if (scanning) adapter?.bluetoothLeScanner?.stopScan(scanCallback)
        scanning = false
    }
    fun connect(device: BluetoothDevice) {
        stopScan(); disconnect(); stream = NiimbotStream()
        report("正在连接 ${device.name ?: "D101"}…")
        handler.postDelayed(timeout, 15000)
        gatt = device.connectGatt(app, false, callback, BluetoothDevice.TRANSPORT_LE)
    }
    private fun send(command: Int, data: ByteArray, response: Int) {
        val g = gatt ?: return
        val c = channel ?: return
        expected = response
        handler.removeCallbacks(timeout); handler.postDelayed(timeout, 5000)
        c.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        c.value = NiimbotPacket(command, data).encode()
        if (!g.writeCharacteristic(c)) { report("发送请求失败"); disconnect() }
    }
    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, state: Int) { handler.post {
            if (g !== gatt) return@post
            if (status == BluetoothGatt.GATT_SUCCESS && state == BluetoothProfile.STATE_CONNECTED) {
                report("已连接，正在发现打印服务…")
                if (!g.discoverServices()) { report("无法发现服务"); disconnect() }
            } else if (state == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
                report("打印机已断开（$status）"); disconnect()
            }
        } }
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) { handler.post {
            if (g !== gatt) return@post
            if (status != BluetoothGatt.GATT_SUCCESS) { report("服务发现失败：$status"); disconnect(); return@post }
            val service = g.getService(UUID.fromString("e7810a71-73ae-499d-8c15-faa9aef0c3f2"))
            channel = service?.characteristics?.firstOrNull { it.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0 && it.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0 }
            val c = channel
            val descriptor = c?.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"))
            if (c == null || descriptor == null || !g.setCharacteristicNotification(c, true)) { report("缺少 D101 通信特征"); disconnect(); return@post }
            descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            if (!g.writeDescriptor(descriptor)) { report("无法订阅设备响应"); disconnect() }
        } }
        override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) { handler.post {
            if (g !== gatt) return@post
            if (status == BluetoothGatt.GATT_SUCCESS) send(0xc1, byteArrayOf(1), 0xc2)
            else { report("订阅失败：$status"); disconnect() }
        } }
        @Deprecated("Android 12 callback")
        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            val data = characteristic.value?.clone() ?: return
            handler.post { if (g === gatt) receive(data) }
        }
    }
    private fun receive(bytes: ByteArray) {
        runCatching { stream.accept(bytes) }.onSuccess { packets -> packets.forEach { p ->
            if (p.command == expected) {
                expected = null; handler.removeCallbacks(timeout)
                when (p.command) {
                    0xc2 -> if (p.data.isNotEmpty() && p.data[0].toInt() in 1..3) send(0x40, byteArrayOf(8), 0x48)
                        else { report("打印机拒绝握手"); disconnect() }
                    0x48 -> {
                        val model = if (p.data.size in 1..2) ((p.data[0].toInt() and 255) shl 8) or (p.data.getOrNull(1)?.toInt()?.and(255) ?: 0) else -1
                        if (model == 2560) report("D101 型号已确认 · BLE 通知和协议通信正常\n诊断模式未发送打印命令。")
                        else { report("型号不匹配：$model，仅支持 D101"); disconnect() }
                    }
                }
            }
        } }.onFailure { report("设备响应校验失败：${it.message}"); disconnect() }
    }
    fun disconnect() {
        handler.removeCallbacks(timeout); expected = null
        val old = gatt; gatt = null; channel = null
        old?.disconnect(); old?.close()
    }
    fun close() { closed = true; stopScan(); disconnect(); handler.removeCallbacksAndMessages(null) }
}
