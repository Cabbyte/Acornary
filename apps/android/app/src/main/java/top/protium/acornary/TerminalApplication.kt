package top.protium.acornary

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

val ambientUri: Uri = Uri.parse("content://top.protium.acornary.ambient/snapshot")
class TerminalApplication : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    lateinit var repository: TerminalRepository
    lateinit var preferences: TerminalPreferences
    lateinit var ready: Deferred<Unit>
    override fun onCreate() {
        super.onCreate()
        val database = Room.databaseBuilder(this, TerminalDatabase::class.java, "terminal.db").build()
        preferences = TerminalPreferences(this, scope)
        repository = TerminalRepository(this, database.dao(), TerminalAuth(this))
        ready = scope.async { repository.initialize() }
        scope.launch {
            ready.await()
            combine(repository.state, preferences.state) { state, prefs -> state to prefs }.collect {
                contentResolver.notifyChange(ambientUri, null)
            }
        }
        scope.launch {
            ready.await()
            combine(repository.state.map { it.session != null }.distinctUntilChanged(), preferences.state.map { it.enabled }.distinctUntilChanged()) { signedIn, enabled -> signedIn && enabled }
                .distinctUntilChanged().collect { SyncScheduler.schedule(this@TerminalApplication, it) }
        }
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { scope.launch { ready.await(); delay(1000); repository.refresh() } }
            override fun onLost(network: Network) { scope.launch { repository.refresh() } }
        })
    }
}
val Context.terminal get() = applicationContext as TerminalApplication

class TerminalViewModel(application: Application) : AndroidViewModel(application) {
    val app = application as TerminalApplication
    val repo get() = app.repository
    val state = repo.state
    val prefs = app.preferences.state
    val printer = PrinterController(application, viewModelScope)
    init {
        viewModelScope.launch { state.map { it.session?.scope }.distinctUntilChanged().drop(1).collect { printer.disconnect() } }
    }
    override fun onCleared() { printer.disconnect(); super.onCleared() }
    val page = MutableStateFlow(0)
    val lastInteraction = MutableStateFlow(android.os.SystemClock.elapsedRealtime())
    fun interact() { lastInteraction.value = android.os.SystemClock.elapsedRealtime() }
    fun refresh() = viewModelScope.launch {
        app.ready.await()
        if (repo.refresh()) repo.state.value.pending.firstOrNull()?.let { repo.resolve(it, false) }
    }
    fun select(id: String) = viewModelScope.launch { repo.select(id) }
    fun history() = viewModelScope.launch { repo.history() }
    fun command(name: String, item: StockItem, amount: String? = null) = viewModelScope.launch {
        try { repo.command(name, item, amount) } catch (error: IllegalArgumentException) { repo.message(error.message ?: "请核对输入。") }
    }
    fun resolve(operation: PendingOperation, retry: Boolean) = viewModelScope.launch { repo.resolve(operation, retry) }
    fun preferences(transform: (TerminalPrefs) -> TerminalPrefs) = viewModelScope.launch { app.preferences.update(transform) }
    fun logout() = viewModelScope.launch { repo.logout() }
    fun callback(intent: Intent) = viewModelScope.launch {
        app.ready.await()
        when (intent.action) {
            "top.protium.acornary.AUTH_COMPLETE" -> try { repo.auth.complete(intent); repo.refresh() } catch (_: Exception) { repo.logout(false); repo.message("登录未完成，请重新登录。") }
            "top.protium.acornary.AUTH_CANCELLED" -> { repo.auth.clear(); repo.message("已取消登录。") }
        }
    }
}
