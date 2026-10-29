package top.protium.acornary

import android.app.*
import android.content.*
import android.net.Uri
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.work.*
import kotlinx.coroutines.*
import java.time.Instant
import java.util.concurrent.TimeUnit

object SyncScheduler {
    private const val work = "terminal-sync"
    private fun alarm(context: Context) = PendingIntent.getBroadcast(context, 30, Intent(context, SyncReceiver::class.java).setAction("top.protium.acornary.SYNC"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun fast(context: Context): Boolean {
        val plugged = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
        return plugged && !context.getSystemService(PowerManager::class.java).isPowerSaveMode &&
            !context.getSystemService(ActivityManager::class.java).isBackgroundRestricted &&
            !diagnostics(context).getBoolean("foregroundDenied", false) &&
            context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    }
    private fun diagnostics(context: Context) = context.getSharedPreferences("sync-diagnostics", Context.MODE_PRIVATE)
    fun description(context: Context) = if (!context.terminal.preferences.state.value.enabled) "终端模式已暂停" else if (diagnostics(context).getBoolean("foregroundDenied", false) || context.getSystemService(ActivityManager::class.java).isBackgroundRestricted) "后台同步受限：已降级为 15 分钟以上更新" else if (diagnostics(context).getBoolean("alarmFailed", false)) "精确闹钟不可用：已降级为 15 分钟以上更新" else if (fast(context)) "插电：约每 5 分钟更新" else "节能或权限降级：15 分钟以上更新"
    fun isStale(context: Context, synced: String?) = synced?.let { runCatching { System.currentTimeMillis() - Instant.parse(it).toEpochMilli() > if (fast(context) && !diagnostics(context).getBoolean("alarmFailed", false)) 600_000 else 1_800_000 }.getOrDefault(true) } ?: true
    fun foregroundDenied(context: Context) {
        diagnostics(context).edit().putBoolean("foregroundDenied", true).apply()
        context.contentResolver.notifyChange(ambientUri, null)
        schedule(context)
    }
    fun retryFromForeground(context: Context) {
        if (diagnostics(context).getBoolean("foregroundDenied", false)) {
            diagnostics(context).edit().remove("foregroundDenied").apply()
            schedule(context)
        }
    }
    fun schedule(context: Context, enabled: Boolean = context.terminal.preferences.state.value.enabled && context.terminal.repository.state.value.session != null) {
        val manager = context.getSystemService(AlarmManager::class.java)
        val wm = WorkManager.getInstance(context)
        manager.cancel(alarm(context))
        if (!enabled) { wm.cancelUniqueWork(work); return }
        // A 15-minute watchdog also recovers if an exact alarm is denied or dropped.
        wm.enqueueUniquePeriodicWork(work, ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        if (fast(context)) runCatching {
            manager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, android.os.SystemClock.elapsedRealtime() + 300_000, alarm(context))
            diagnostics(context).edit().putBoolean("alarmFailed", false).apply()
        }.onFailure { diagnostics(context).edit().putBoolean("alarmFailed", true).apply() }
    }
}
class SyncReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!context.getSystemService(UserManager::class.java).isUserUnlocked) return
        if (intent.action == "top.protium.acornary.SYNC") {
            try { context.startForegroundService(Intent(context, SyncService::class.java)) }
            catch (_: IllegalStateException) { SyncScheduler.foregroundDenied(context) }
            catch (_: SecurityException) { SyncScheduler.foregroundDenied(context) }
        } else {
            val pending = goAsync()
            context.terminal.scope.launch {
                try { context.terminal.ready.await(); SyncScheduler.schedule(context) } finally { pending.finish() }
            }
        }
    }
}
class SyncService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var job: Job? = null
    override fun onBind(intent: Intent?) = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("sync", "库存同步", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null); enableVibration(false) })
        val open = PendingIntent.getActivity(this, 31, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        startForeground(30, NotificationCompat.Builder(this, "sync").setSmallIcon(android.R.drawable.ic_popup_sync).setContentTitle("正在更新家庭库存").setSilent(true).setContentIntent(open).setOngoing(true).build())
        if (job?.isActive == true) return START_NOT_STICKY
        job = scope.launch {
            val lock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Acornary:InventorySync").apply { setReferenceCounted(false); acquire(40_000) }
            try {
                withTimeout(35_000) {
                    terminal.ready.await()
                    if (terminal.preferences.state.value.enabled && terminal.repository.auth.hasCredentials()) terminal.repository.refresh()
                }
            } finally {
                if (lock.isHeld) lock.release()
                SyncScheduler.schedule(this@SyncService)
                stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
            }
        }
        return START_NOT_STICKY
    }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext.terminal
        app.ready.await()
        if (!app.preferences.state.value.enabled || !app.repository.auth.hasCredentials()) return Result.success()
        val ok = withTimeoutOrNull(35_000) { app.repository.refresh() } == true
        SyncScheduler.schedule(applicationContext)
        return if (ok || !app.repository.auth.hasCredentials()) Result.success() else Result.retry()
    }
}
object TerminalMaintenance {
    fun apply(context: Context, enabled: Boolean): String = runCatching {
        context.contentResolver.call(Uri.parse("content://top.protium.acornary.aod.settings"), if (enabled) "enable" else "pause", null, null)?.getString("status") ?: "AOD 伴随组件尚未安装"
    }.getOrDefault("终端待机设置未授权，请通过电脑部署脚本修复")
}
