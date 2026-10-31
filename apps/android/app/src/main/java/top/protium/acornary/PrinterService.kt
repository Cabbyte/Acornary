package top.protium.acornary

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.os.UserManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/** A connected-device service keeps the BLE owner alive across Activity/AOD transitions. No wake lock. */
class PrinterService : Service() {
    override fun onBind(intent: Intent?) = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            terminal.printer.disconnect()
            stopSelf()
            return START_NOT_STICKY
        }
        if (!permitted(this) || !terminal.printer.wantsMaintenance()) { stopSelf(); return START_NOT_STICKY }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("printer", "打印机连接", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null); enableVibration(false) })
        val open = PendingIntent.getActivity(this, 41, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 42, Intent(this, PrinterService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)
        startForeground(41, NotificationCompat.Builder(this, "printer")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth).setContentTitle("D101 保持连接")
            .setContentText("待机时保持连接，断线后自动重连；不会自动打印")
            .setContentIntent(open).setOngoing(true).setSilent(true).addAction(0, "断开并暂停重连", stop).build())
        terminal.printer.startMaintenance()
        return START_STICKY
    }
    override fun onDestroy() { terminal.printer.stopMaintenance(); super.onDestroy() }
    companion object {
        private const val STOP = "top.protium.acornary.PRINTER_STOP"
        fun permitted(context: Context) = listOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)
            .all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
        fun resume(context: Context) {
            if (context.getSystemService(UserManager::class.java).isUserUnlocked && permitted(context) && context.terminal.printer.wantsMaintenance()) {
                runCatching { context.startForegroundService(Intent(context, PrinterService::class.java)) }
                    .onFailure { context.terminal.printer.message("后台连接暂不可用，请打开应用后重试。") }
            }
        }
    }
}
class PrinterReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { PrinterService.resume(context) }
}
