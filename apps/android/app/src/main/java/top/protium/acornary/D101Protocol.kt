package top.protium.acornary

import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout

/** D101 B1 task and bitmap format from @mmote/niimbluelib 0.47.0 (MIT; see assets/licenses). */
interface NiimbotConnection {
    suspend fun exchange(command: Int, data: ByteArray = byteArrayOf(1), response: Int? = null): NiimbotPacket?
    fun close()
}

fun printerError(code: Int): String = when (code) {
    1 -> "打印机上盖未关好"
    2 -> "打印机缺纸，请装入标签纸"
    3, 4 -> "打印机电量不足或电池异常"
    5 -> "打印已被取消"
    7 -> "打印头过热，请稍后再试"
    8 -> "出纸异常，请检查纸卷"
    9 -> "打印机忙，请等待当前任务结束"
    16, 17 -> "标签纸未识别，请检查纸卷"
    else -> "打印机报告错误（$code）"
}

data class D101Status(val lidClosed: Boolean?, val paperInserted: Boolean?, val battery: Int?) {
    fun requireReady() {
        check(lidClosed != false) { "打印机上盖未关好。" }
        check(paperInserted != false) { "打印机缺纸，请装入标签纸。" }
    }
}

class D101Protocol(private val link: NiimbotConnection) {
    private var identified = false
    private var heartbeatType = 1
    suspend fun identify(): D101Status {
        val result = response(0xc1, byteArrayOf(1), 0xc2).firstOrNull()?.u() ?: 0
        check(result in 1..3) { "打印机拒绝连接，请断开其他应用后重试。" }
        val model = response(0x40, byteArrayOf(8), 0x48)
        check(model.size in 1..2 && (model[0].u() * 256 + (model.getOrNull(1)?.u() ?: 0)) == 2560) { "型号不匹配，目前仅支持 NIIMBOT D101。" }
        if (result == 3) {
            val version = response(0xa5, byteArrayOf(1), 0xb5)
            if (version.size >= 13 && version[11].u() * 100 + version[12].u() >= 204) heartbeatType = 4
        }
        identified = true
        return status()
    }
    suspend fun status(): D101Status {
        check(identified)
        return parseStatus(response(0xdc, byteArrayOf(heartbeatType.toByte()), if (heartbeatType == 4) 0xd9 else 0xdd), heartbeatType)
    }
    /** One page only. No retries, even when an acknowledgement is missing. */
    suspend fun print(image: PrinterRaster, density: Int, starting: suspend () -> Unit, progress: (Int) -> Unit) = withTimeout(45_000) {
        check(identified) { "请先连接并确认 D101。" }
        require(density in 1..3)
        status().requireReady()
        val rows = image.packets()
        ack(0x21, byteArrayOf(density.toByte()), 0x31)
        ack(0x23, byteArrayOf(1), 0x33)
        // Persist uncertainty before any command that can cause physical output.
        starting()
        ack(0x01, byteArrayOf(0, 1, 0, 0, 0, 0, 0), 0x02)
        ack(0x03, byteArrayOf(1), 0x04)
        ack(0x13, u16(image.rows) + u16(image.cols) + u16(1), 0x14)
        rows.forEachIndexed { index, packet ->
            link.exchange(packet.command, packet.data)
            progress((index + 1) * 90 / rows.size)
        }
        ack(0xe3, byteArrayOf(1), 0xe4)
        withTimeout(15_000) {
            while (true) {
                val p = response(0xa3, byteArrayOf(1), 0xb3)
                require(p.size >= 4) { "打印进度响应无效。" }
                if (p.size == 10 && p[6].u() != 0) error(printerError(p[6].u()))
                val page = p[0].u() * 256 + p[1].u()
                // The established D101 driver treats the completed page counter as authoritative.
                if (page == 1) break
                check(page == 0) { "打印机返回了意外的页数，请核对纸张。" }
                delay(200)
            }
        }
        ack(0xf3, byteArrayOf(1), 0xf4)
        progress(100)
    }
    private suspend fun response(command: Int, data: ByteArray, expected: Int) = requireNotNull(link.exchange(command, data, expected)).data
    private suspend fun ack(command: Int, data: ByteArray, expected: Int) {
        val result = response(command, data, expected)
        check(result.size == 1 && result[0].u() == 1) { "打印机未确认指令（${command.toString(16)}）。" }
    }
    companion object {
        fun parseStatus(data: ByteArray, type: Int): D101Status {
            var lid: Boolean? = null; var paper: Boolean? = null; var battery: Int? = null
            if (type == 4) {
                require(data.size >= 9) { "打印机状态响应无效。" }
                battery = data[2].u(); lid = data[4].u() == 0; paper = data[5].u() == 0
            } else when (data.size) {
                // D101's advanced-1 lid bit is inverted, as in the pinned upstream driver.
                10 -> { lid = data[8].u() != 0; battery = data[9].u() }
                13 -> { lid = data[9].u() != 0; battery = data[10].u(); paper = data[11].u() == 0 }
                19 -> { lid = data[15].u() != 0; battery = data[16].u(); paper = data[17].u() == 0 }
                20 -> { paper = data[18].u() == 0 }
                else -> error("打印机状态响应无效。")
            }
            return D101Status(lid, paper, battery?.let { if (it <= 4) it * 25 else it }?.coerceIn(0, 100))
        }
    }
}

internal fun Byte.u() = toInt() and 255
internal fun u16(value: Int) = byteArrayOf((value shr 8).toByte(), value.toByte())

/** Screen bitmap -> D101's clockwise, MSB-first raster; 192-dot print head in three 64-dot bands. */
class PrinterRaster(val width: Int, val height: Int, private val pixels: IntArray) {
    init { require((width == 240 && height == 96 || width == 320 && height == 160) && pixels.size == width * height) }
    val rows = width
    val cols = height
    fun packets(): List<NiimbotPacket> {
        data class Row(val index: Int, val data: ByteArray, var repeat: Int)
        val compressed = mutableListOf<Row>()
        for (row in 0 until rows) {
            val bytes = ByteArray(cols / 8)
            for (col in 0 until cols) if (pixels[(height - 1 - col) * width + row] and 0xffffff != 0xffffff) {
                bytes[col / 8] = (bytes[col / 8].u() or (1 shl (7 - col % 8))).toByte()
            }
            val last = compressed.lastOrNull()
            if (last != null && last.repeat < 255 && last.data.contentEquals(bytes)) last.repeat++
            else compressed.add(Row(row, bytes, 1))
        }
        return compressed.map { row ->
            val parts = IntArray(3)
            row.data.forEachIndexed { i, byte -> parts[i / 8] += Integer.bitCount(byte.u()) }
            val count = parts.sum()
            val prefix = u16(row.index) + parts.map { it.toByte() }.toByteArray() + byteArrayOf(row.repeat.toByte())
            when {
                count == 0 -> NiimbotPacket(0x84, u16(row.index) + byteArrayOf(row.repeat.toByte()))
                count <= 6 -> {
                    val indexes = mutableListOf<Byte>()
                    row.data.forEachIndexed { i, byte -> for (bit in 0..7) if (byte.u() and (1 shl (7 - bit)) != 0) indexes.addAll(u16(i * 8 + bit).toList()) }
                    NiimbotPacket(0x83, prefix + indexes.toByteArray())
                }
                else -> NiimbotPacket(0x85, prefix + row.data)
            }
        }
    }
}
