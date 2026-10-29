package top.protium.acornary

/** NIIMBOT framing, ported from @mmote/niimbluelib 0.47.0 (MIT). */
data class NiimbotPacket(val command: Int, val data: ByteArray) {
    fun encode(): ByteArray {
        require(command in 0..255 && data.size <= 255)
        var checksum = command xor data.size
        data.forEach { checksum = checksum xor (it.toInt() and 255) }
        val frame = byteArrayOf(0x55, 0x55, command.toByte(), data.size.toByte()) + data + byteArrayOf(checksum.toByte(), 0xaa.toByte(), 0xaa.toByte())
        return if (command == 0xc1) byteArrayOf(3) + frame else frame
    }
    companion object {
        fun decode(frame: ByteArray): NiimbotPacket {
            require(frame.size >= 7 && frame[0] == 0x55.toByte() && frame[1] == 0x55.toByte())
            val size = frame[3].toInt() and 255
            require(frame.size == size + 7 && frame.takeLast(2).all { it == 0xaa.toByte() })
            val p = NiimbotPacket(frame[2].toInt() and 255, frame.copyOfRange(4, 4 + size))
            var sum = p.command xor size
            p.data.forEach { sum = sum xor (it.toInt() and 255) }
            require(sum == (frame[4 + size].toInt() and 255))
            return p
        }
    }
}

class NiimbotStream {
    private var buffer = byteArrayOf()
    fun accept(bytes: ByteArray): List<NiimbotPacket> {
        require(buffer.size + bytes.size <= 4096) { "Printer receive buffer exceeded" }
        buffer += bytes
        val packets = mutableListOf<NiimbotPacket>()
        while (buffer.size >= 4) {
            require(buffer[0] == 0x55.toByte() && buffer[1] == 0x55.toByte()) { "Invalid printer frame" }
            val size = (buffer[3].toInt() and 255) + 7
            if (buffer.size < size) break
            packets += NiimbotPacket.decode(buffer.copyOfRange(0, size))
            buffer = buffer.copyOfRange(size, buffer.size)
        }
        return packets
    }
}
