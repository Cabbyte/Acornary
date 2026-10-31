package top.protium.acornary

import android.app.AlarmManager
import androidx.activity.ComponentActivity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable internal fun SettingsPane(state:TerminalState,prefs:TerminalPrefs,model:TerminalViewModel,activity:ComponentActivity,switch:()->Unit,login:()->Unit,printer:()->Unit) {
    val page by model.settingsPage.collectAsStateWithLifecycle()
    val device by model.printer.state.collectAsStateWithLifecycle()
    var maintenance by remember {mutableStateOf("")}
    LaunchedEffect(page,prefs.enabled) {if(page=="device") maintenance=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {TerminalMaintenance.apply(activity,prefs.enabled)}}
    val title=when(page) {"account"->"账号与家庭";"terminal"->"终端与唤醒";"appearance"->"外观";"device"->"设备状态";else->"设置"}
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.heightIn(min=48.dp),verticalAlignment=Alignment.CenterVertically) {
            if(page!="root") IconButton(onClick={model.settingsPage.value="root"}) {AcIcon(AcGlyph.BACK,"返回设置")}
            Text(title,style=MaterialTheme.typography.titleLarge)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            if(page=="root") {
                SettingsLink("账号与家庭",state.session?.let {"${it.account.name} · ${it.household.name}"}?:"尚未登录") {model.settingsPage.value="account"}
                SettingsLink("打印机", "${if(device.connected) "已连接" else if(device.keepConnected) "自动重连" else "连接已暂停"} · ${LabelSize.from(prefs.labelSize).title}",printer)
                SettingsLink("终端与唤醒",if(prefs.enabled) "60 秒待机 · 双击唤醒" else "终端模式已暂停") {model.settingsPage.value="terminal"}
                SettingsLink("外观",when(prefs.theme){"light"->"浅色";"dark"->"深色";else->"跟随系统"}) {model.settingsPage.value="appearance"}
                TextButton(onClick={model.settingsPage.value="device"},modifier=Modifier.heightIn(min=48.dp)) {AcIcon(AcGlyph.INFO);Spacer(Modifier.width(8.dp));Text("设备状态")}
            } else when(page) {
                "account" -> {
                    Text(state.session?.account?.name?:"尚未登录",style=MaterialTheme.typography.titleMedium,modifier=Modifier.padding(vertical=8.dp))
                    Text(state.session?.household?.let {"${it.name} · ${it.timezone}"}?:"使用现有松仓账号连接家庭")
                    if(state.session==null) Button(onClick=login,shape=MaterialTheme.shapes.small,modifier=Modifier.padding(top=12.dp).heightIn(min=48.dp)) {Text("登录松仓")}
                    else {
                        TextButton(onClick=switch,modifier=Modifier.heightIn(min=48.dp)) {Text("切换家庭")}
                        TextButton(onClick={model.logout()},modifier=Modifier.heightIn(min=48.dp)) {AcIcon(AcGlyph.LOGOUT);Spacer(Modifier.width(8.dp));Text("退出账号")}
                    }
                }
                "terminal" -> {
                    SettingsSwitch("终端模式","60 秒无操作后待机；插电约 5 分钟同步",prefs.enabled) {next->model.preferences {it.copy(enabled=next)}}
                    SettingsSwitch("挥手唤醒","靠近后移开屏幕顶部；双击始终可用",prefs.wave,prefs.enabled) {next->model.preferences {it.copy(wave=next)}}
                }
                "appearance" -> listOf("system" to "跟随系统","light" to "浅色","dark" to "深色").forEach {(key,text)->
                    Row(Modifier.fillMaxWidth().heightIn(min=48.dp).clickable {model.preferences {it.copy(theme=key)}},verticalAlignment=Alignment.CenterVertically) {
                        RadioButton(selected=prefs.theme==key,onClick={model.preferences {it.copy(theme=key)}});Text(text)
                    }
                }
                "device" -> {
                    Text(SyncScheduler.description(activity),modifier=Modifier.padding(vertical=8.dp))
                    Text("最后同步：${friendlyDate(state.snapshot?.synced_at,state.session?.household?.timezone)}",style=MaterialTheme.typography.bodySmall)
                    TextButton(onClick={model.refresh()},enabled=state.session!=null&&!state.syncing,modifier=Modifier.heightIn(min=48.dp)) {AcIcon(AcGlyph.REFRESH);Spacer(Modifier.width(8.dp));Text("刷新库存")}
                    if(!activity.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()) TextButton(onClick={activity.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:${activity.packageName}")))}) {Text("允许精确同步闹钟")}
                    HorizontalDivider()
                    Text("$maintenance\nPixel 3 · Android ${android.os.Build.VERSION.RELEASE}\n松仓终端 ${BuildConfig.VERSION_NAME}",style=MaterialTheme.typography.bodySmall,modifier=Modifier.padding(vertical=12.dp))
                    TextButton(onClick={activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:${activity.packageName}")))}) {Text("系统权限与应用设置")}
                }
            }
        }
    }
}
@Composable private fun SettingsLink(title:String,summary:String,onClick:()->Unit) {
    ListItem(headlineContent={Text(title,style=MaterialTheme.typography.titleSmall)},supportingContent={Text(summary,style=MaterialTheme.typography.bodySmall,maxLines=1,overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis)},
        trailingContent={AcIcon(AcGlyph.BACK,modifier=Modifier.rotate(180f))},modifier=Modifier.clickable(onClick=onClick))
    HorizontalDivider()
}
@Composable private fun SettingsSwitch(title:String,summary:String,checked:Boolean,enabled:Boolean=true,onChange:(Boolean)->Unit) {
    ListItem(headlineContent={Text(title)},supportingContent={Text(summary,style=MaterialTheme.typography.bodySmall)},trailingContent={Switch(checked,onChange,enabled=enabled)})
}
