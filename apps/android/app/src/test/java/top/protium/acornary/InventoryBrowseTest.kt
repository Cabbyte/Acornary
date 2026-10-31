package top.protium.acornary

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class InventoryBrowseTest {
 private val id="item_11111111-1111-4111-8111-000000000001"
 private val item=StockItem(id,"牛奶",1,specification="500 mL",expiry_date="2026-12-01",label_updated_at="2026-10-25T07:00:00Z")
 @Test fun recentUsesSevenHouseholdCalendarDaysAndStableTies() {
  val now=Instant.parse("2026-10-31T07:30:00Z")
  val inside=item.copy(label_updated_at="2026-10-25T07:00:00Z")
  val before=item.copy(id="old",label_updated_at="2026-10-25T06:59:59Z")
  val future=item.copy(id="future",label_updated_at="2026-10-31T07:31:00Z")
  val items=recentItems(listOf(before,inside,future,item.copy(id="container",is_container=true),item.copy(id="ended",terminal=true)),"America/Los_Angeles",7,now)
  assertEquals(listOf(id),items.map {it.id})
  assertTrue(recentItems(listOf(item.copy(label_updated_at=null)),"Asia/Shanghai",7,now).isEmpty())
 }
 @Test fun todayStartsAtHouseholdMidnightRatherThanDeviceMidnight() {
  val now=Instant.parse("2026-10-31T00:30:00Z")
  val candidate=item.copy(label_updated_at="2026-10-30T22:00:00Z")
  assertEquals(1,recentItems(listOf(candidate),"Asia/Shanghai",1,now).size)
  assertTrue(recentItems(listOf(candidate),"UTC",1,now).isEmpty())
 }
 @Test fun fingerprintTracksVisibleContentPaperAndIdentityButNotRevisionQuantityOrMovement() {
  val a=printFingerprint(item,LabelSize.SMALL)
  assertEquals(a,printFingerprint(item.copy(revision=9,location="冰箱",remaining=Amount("50","mL"),opened_at="2026-10-31T00:00:00Z"),LabelSize.SMALL))
  assertNotEquals(a,printFingerprint(item.copy(name="新名称"),LabelSize.SMALL))
  assertNotEquals(a,printFingerprint(item,LabelSize.LARGE))
  assertNotEquals(a,printFingerprint(item.copy(specification="250 mL"),LabelSize.SMALL))
 }
 @Test fun invisibleDateKindIsNotAReprintCandidate() {
  val unknown=item.copy(expiry_date=null)
  assertEquals(printFingerprint(unknown,LabelSize.SMALL),printFingerprint(unknown.copy(expiry_kind="BEST_BEFORE"),LabelSize.SMALL))
 }
}
