package top.protium.acornary

import android.content.Context
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.UUID

class PrintJournalTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private class Link: D101Link {
  var closed=false;var failPage=false
  val commands=mutableListOf<Int>()
  override suspend fun connect(address:String) {}
  override suspend fun exchange(command:Int,data:ByteArray,response:Int?):NiimbotPacket? {
   check(!closed);delay(1);commands.add(command)
   if(failPage&&command==0xe3) throw IOException("fixture lost acknowledgement")
   val payload=when(command){0xc1->byteArrayOf(1);0x40->byteArrayOf(10,0);0xdc->ByteArray(13).also {it[9]=1;it[10]=4};0xa3->byteArrayOf(0,1,100,100);else->byteArrayOf(1)}
   return response?.let {NiimbotPacket(it,payload)}
  }
  override fun close(){closed=true}
 }
 private class Fixture(val owner:PrinterController,val db:TerminalDatabase,val scope:CoroutineScope,val link:Link) {
  var account:String?="account:household"
  val source=(1..3).map {i->StockItem("item_11111111-1111-4111-8111-${i.toString().padStart(12,'0')}","打印测试 $i",1,specification="500 mL")}.associateBy {it.id}.toMutableMap()
  var beforeMany:suspend ()->Unit={}
  var beforeOne:suspend (StockItem)->StockItem={it}
  lateinit var journal:PrintJournal
  fun newJournal()=PrintJournal(db.dao(),contextForRepo().terminal.repository,owner,scope,{account},
   {ids,_->beforeMany();ids.map {source.getValue(it)}},{id,_->beforeOne(source.getValue(id))})
  private fun contextForRepo()=InstrumentationRegistry.getInstrumentation().targetContext
 }
 private suspend fun until(test:()->Boolean)=withTimeout(15_000){while(!test())delay(10)}
 private fun fixture(test:suspend (Fixture)->Unit)=runBlocking {
  withContext(Dispatchers.Main) {
   val name="batch-fixture-${UUID.randomUUID()}"
   val memory=PrinterMemory(context,name)
   val work=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
   val link=Link()
   val owner=PrinterController(context,work,memory,{true},{_,_->link})
   val db=Room.inMemoryDatabaseBuilder(context,TerminalDatabase::class.java).build()
   val f=Fixture(owner,db,work,link)
   PrintRecovery(context).clear()
   try {
    f.journal=f.newJournal();f.journal.scopeChanged(f.account)
    owner.connect(PrinterDevice("02:00:00:00:00:01","D101 fixture"),automatic=true)
    until {owner.state.value.connected}
    test(f)
   } finally {
    owner.stopMaintenance();work.coroutineContext[Job]!!.cancelAndJoin();db.close()
    context.getSharedPreferences(name,Context.MODE_PRIVATE).edit().clear().commit()
    PrintRecovery(context).clear()
   }
  }
 }
 private suspend fun prepare(f:Fixture) {
  f.journal.open(f.source.values.toList(),LabelSize.SMALL,2)
  until {f.journal.state.value?.preparing==false}
 }
 @Test fun completedReceiptsExcludeUnchangedLabelsButIncludeEditedLabel()=fixture {f->
  prepare(f);assertEquals(3,f.journal.state.value!!.selected.size)
  f.journal.start();until {f.journal.state.value?.id!=null&&f.journal.state.value?.busy==false&&!f.owner.state.value.busy}
  assertEquals(3,f.link.commands.count {it==0x01})
  assertTrue(f.journal.state.value!!.pages.all {it.status=="DONE"})
  prepare(f);assertTrue(f.journal.state.value!!.selected.isEmpty())
  val item=f.source.values.first();f.source[item.id]=item.copy(name="新的名称")
  prepare(f);assertEquals(setOf(item.id),f.journal.state.value!!.selected)
  assertEquals(3,f.link.commands.count {it==0x01})
 }
 @Test fun explicitStopFinishesCurrentPageAndRestoresOnlyUnfinishedPagesWithoutReplay()=fixture {f->
  prepare(f);f.journal.start();until {f.journal.state.value!!.pages.any {it.status=="SENDING"}}
  f.owner.requestStop();until {!f.journal.state.value!!.busy&&!f.owner.state.value.busy}
  assertEquals(listOf("DONE","PENDING","PENDING"),f.journal.state.value!!.pages.map {it.status})
  val restored=f.newJournal();restored.scopeChanged(f.account)
  assertFalse(restored.state.value!!.visible);assertEquals(2,restored.state.value!!.selected.size)
  delay(100);assertEquals(1,f.link.commands.count {it==0x01})
 }
 @Test fun lostResponseRestoresUncertainPageAndRequiresExplicitPaperAcknowledgement()=fixture {f->
  f.link.failPage=true;prepare(f);f.journal.start();until {f.journal.state.value?.id!=null&&!f.journal.state.value!!.busy&&!f.owner.state.value.busy}
  assertEquals("UNCERTAIN",f.journal.state.value!!.pages.first().status)
  assertTrue(PrintRecovery(context).pending())
  val restored=f.newJournal();restored.scopeChanged(f.account)
  assertEquals("UNCERTAIN",restored.state.value!!.pages.first().status)
  assertEquals(1,f.link.commands.count {it==0x01})
  restored.start();delay(50);assertEquals(1,f.link.commands.count {it==0x01})
  val id=restored.state.value!!.pages.first().item.id
  restored.acknowledge(id,true);until {restored.state.value!!.pages.first().status=="CONFIRMED"}
  assertFalse(PrintRecovery(context).pending())
 }
 @Test fun preparationCannotContinueAfterApplicationGoesToBackground()=fixture {f->
  prepare(f);val entered=CompletableDeferred<Unit>();val gate=CompletableDeferred<Unit>()
  f.beforeMany={entered.complete(Unit);gate.await()}
  f.journal.start();entered.await();f.journal.background();gate.complete(Unit);delay(100)
  assertFalse(f.journal.state.value!!.preparing);assertEquals(0,f.link.commands.count {it==0x01})
 }
 @Test fun forcedBackgroundDuringPhysicalPagePreservesUncertainReceiptAndStopsRemainingPages()=fixture {f->
  prepare(f);f.journal.start();until {f.link.commands.contains(0x01)}
  f.journal.background();f.owner.background()
  until {!f.journal.state.value!!.busy&&!f.owner.state.value.busy}
  assertEquals(listOf("UNCERTAIN","PENDING","PENDING"),f.journal.state.value!!.pages.map {it.status})
  val restored=f.newJournal();restored.scopeChanged(f.account)
  assertEquals("UNCERTAIN",restored.state.value!!.pages.first().status)
  delay(100);assertEquals(1,f.link.commands.count {it==0x01})
 }
 @Test fun unrelatedRevisionDoesNotBlockButChangedLabelRequiresAnotherConfirmation()=fixture {f->
  prepare(f)
  val item=f.source.values.first();f.source[item.id]=item.copy(revision=10,location="新的位置",remaining=Amount("10","mL"))
  f.journal.start();until {f.journal.state.value?.id!=null&&!f.journal.state.value!!.busy&&!f.owner.state.value.busy}
  assertEquals(3,f.link.commands.count {it==0x01})
  f.source[item.id]=item.copy(name="规格更新后的标签")
  prepare(f);f.source[item.id]=f.source.getValue(item.id).copy(specification="250 mL")
  f.journal.start();until {!f.journal.state.value!!.preparing}
  assertNull(f.journal.state.value!!.id);assertTrue(f.journal.state.value!!.message!!.contains("资料已变化"))
  assertEquals(3,f.link.commands.count {it==0x01})
 }
 @Test fun perPageFreshReadStopsBeforeSendingChangedSecondPage()=fixture {f->
  prepare(f)
  val second=f.source.values.elementAt(1).id
  f.beforeOne={item->if(item.id==second) item.copy(name="期间改名") else item}
  f.journal.start();until {f.journal.state.value?.id!=null&&!f.journal.state.value!!.busy&&!f.owner.state.value.busy}
  assertEquals(1,f.link.commands.count {it==0x01})
  assertEquals(listOf("DONE","PENDING","PENDING"),f.journal.state.value!!.pages.map {it.status})
  assertFalse(PrintRecovery(context).pending())
 }
 @Test fun scopeIsolationAndSelectionLimitDoNotSilentlyTruncate()=fixture {f->
  val many=(1..101).map {i->StockItem("item_11111111-1111-4111-8111-${i.toString().padStart(12,'0')}","测试 $i",1)}
  f.journal.open(many,LabelSize.SMALL,2);until {f.journal.state.value?.preparing==false}
  assertEquals(101,f.journal.state.value!!.pages.size);assertTrue(f.journal.state.value!!.selected.isEmpty())
  f.journal.selectAll();assertTrue(f.journal.state.value!!.selected.isEmpty())
  f.account="other:household";f.journal.scopeChanged(f.account)
  assertNull(f.journal.state.value)
 }
}
