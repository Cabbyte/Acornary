package top.protium.acornary

import org.junit.Assert.*
import org.junit.Test

class ItemLinkTest {
    @Test fun validLabelPreservesIdentity() {
        assertEquals("item_11111111-1111-4111-8111-000000000001", ItemLink.parse("https://acornary.protium.top/i/ERERERERQRGBEQAAAAAAAQ"))
        assertEquals("https://acornary.protium.top/i/ERERERERQRGBEQAAAAAAAQ", ItemLink.encode("item_11111111-1111-4111-8111-000000000001"))
    }
    @Test fun newLabelsRoundTripDistinctIdentities() {
        val ids = (1..50).map { "item_${java.util.UUID.randomUUID()}" }
        assertEquals(50, ids.map { ItemLink.encode(it) }.toSet().size)
        ids.forEach { assertEquals(it, ItemLink.parse(ItemLink.encode(it))) }
    }
    @Test(expected = IllegalArgumentException::class) fun refusesNoncanonicalIds() { ItemLink.encode("item_1-1-4111-8111-1") }
    @Test fun rejectsAmbiguousAndForeignLinks() {
        listOf(
            "http://acornary.protium.top/i/ERERERERQRGBEQAAAAAAAQ",
            "https://acornary.protium.top.evil.test/i/ERERERERQRGBEQAAAAAAAQ",
            "https://user@acornary.protium.top/i/ERERERERQRGBEQAAAAAAAQ",
            "https://acornary.protium.top/i/ERERERERQRGBEQAAAAAAAR",
            "https://acornary.protium.top/i/ERERERERQRGBEQAAAAAAAQ?command=consume",
            "https://acornary.protium.top/i/AAAAAAAAAAAAAAAAAAAAAA"
        ).forEach { assertNull(it, ItemLink.parse(it)) }
    }
}
