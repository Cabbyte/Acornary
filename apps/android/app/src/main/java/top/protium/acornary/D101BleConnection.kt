package top.protium.acornary

import android.annotation.SuppressLint
import android.bluetooth.*
import android.content.Context
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.*
import java.io.IOException
import java.util.UUID

interface D101Link : NiimbotConnection { suspend fun connect(address: String) }

/** One GATT operation at a time; a failed/late exchange invalidates the entire connection. */
@SuppressLint("MissingPermission")
@Suppress("DEPRECATION")
class D101BleConnection(private val context: Context, private val disconnected: (String) -> Unit) : D101Link {
    private val handler = Handler(Looper.getMainLooper())
    private var gatt: BluetoothGatt? = null
    private var channel: BluetoothGattCharacteristic? = null
    private var connected = CompletableDeferred<Unit>()
    private var write: CompletableDeferred<Unit>? = null
    private var response: Pair<Int, CompletableDeferred<NiimbotPacket>>? = null
    private val stream = NiimbotStream()
    private var closed = false
    private var exchanging = false

    override suspend fun connect(address: String) = withContext(Dispatchers.Main.immediate) {
        try {
            withTimeout(15_000) {
                val device = context.getSystemService(BluetoothManager::class.java).adapter.getRemoteDevice(address)
                gatt = device.connectGatt(context.applicationContext, false, callback, BluetoothDevice.TRANSPORT_LE)
                    ?: throw IOException("无法建立蓝牙连接。")
                connected.await()
            }
        } catch (error: Exception) { close(); throw error }
    }
    override suspend fun exchange(command: Int, data: ByteArray, response: Int?): NiimbotPacket? = withContext(Dispatchers.Main.immediate) {
        check(!exchanging) { "蓝牙请求正在执行。" }
        check(!closed && connected.isCompleted && !connected.isCancelled) { "打印机未连接。" }
        exchanging = true
        try {
            withTimeout(5_000) {
                val pending = response?.let { CompletableDeferred<NiimbotPacket>() }
                this@D101BleConnection.response = response?.let { it to pending!! }
                // 20 bytes works at Android's default ATT MTU; do not assume an MTU negotiation succeeded.
                for (chunk in NiimbotPacket(command, data).encode().toList().chunked(20)) {
                    val current = gatt ?: throw IOException("打印机已断开。")
                    val c = channel ?: throw IOException("打印通道不可用。")
                    val written = CompletableDeferred<Unit>(); write = written
                    c.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                    c.value = chunk.toByteArray()
                    if (!current.writeCharacteristic(c)) throw IOException("蓝牙发送失败。")
                    written.await()
                    write = null
                    delay(5)
                }
                pending?.await()
            }
        } catch (error: Exception) { close(); throw error }
        finally { this@D101BleConnection.response = null; write = null; exchanging = false }
    }
    private fun fail(message: String) {
        if (closed) return
        val error = IOException(message)
        connected.completeExceptionally(error); write?.completeExceptionally(error); response?.second?.completeExceptionally(error)
        close()
        disconnected(message)
    }
    private fun receive(bytes: ByteArray) {
        try {
            stream.accept(bytes).forEach { packet ->
                if (packet.command == 0xdb) { fail(printerError(packet.data.firstOrNull()?.u() ?: -1)); return }
                if (packet.command == 0x00) { fail("打印机不支持当前指令。"); return }
                response?.takeIf { it.first == packet.command }?.second?.complete(packet)
            }
        } catch (_: IllegalArgumentException) { fail("打印机响应校验失败，请重新连接。") }
    }
    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) { handler.post {
            if (closed || g !== gatt) return@post
            if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
                if (!g.discoverServices()) fail("无法读取打印服务。")
            } else if (status != BluetoothGatt.GATT_SUCCESS || newState == BluetoothProfile.STATE_DISCONNECTED) fail("打印机已断开（$status），请检查电源或其他应用的连接。")
        } }
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) { handler.post {
            if (closed || g !== gatt) return@post
            if (status != BluetoothGatt.GATT_SUCCESS) { fail("打印服务发现失败（$status）。"); return@post }
            val service = g.getService(UUID.fromString("e7810a71-73ae-499d-8c15-faa9aef0c3f2"))
            channel = service?.characteristics?.firstOrNull {
                it.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0 && it.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0
            }
            val c = channel
            val descriptor = c?.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"))
            if (c == null || descriptor == null || !g.setCharacteristicNotification(c, true)) { fail("设备没有可用的 D101 蓝牙通道。"); return@post }
            descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            if (!g.writeDescriptor(descriptor)) fail("无法订阅打印机响应。")
        } }
        override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) { handler.post {
            if (closed || g !== gatt) return@post
            if (status == BluetoothGatt.GATT_SUCCESS) connected.complete(Unit) else fail("打印响应订阅失败（$status）。")
        } }
        override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) { handler.post {
            if (closed || g !== gatt) return@post
            if (status == BluetoothGatt.GATT_SUCCESS) write?.complete(Unit) else fail("蓝牙写入失败（$status）。")
        } }
        @Deprecated("Android 12 callback")
        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            val bytes = characteristic.value?.clone() ?: return
            handler.post { if (!closed && g === gatt) receive(bytes) }
        }
        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            val bytes = value.clone()
            handler.post { if (!closed && g === gatt) receive(bytes) }
        }
    }
    override fun close() {
        if (closed) return
        closed = true
        val error = IOException("打印机连接已结束。")
        connected.completeExceptionally(error); write?.completeExceptionally(error); response?.second?.completeExceptionally(error)
        val old = gatt; gatt = null; channel = null
        runCatching { old?.disconnect() }; runCatching { old?.close() }
        handler.removeCallbacksAndMessages(null)
    }
}
