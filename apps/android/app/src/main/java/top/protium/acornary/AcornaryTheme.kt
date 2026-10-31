package top.protium.acornary

import androidx.annotation.DrawableRes
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val light = lightColorScheme(primary=Color(0xFFAB5F40), onPrimary=Color.White, primaryContainer=Color(0xFFF1E1D5), onPrimaryContainer=Color(0xFF4C2B1C),
    secondary=Color(0xFF786251), onSecondary=Color.White, secondaryContainer=Color(0xFFF1E1D5), onSecondaryContainer=Color(0xFF4C2B1C),
    background=Color(0xFFF4F1EE), onBackground=Color(0xFF191A1B), surface=Color.White, onSurface=Color(0xFF191A1B),
    surfaceVariant=Color(0xFFF4F1EE), onSurfaceVariant=Color(0xFF68615C), outline=Color(0xFF95857C), outlineVariant=Color(0xFFD8D0C9), surfaceTint=Color.Transparent)
private val dark = darkColorScheme(primary=Color(0xFFD69A79), onPrimary=Color(0xFF301B11), primaryContainer=Color(0xFF4C3022), onPrimaryContainer=Color(0xFFF8DDC9),
    secondary=Color(0xFFCCB5A5), onSecondary=Color(0xFF30251E), secondaryContainer=Color(0xFF44352C), onSecondaryContainer=Color(0xFFF0DFD2),
    background=Color(0xFF181716), onBackground=Color(0xFFF0EBE7), surface=Color(0xFF24211F), onSurface=Color(0xFFF0EBE7),
    surfaceVariant=Color(0xFF2E2824), onSurfaceVariant=Color(0xFFB8ADA5), outline=Color(0xFF897B72), outlineVariant=Color(0xFF443D38), surfaceTint=Color.Transparent)
@Composable fun AcornaryTheme(theme: String = "system", content: @Composable () -> Unit) {
    val isDark = when(theme) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    fun style(size:Int,line:Int,weight:FontWeight=FontWeight.Normal)=TextStyle(fontFamily=FontFamily.SansSerif,fontSize=size.sp,lineHeight=line.sp,fontWeight=weight)
    MaterialTheme(colorScheme=if(isDark) dark else light,
        shapes=Shapes(RoundedCornerShape(4.dp),RoundedCornerShape(8.dp),RoundedCornerShape(12.dp),RoundedCornerShape(12.dp),RoundedCornerShape(12.dp)),
        typography=Typography(titleLarge=style(18,24,FontWeight.SemiBold),titleMedium=style(16,22,FontWeight.Medium),titleSmall=style(14,20,FontWeight.Medium),
            bodyLarge=style(14,21),bodyMedium=style(14,21),bodySmall=style(12,18),labelLarge=style(14,20,FontWeight.Medium),labelMedium=style(12,16),labelSmall=style(12,16)),content=content)
}
enum class AcGlyph(@param:DrawableRes val resource: Int) {
    ITEMS(R.drawable.ac_items), SCAN(R.drawable.ac_lucide_qr_code), SETTINGS(R.drawable.ac_settings),
    SEARCH(R.drawable.ac_lucide_search), FILTER(R.drawable.ac_lucide_sliders_horizontal), SELECT(R.drawable.ac_lucide_list_checks),
    PRINT(R.drawable.ac_lucide_printer), BACK(R.drawable.ac_lucide_chevron_left), DOWN(R.drawable.ac_lucide_chevron_down),
    CLOSE(R.drawable.ac_lucide_x), REFRESH(R.drawable.ac_lucide_refresh_cw), MORE(R.drawable.ac_lucide_ellipsis),
    LOGOUT(R.drawable.ac_lucide_log_out), CHECK(R.drawable.ac_lucide_check), CLOCK(R.drawable.ac_lucide_clock),
    ALERT(R.drawable.ac_lucide_triangle_alert), INFO(R.drawable.ac_lucide_info)
}
@Composable fun AcIcon(glyph: AcGlyph, description: String? = null, modifier: Modifier = Modifier) {
    Icon(painterResource(glyph.resource),description,modifier.size(20.dp))
}

@Composable internal fun AcPanel(title: String,onClose:()->Unit,content:@Composable androidx.compose.foundation.layout.ColumnScope.()->Unit) {
    androidx.compose.ui.window.Dialog(onDismissRequest=onClose,properties=androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth=false)) {
        Surface(shape=MaterialTheme.shapes.medium,modifier=Modifier.widthIn(max=680.dp).fillMaxWidth(.94f).fillMaxHeight(.94f)) {
            androidx.compose.foundation.layout.Column(Modifier.padding(12.dp)) {
                androidx.compose.foundation.layout.Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
                    Text(title,Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
                    IconButton(onClick=onClose) {AcIcon(AcGlyph.CLOSE,"关闭$title")}
                }
                content()
            }
        }
    }
}
