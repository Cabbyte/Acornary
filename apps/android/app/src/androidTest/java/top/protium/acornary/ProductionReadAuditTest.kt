package top.protium.acornary

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.time.Instant

/** Explicit post-release check using the phone's existing session. No credential export,
 * inventory commands, printing or fake stock. Not part of the unattended emulator suite. */
class ProductionReadAuditTest {
    @Test fun freshProjectionAndAodRemainInTheAuthorizedHousehold()=runBlocking {
        val args=InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("readOnlyProductionAudit")=="true")
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val app=context.terminal
        app.ready.await()
        assertTrue("手机没有可用的默认网络",app.repository.connected())
        assertTrue("正式库存只读刷新失败",app.repository.refresh())
        val state=app.repository.state.value
        val session=requireNotNull(state.session)
        val snapshot=requireNotNull(state.snapshot)
        args.getString("expectedHousehold")?.let {assertEquals(it,session.household.id)}
        assertEquals(session.household.id,snapshot.household.id)
        assertTrue("正式快照缺少最近字段",snapshot.items.all {it.created_at!=null&&it.label_updated_at!=null})
        snapshot.items.forEach {Instant.parse(it.created_at);Instant.parse(it.label_updated_at)}
        val recent=recentItems(snapshot.items,session.household.timezone)
        val urgent=upcoming(snapshot.items,session.household.timezone)
        val ambient=context.contentResolver.query(ambientUri,null,null,null,null)!!.use {cursor->
            assertTrue(cursor.moveToFirst())
            assertEquals(session.household.name,cursor.getString(cursor.getColumnIndexOrThrow("title")))
            assertEquals(session.household.timezone,cursor.getString(cursor.getColumnIndexOrThrow("timezone")))
            cursor.getString(cursor.getColumnIndexOrThrow("lines"))
        }
        urgent.take(4).forEach {assertTrue(ambient.contains(it.name))}
        val summary=buildJsonObject {
            put("checked_at",Instant.now().toString())
            put("household",session.household.id)
            put("current_count",snapshot.items.size)
            put("recent_7_count",recent.size)
            put("urgent_count",urgent.size)
            put("all_label_times_present",true)
            put("aod_matches_urgent",true)
            put("inventory_commands",0)
            putJsonArray("top_recent") {recent.take(8).forEach {item->add(buildJsonObject {
                put("id",item.id);put("name",item.name);put("created_at",item.created_at);put("label_updated_at",item.label_updated_at)
            })}}
        }
        File(context.getExternalFilesDir("design-qa"),"production-read-check.json").writeText(summary.toString())
    }
}
