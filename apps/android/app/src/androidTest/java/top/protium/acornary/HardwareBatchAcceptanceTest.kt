package top.protium.acornary

import android.os.UserManager
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Explicit opt-in only. Real D101, synthetic local items, no inventory HTTP reads or writes.
 * Install manually with the existing release signature; NEVER run connectedAndroidTest on the phone.
 */
class HardwareBatchAcceptanceTest {
    @get:Rule val compose=createAndroidComposeRule<TerminalTestActivity>()
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private val fixtureScope="hardware-fixture:local-only"
    private val labels=(1..3).map {n->StockItem(
        "item_11111111-1111-4111-8111-${n.toString().padStart(12,'0')}","打印测试 $n",1,
        specification="30 × 12 mm · 非库存",location="本地测试，不对应实际物品")}
    private fun requireHardware() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("hardwareD101")=="true")
        assertTrue("重启后需先由用户解锁一次",context.getSystemService(UserManager::class.java).isUserUnlocked)
    }
    private fun screenshot(name:String) {
        compose.waitForIdle()
        instrumentation.waitForIdleSync()
        android.os.SystemClock.sleep(350)
        val directory=File(context.getExternalFilesDir("hardware-batch-qa"),"")
        directory.mkdirs()
        val bitmap=instrumentation.uiAutomation.takeScreenshot()
        File(directory,"$name.png").outputStream().use {bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
        bitmap.recycle()
    }
    private suspend fun until(check:()->Boolean)=withTimeout(90_000) {while(!check())delay(30)}

    @Test fun threeMarkedLabelsWithSelectionStopAndExplicitRecovery() {
        requireHardware()
        val app=context.terminal
        val model=TerminalViewModel(app)
        val work=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
        val db=Room.databaseBuilder(context,TerminalDatabase::class.java,"hardware-batch-acceptance.db").build()
        lateinit var journal:PrintJournal
        val displayed=mutableStateOf<PrintJournal?>(null)
        val fixture=TerminalState(loading=false,online=true)
        try {
            runBlocking {
                app.ready.await()
                withContext(Dispatchers.Main) {
                    assertFalse("存在待核对出纸，先核对原标签",app.printer.state.value.uncertain)
                    PrinterService.resume(context)
                    until {app.printer.state.value.connected&&!app.printer.state.value.busy}
                    assertTrue("本轮测试数据库已有结果，避免重复出纸",withContext(Dispatchers.IO) {db.dao().printBatches(fixtureScope).isEmpty()})
                    journal=PrintJournal(db.dao(),app.repository,app.printer,work,{fixtureScope},
                        {ids,_->ids.map {id->labels.first {it.id==id}}}, {id,_->labels.first {it.id==id}})
                    journal.scopeChanged(fixtureScope)
                    journal.open(labels,LabelSize.SMALL,2)
                    until {journal.state.value?.preparing==false}
                    displayed.value=journal
                }
            }
            compose.setContent {AcornaryTheme("light") {
                val activeJournal=displayed.value!!
                val review by activeJournal.state.collectAsState()
                Surface {Column(Modifier.fillMaxSize().padding(8.dp)) {
                    review?.let {BatchPrintPane(it,model,activeJournal,fixture) {}}
                }}
            }}
            compose.onAllNodes(isToggleable()).onLast().performClick()
            compose.onNodeWithText("开始打印 2 张").assertIsDisplayed()
            compose.onAllNodes(isToggleable()).onLast().performClick()
            compose.onNodeWithText("开始打印 3 张").performClick()
            compose.waitUntil(60_000) {app.printer.state.value.printing}
            compose.onNodeWithText("停止后续打印").performClick()
            compose.waitUntil(60_000) {journal.state.value?.busy==false&&!app.printer.state.value.busy}
            assertEquals(listOf("DONE","PENDING","PENDING"),journal.state.value!!.pages.map {it.status})
            screenshot("one-complete-two-stopped")
            runBlocking {withContext(Dispatchers.Main) {
                val rebuilt=PrintJournal(db.dao(),app.repository,app.printer,work,{fixtureScope},
                    {ids,_->ids.map {id->labels.first {it.id==id}}}, {id,_->labels.first {it.id==id}})
                rebuilt.scopeChanged(fixtureScope)
                assertEquals(2,rebuilt.state.value!!.selected.size)
                assertFalse(rebuilt.state.value!!.visible)
                rebuilt.show()
                journal=rebuilt
                displayed.value=rebuilt
            }}
            compose.onNodeWithText("打印选中的 2 张").performClick()
            compose.waitUntil(90_000) {journal.state.value?.busy==false&&!app.printer.state.value.busy&&journal.state.value?.pages?.all {it.status=="DONE"}==true}
            screenshot("three-test-labels-confirmed")
            runBlocking(Dispatchers.IO) {
                val batches=db.dao().printBatches(fixtureScope)
                val pages=batches.flatMap {db.dao().printPages(it.id)}
                assertEquals(3,pages.count {it.status=="DONE"})
                File(context.getExternalFilesDir("hardware-batch-qa"),"receipts.json").writeText(
                    "{\"confirmed\":3,\"stopped_after_first\":true,\"resumed_explicitly\":true,\"inventory_requests\":0}")
            }
        } finally {work.cancel();db.close()}
    }

    @Test fun frontCameraReadsMarkedPhysicalLabelWithoutOpeningInventory() {
        requireHardware()
        var scanned:String?=null
        compose.setContent {AcornaryTheme("light") {Surface {Row(Modifier.fillMaxSize().padding(12.dp)) {
            Box(Modifier.weight(1f).fillMaxHeight()) {CameraPane({scanned=it},{})}
            Text("请把打印测试 1／2／3 放在前摄约 10–20 cm 处",Modifier.weight(1f).padding(16.dp))
        }}}}
        compose.waitUntil(120_000) {scanned!=null}
        assertTrue(labels.any {it.id==scanned})
        screenshot("front-camera-fixture-recognized")
    }
}
