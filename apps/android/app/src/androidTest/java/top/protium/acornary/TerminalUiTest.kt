package top.protium.acornary

import android.app.Application
import android.content.pm.ActivityInfo
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test

class TerminalUiTest {
    @get:Rule val compose = createAndroidComposeRule<TerminalTestActivity>()
    private val household = Household("fixture", "布局测试家庭", "Asia/Shanghai")
    private fun display(item: StockItem, large: Boolean = false, reverse: Boolean = false) {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as Application
        compose.activityRule.scenario.onActivity { it.requestedOrientation = if (reverse) ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        val model = TerminalViewModel(app)
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, if (large) 1.5f else 1f)) {
                AcornaryTheme { Surface(Modifier.fillMaxSize()) { Box(Modifier.fillMaxSize().padding(androidx.compose.ui.unit.Dp(16f))) {
                    DetailPane(TerminalState(loading = false, session = SessionContext(Account("fixture","测试"), household), selected = item, online = true), model) {}
                } } }
            }
        }
    }
    @Test fun longNameAndLargeFontLeavePrimaryActionsVisible() {
        display(StockItem("fixture", "这是一个用于验证大字体和横屏布局的很长的物品名称", 1, location = "厨房 / 冰箱 / 冷藏区", remaining = Amount("500", "mL")), true, true)
        compose.onNodeWithText("开封", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("消耗", useUnmergedTree = true).assertIsDisplayed().performClick()
        compose.onNodeWithText("整件用完", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("扣减该数量", useUnmergedTree = true).assertIsDisplayed()
    }
    @Test fun endedItemKeepsCompletionStateWithoutActionButtons() {
        display(StockItem("fixture", "已消耗测试物品", 3, terminal = true, state = "CONSUMED"))
        compose.onNodeWithText("此物品已结束，不能继续消耗或开封。").assertExists()
        compose.onNodeWithText("消耗").assertDoesNotExist()
        compose.onNodeWithText("开封").assertDoesNotExist()
    }
    @Test fun containersAreReadOnly() {
        display(StockItem("fixture", "冰箱", 1, is_container = true))
        compose.onNodeWithText("容器作为位置浏览，编辑请在电脑上完成。").assertExists()
        compose.onNodeWithText("消耗").assertDoesNotExist()
    }
    @Test fun printerTestActionStaysVisibleInReverseLandscapeWithLargeFont() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as Application
        val model = TerminalViewModel(app)
        compose.activityRule.scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE }
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 1.5f)) {
                AcornaryTheme { PrinterPane(model) {} }
            }
        }
        compose.onNodeWithText("打印测试标签（1 张）").assertIsDisplayed().assertIsNotEnabled()
        compose.onNodeWithContentDescription("关闭打印窗口").assertIsDisplayed()
    }
}
