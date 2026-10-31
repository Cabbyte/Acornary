package top.protium.acornary

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.*

class MainActivity : ComponentActivity() {
    private val model by viewModels<TerminalViewModel>()
    var lastInteraction by mutableLongStateOf(SystemClock.elapsedRealtime())
        private set
    override fun onUserInteraction() { super.onUserInteraction(); lastInteraction = SystemClock.elapsedRealtime(); model.interact() }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        if (savedInstanceState == null) model.callback(intent)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.RESUMED) {
                PrinterService.resume(this@MainActivity)
                SyncScheduler.retryFromForeground(this@MainActivity)
                launch {
                    while (isActive) { model.refresh().join(); delay(60_000) }
                }
                launch {
                    model.app.preferences.state.collect { prefs ->
                        withContext(Dispatchers.IO) { TerminalMaintenance.apply(this@MainActivity, prefs.enabled) }
                    }
                }
                val rotation = display?.rotation ?: 1
                if (rotation in listOf(1, 3)) model.preferences { it.copy(rotation = rotation) }
            }
        }
        setContent {
            val prefs by model.prefs.collectAsState()
            AcornaryTheme(prefs.theme) {
                Surface(Modifier.fillMaxSize()) { TerminalScreen(model, this) }
            }
        }
    }
    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        val rotation = display?.rotation ?: 1
        if (rotation in listOf(1, 3)) model.preferences { it.copy(rotation = rotation) }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); model.callback(intent) }
    override fun onStop() { model.printJournal.background(); model.printer.background(); super.onStop(); window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    fun keepAwake(keep: Boolean) {
        if (keep) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
