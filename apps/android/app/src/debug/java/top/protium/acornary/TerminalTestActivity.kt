package top.protium.acornary

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity

/** Instrumentation host; excluded from release APKs. */
class TerminalTestActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true); setTurnScreenOn(true)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
