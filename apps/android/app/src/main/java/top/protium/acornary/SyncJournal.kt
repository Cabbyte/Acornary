package top.protium.acornary

import android.content.Context
import android.util.AtomicFile
import android.util.Log
import java.io.File

/** Bounded operational evidence only: no account, inventory, token, URL or error payload. */
object SyncJournal {
    @Synchronized fun record(context: Context, success: Boolean, elapsed: Long) {
        val line = "${System.currentTimeMillis()},${if (success) "success" else "failure"},$elapsed"
        Log.i("AcornarySync", "${if (success) "success" else "failure"} ${elapsed}ms")
        runCatching {
            val file = AtomicFile(File(context.noBackupFilesDir, "sync-journal.csv"))
            val previous = if (file.baseFile.exists()) file.readFully().decodeToString().lines().filter { it.isNotEmpty() }.takeLast(2047) else emptyList()
            val stream = file.startWrite()
            try { stream.write((previous + line).joinToString("\n", postfix = "\n").encodeToByteArray()); file.finishWrite(stream) }
            catch (error: Exception) { file.failWrite(stream); throw error }
        }
    }
}
