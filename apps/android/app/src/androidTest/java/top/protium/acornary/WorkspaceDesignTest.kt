package top.protium.acornary

import android.app.Application
import android.content.pm.ActivityInfo
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.Bitmap
import java.io.File
import java.time.Instant
import org.junit.Rule
import org.junit.Test

/** Fixture UI only; never submit a real inventory command. Full suite runs on the isolated emulator. */
class WorkspaceDesignTest {
 @get:Rule val compose=createAndroidComposeRule<TerminalTestActivity>()
 private val item=StockItem("item_11111111-1111-4111-8111-000000000001","原味鲜奶",1,location="厨房 / 冰箱 / 冷藏",remaining=Amount("500","mL"),specification="500 mL / 盒",expiry_date="2026-11-15",label_updated_at=Instant.now().toString())
 private val household=Household("fixture","布局测试家庭","Asia/Shanghai")
 private val fixture=TerminalState(loading=false,online=true,session=SessionContext(Account("fixture","测试"),household),snapshot=StockSnapshot(household=household,synced_at=Instant.now().toString(),items=listOf(item,item.copy(id="item_11111111-1111-4111-8111-000000000002",name="长名称测试：家庭常备低糖酸奶原味大包装"))),selected=item)
 private fun model()=TerminalViewModel(InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as Application)
 private fun screenshot(name:String) {
  compose.waitForIdle()
  InstrumentationRegistry.getInstrumentation().waitForIdleSync()
  android.os.SystemClock.sleep(350) // Let the window manager finish rotation and display the drawn frame.
  val ctx=InstrumentationRegistry.getInstrumentation().targetContext
  val file=File(ctx.getExternalFilesDir("design-qa"),name+".png");file.parentFile!!.mkdirs()
  val bitmap=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
  file.outputStream().use {bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}
  bitmap.recycle()
  // Fixture-only evidence survives Gradle's removal of the isolated test application.
  val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
  for(command in listOf("mkdir -p /sdcard/Download/acornary-design-qa", "cp ${file.absolutePath} /sdcard/Download/acornary-design-qa/$name.png")) {
   android.os.ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand(command)).use {it.readBytes()}
  }
 }
 private fun workspace(width:Int=785,height:Int=360,scale:Float=1f,reverse:Boolean=false,dark:Boolean=false) {
  val model=model()
  compose.activityRule.scenario.onActivity {it.requestedOrientation=if(reverse)ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE}
  compose.setContent {
   val density=LocalDensity.current
   CompositionLocalProvider(LocalDensity provides Density(density.density,scale)) {
    AcornaryTheme(if(dark)"dark" else "light") {
     Box(Modifier.fillMaxSize(),contentAlignment=androidx.compose.ui.Alignment.Center) {
      Surface(Modifier.widthIn(max=width.dp).fillMaxWidth().heightIn(max=height.dp).fillMaxHeight()) {TerminalWorkspace(fixture,model,compose.activity)}
     }
    }
   }
  }
 }
 @Test fun recentDualPaneOn600dpAndLargeFontsKeepsActionsVisible() {
  workspace(600,360,1.5f,true)
  compose.onNodeWithText("最近",useUnmergedTree=true).assertIsDisplayed()
  compose.onNodeWithText("消耗",useUnmergedTree=true).assertIsDisplayed()
  compose.onNodeWithContentDescription("批量打印当前结果").assertIsDisplayed()
  compose.onNodeWithText("临期提醒").assertDoesNotExist()
  screenshot("workspace-600-reverse-150")
 }
 @Test fun normalAndDarkBrandWorkspaceUsesSameCompactNavigation() {
  workspace(dark=true)
  compose.onNodeWithText("物品",useUnmergedTree=true).assertIsDisplayed()
  compose.onNodeWithText("扫码",useUnmergedTree=true).assertIsDisplayed()
  compose.onNodeWithText("设置",useUnmergedTree=true).assertIsDisplayed()
  screenshot("workspace-pixel3-dark")
 }
 @Test fun mediumFontAndConsumptionKeyboardKeepBothExplicitSubmitsVisible() {
  workspace(scale=1.3f)
  screenshot("workspace-pixel3-light-130")
  compose.onNodeWithText("消耗",useUnmergedTree=true).performClick()
  compose.onNodeWithText("消耗量（mL）").performClick().performTextInput("50")
  android.os.SystemClock.sleep(500)
  compose.waitForIdle()
  compose.onNodeWithText("整件用完",useUnmergedTree=true).assertIsDisplayed()
  compose.onNodeWithText("扣减该数量",useUnmergedTree=true).assertIsDisplayed()
  screenshot("consumption-keyboard-130")
 }
 @Test fun searchReplacesToolbarRatherThanAddingAnotherRow() {
  workspace()
  compose.onNodeWithContentDescription("搜索物品").performClick()
  compose.onNodeWithTag("inventory-search").assertIsDisplayed().performTextInput("牛奶")
  compose.onNodeWithContentDescription("退出搜索").assertIsDisplayed()
  screenshot("workspace-search-keyboard")
 }
 @Test fun batchPreviewAndStopLayoutHaveSinglePrimaryAction() {
  val model=model()
  val pages=listOf(BatchLabel(item,printFingerprint(item,LabelSize.SMALL)),BatchLabel(item.copy(id="item_11111111-1111-4111-8111-000000000002",name="新的测试标签"),"fixture2"))
  val review=BatchReview("fixture:fixture",LabelSize.SMALL,2,pages,pages.map {it.item.id}.toSet())
  compose.activityRule.scenario.onActivity {it.requestedOrientation=ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE}
  compose.setContent {AcornaryTheme {Column(Modifier.fillMaxSize().padding(12.dp)) {BatchPrintPane(review,model) {}}}}
  compose.onNodeWithText("开始打印 2 张").assertIsDisplayed().assertIsNotEnabled()
  screenshot("batch-preview")
 }
}
