package top.protium.acornary
import org.junit.Assert.*
import org.junit.Test

class NiimbotPacketTest {
    @Test fun wireMatchesExistingDriver() {
        assertEquals("035555c10101c1aaaa", NiimbotPacket(0xc1, byteArrayOf(1)).encode().hex())
        assertEquals("555540010849aaaa", NiimbotPacket(0x40, byteArrayOf(8)).encode().hex())
    }
    @Test fun handlesFragmentedAndBundledNotifications() {
        val p = NiimbotPacket(0x48, byteArrayOf(0x0a, 0))
        val stream = NiimbotStream()
        assertTrue(stream.accept(p.encode().copyOfRange(0, 3)).isEmpty())
        val results = stream.accept(p.encode().copyOfRange(3, 9) + p.encode())
        assertEquals(2, results.size)
        results.forEach { assertArrayEquals(p.data, it.data) }
    }
    @Test(expected = IllegalArgumentException::class) fun rejectsCorruptResponses() {
        val frame = NiimbotPacket(0x48, byteArrayOf(0x0a, 0)).encode()
        frame[4] = 7
        NiimbotPacket.decode(frame)
    }
    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }
}
