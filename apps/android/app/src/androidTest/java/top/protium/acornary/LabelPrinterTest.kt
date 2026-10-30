package top.protium.acornary

import android.graphics.Paint
import androidx.test.platform.app.InstrumentationRegistry
import com.google.zxing.*
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import org.junit.Assert.*
import org.junit.Test

class LabelPrinterTest {
    private val item = StockItem("item_11111111-1111-4111-8111-000000000001", "中文长名称测试家庭库存物品", 1,
        specification = "500 mL / 包 · 原味", expiry_date = "2026-11-15", expiry_kind = "ESTIMATED")
    @Test fun bothPaperSizesDecodeExactInventoryIdFromFinalMonochromeBitmap() {
        LabelSize.entries.forEach { size ->
            val bitmap = LabelRenderer.render(LabelContent.item(item), size)
            val pixels = IntArray(bitmap.width * bitmap.height); bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
            assertTrue(pixels.all { it == -1 || it == 0xff000000.toInt() })
            val decoded = QRCodeReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(bitmap.width, bitmap.height, pixels))))
            assertEquals(item.id, ItemLink.parse(decoded.text))
            assertEquals(size.width, bitmap.width); assertEquals(size.height, bitmap.height)
        }
    }
    @Test fun sampleLabelsAreNeverInventoryLinks() {
        LabelSize.entries.forEach { size ->
            val content = LabelContent.test(size)
            assertNull(ItemLink.parse(content.url))
            val bitmap = LabelRenderer.render(content, size)
            val pixels = IntArray(bitmap.width * bitmap.height); bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
            assertEquals(content.url, QRCodeReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(bitmap.width, bitmap.height, pixels)))).text)
        }
    }
    @Test fun longNameTruncatesAtGraphemesAndKeepsFontSize() {
        val paint = Paint().apply { textSize = 16f }
        val lines = LabelRenderer.lines("家庭👨‍👩‍👧‍👦冷藏酸奶很长很长的名字", paint, 80f, 2)
        assertEquals(2, lines.size); assertTrue(lines.last().endsWith("…"))
        assertTrue(lines.all { paint.measureText(it) <= 80f })
        assertEquals(16f, paint.textSize, 0.01f)
    }
    @Test fun processRecreationRetainsOnlyUncertainMarkerAndAcknowledgementClearsIt() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val recovery = PrintRecovery(context)
        try {
            recovery.clear(); recovery.mark()
            assertTrue(PrintRecovery(context).pending())
            PrintRecovery(context).clear()
            assertFalse(recovery.pending())
        } finally { recovery.clear() }
    }
}
