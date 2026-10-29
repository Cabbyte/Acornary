package top.protium.acornary

import org.junit.Assert.*
import org.junit.Test

class ItemLinkTest {
    @Test fun validLabelPreservesIdentity() {
        assertEquals("item_11111111-1111-4111-8111-000000000001", ItemLink.parse("https://acornary.protium.top/i/ERERERERQRGBEQAAAAAAAQ"))
    }
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
