package top.protium.acornary

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.icu.text.BreakIterator
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.google.zxing.qrcode.encoder.Encoder
import java.time.LocalDate
import java.util.Locale

enum class LabelSize(val key: String, val title: String, val width: Int, val height: Int, val scale: Int) {
    SMALL("30x12", "30 × 12 mm", 240, 96, 2), LARGE("40x20", "40 × 20 mm", 320, 160, 3);
    companion object { fun from(key: String) = entries.find { it.key == key } ?: SMALL }
}

data class LabelContent(val name: String, val specification: String, val dateTitle: String, val date: String?, val suffix: String, val url: String) {
    companion object {
        fun item(item: StockItem) = LabelContent(item.name, item.specification, when(item.expiry_kind) {
            "ESTIMATED" -> "计划吃完"; "USE_BY" -> "保质期"; "BEST_BEFORE" -> "最佳食用期"; else -> "到期日期"
        }, item.expiry_date, item.id.takeLast(6).lowercase(Locale.ROOT), ItemLink.encode(item.id))
        fun test(size: LabelSize) = LabelContent("打印测试", size.title + " · 松仓", "测试日期", LocalDate.now().toString(), "TEST",
            "acornary:print-test:${size.key}:000000000000000000000000000")
    }
}

object LabelRenderer {
    fun render(content: LabelContent, size: LabelSize): Bitmap {
        val small = size == LabelSize.SMALL
        val bitmap = Bitmap.createBitmap(size.width, size.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap); canvas.drawColor(-1)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff000000.toInt() }
        val margin = if (small) 5f else 8f
        val textWidth = if (small) 140f else 170f
        fun text(value: String, x: Float, top: Float) { canvas.drawText(value, x, top - paint.fontMetrics.ascent, paint) }
        paint.typeface = Typeface.create("sans-serif", Typeface.BOLD); paint.textSize = if (small) 16f else 20f
        lines(content.name, paint, textWidth, 2).forEachIndexed { index, line -> text(line, margin, (if (small) 4f else 8f) + index * (if (small) 18f else 25f)) }
        paint.typeface = Typeface.create("sans-serif", Typeface.NORMAL); paint.textSize = if (small) 12f else 16f
        lines(content.specification, paint, textWidth, if (small) 1 else 2).forEachIndexed { index, line -> text(line, margin, (if (small) 44f else 64f) + index * 19f) }
        if (content.date != null) {
            paint.textSize = if (small) 11f else 14f; text(content.dateTitle, margin, if (small) 63f else 114f)
            paint.textSize = if (small) 14f else 18f; text(content.date, margin, if (small) 77f else 135f)
        }
        val qr = Encoder.encode(content.url, ErrorCorrectionLevel.M, mapOf(EncodeHintType.CHARACTER_SET to "UTF-8")).matrix
        val qrSize = (qr.width + 8) * size.scale
        require(qrSize <= if (small) 84 else 126) { "链接过长，无法在该尺寸上清晰打印。" }
        val qrX = size.width - qrSize - margin; val qrY = if (small) 0f else 8f
        paint.isAntiAlias = false
        for (y in 0 until qr.height) for (x in 0 until qr.width) if (qr.get(x, y).toInt() == 1) {
            val left = qrX + (x + 4) * size.scale; val top = qrY + (y + 4) * size.scale
            canvas.drawRect(left, top, left + size.scale, top + size.scale, paint)
        }
        paint.isAntiAlias = true; paint.typeface = Typeface.MONOSPACE; paint.textSize = if (small) 9f else 12f; paint.textAlign = Paint.Align.CENTER
        text(content.suffix, qrX + qrSize / 2f, if (small) 86f else 139f)
        val pixels = IntArray(size.width * size.height); bitmap.getPixels(pixels, 0, size.width, 0, 0, size.width, size.height)
        for (i in pixels.indices) pixels[i] = if ((pixels[i] shr 16 and 255) < 180) 0xff000000.toInt() else -1
        bitmap.setPixels(pixels, 0, size.width, 0, 0, size.width, size.height)
        return bitmap
    }
    fun raster(bitmap: Bitmap): PrinterRaster {
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        return PrinterRaster(bitmap.width, bitmap.height, pixels)
    }
    internal fun lines(value: String, paint: Paint, width: Float, maximum: Int): List<String> {
        val clean = value.replace(Regex("\\s+"), " ").trim()
        val iterator = BreakIterator.getCharacterInstance(Locale.CHINESE).apply { setText(clean) }
        val characters = mutableListOf<String>(); var from = iterator.first(); var to = iterator.next()
        while (to != BreakIterator.DONE) { characters.add(clean.substring(from, to)); from = to; to = iterator.next() }
        val lines = mutableListOf<String>(); var next = 0
        repeat(maximum) { row ->
            if (next >= characters.size) return@repeat
            val line = mutableListOf<String>()
            while (next < characters.size && paint.measureText((line + characters[next]).joinToString("")) <= width) line.add(characters[next++])
            if (next < characters.size && (row == maximum - 1 || line.isEmpty())) {
                while (line.isNotEmpty() && paint.measureText(line.joinToString("") + "…") > width) line.removeAt(line.lastIndex)
                line.add("…"); next = characters.size
            }
            lines.add(line.joinToString(""))
        }
        return lines
    }
}
