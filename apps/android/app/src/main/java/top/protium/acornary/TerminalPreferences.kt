package top.protium.acornary

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStoreFile
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.*

data class TerminalPrefs(val enabled: Boolean = true, val wave: Boolean = false, val theme: String = "system", val rotation: Int = 1, val draft: String = "")
class TerminalPreferences(context: Context, scope: CoroutineScope) {
    private val enabled = booleanPreferencesKey("enabled")
    private val wave = booleanPreferencesKey("wave")
    private val theme = stringPreferencesKey("theme")
    private val rotation = intPreferencesKey("rotation")
    private val draft = stringPreferencesKey("draft")
    private val store = PreferenceDataStoreFactory.create(scope = scope, produceFile = { context.preferencesDataStoreFile("terminal") })
    val state: StateFlow<TerminalPrefs> = store.data.map {
        TerminalPrefs(it[enabled] ?: true, it[wave] ?: false, it[theme] ?: "system", it[rotation] ?: 1, it[draft] ?: "")
    }.stateIn(scope, SharingStarted.Eagerly, TerminalPrefs())
    suspend fun update(transform: (TerminalPrefs) -> TerminalPrefs) {
        store.edit { p ->
            val next = transform(TerminalPrefs(p[enabled] ?: true, p[wave] ?: false, p[theme] ?: "system", p[rotation] ?: 1, p[draft] ?: ""))
            p[enabled] = next.enabled; p[wave] = next.wave; p[theme] = next.theme; p[rotation] = next.rotation; p[draft] = next.draft
        }
    }
}
