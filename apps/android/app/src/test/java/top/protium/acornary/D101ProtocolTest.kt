package top.protium.acornary

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.security.MessageDigest

class D101ProtocolTest {
    private class Fake(var model: Int = 2560, val fail: Int? = null, val rejectEnd: Boolean = false) : NiimbotConnection {
        val sent = mutableListOf<NiimbotPacket>()
        var lid = true
        override suspend fun exchange(command: Int, data: ByteArray, response: Int?): NiimbotPacket? {
            sent.add(NiimbotPacket(command, data))
            if (command == fail) throw IOException("lost response")
            if (response == null) return null
            val payload = when(command) {
                0xc1 -> byteArrayOf(1)
                0x40 -> u16(model)
                0xdc -> ByteArray(13).also { it[9] = if (lid) 1 else 0; it[10] = 3; it[12] = 1 }
                0xa3 -> byteArrayOf(0, 1, 100, 100)
                0xf3 -> byteArrayOf(if (rejectEnd) 0 else 1)
                else -> byteArrayOf(1)
            }
            return NiimbotPacket(response, payload)
        }
        override fun close() {}
    }
    private fun blank() = PrinterRaster(240, 96, IntArray(240 * 96) { -1 })
    @Test fun requiresD101AndNeverStartsWrongModel() = runBlocking {
        val link = Fake(512)
        assertTrue(runCatching { D101Protocol(link).identify() }.isFailure)
        assertFalse(link.sent.any { it.command == 1 })
    }
    @Test fun closesPreflightForOpenLidWithoutOutput() = runBlocking {
        val link = Fake(); val protocol = D101Protocol(link)
        protocol.identify(); link.lid = false
        var marked = false
        assertTrue(runCatching { protocol.print(blank(), 2, { marked = true }, {}) }.isFailure)
        assertFalse(marked); assertFalse(link.sent.any { it.command == 1 })
    }
    @Test fun onePageMatchesB1SequenceAndMarksBeforeStart() = runBlocking {
        val link = Fake(); val protocol = D101Protocol(link); protocol.identify()
        var markedBeforeStart = false; var progress = 0
        protocol.print(blank(), 2, { markedBeforeStart = link.sent.none { it.command == 1 } }, { progress = it })
        assertTrue(markedBeforeStart); assertEquals(100, progress)
        assertEquals(listOf(0xc1, 0x40, 0xdc, 0xdc, 0x21, 0x23, 1, 3, 0x13, 0x84, 0xe3, 0xa3, 0xf3), link.sent.map { it.command })
        assertArrayEquals(byteArrayOf(0, 1, 0, 0, 0, 0, 0), link.sent.first { it.command == 1 }.data)
        assertArrayEquals(byteArrayOf(0, -16, 0, 96, 0, 1), link.sent.first { it.command == 0x13 }.data)
    }
    @Test fun responseLossNeverResendsPhysicalCommands() = runBlocking {
        val link = Fake(fail = 0xe3); val protocol = D101Protocol(link); protocol.identify()
        var marked = false
        assertTrue(runCatching { protocol.print(blank(), 2, { marked = true }, {}) }.isFailure)
        assertTrue(marked)
        assertEquals(1, link.sent.count { it.command == 1 })
        assertEquals(1, link.sent.count { it.command == 0xe3 })
        assertFalse(link.sent.any { it.command == 0xa3 })
    }
    @Test fun missingEndAcknowledgementIsNotSuccess() = runBlocking {
        val link = Fake(rejectEnd = true); val protocol = D101Protocol(link); protocol.identify()
        var finalProgress = 0
        assertTrue(runCatching { protocol.print(blank(), 2, {}, { finalProgress = it }) }.isFailure)
        assertTrue(finalProgress < 100)
    }
    @Test fun rasterMatchesPinnedWebDriverIncludingRotationAndBandCounts() {
        // Oracle: ImageEncoder.encode + PacketGenerator.writeImageData, niimbluelib 0.47.0, 192-dot head.
        listOf(Triple(240, 96, "a2af48c7482a070f0d5b57e7c96d95330a0ab0c326dd820a6a51b4e37c8ac55b"),
            Triple(320, 160, "a752b8e6b352cbcb735805f2f38587cca83e67e479f49e0afe37ac3b3c1148e0")).forEach { (width, height, expected) ->
            val pixels = IntArray(width * height) { i ->
                val x = i % width; val y = i / width
                if (y == 0 && x < 3 || x in 12..17 && y in 30..69 || (x * 13 + y * 7) % 97 == 0) 0xff000000.toInt() else -1
            }
            val digest = MessageDigest.getInstance("SHA-256")
            PrinterRaster(width, height, pixels).packets().forEach { digest.update(it.encode()) }
            assertEquals(expected, digest.digest().joinToString("") { "%02x".format(it) })
        }
    }
    @Test fun longBlankRunsNeverOverflowRepeatByte() {
        val packets = PrinterRaster(320, 160, IntArray(320 * 160) { -1 }).packets()
        assertEquals(listOf(255, 65), packets.map { it.data[2].u() })
        assertArrayEquals(byteArrayOf(0, -1, 65), packets[1].data)
    }
}
