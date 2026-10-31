package top.protium.acornary

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStoreFile
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.*

data class TerminalPrefs(val enabled: Boolean = true, val wave: Boolean = false, val theme: String = "system", val rotation: Int = 1, val draft: String = "", val labelSize: String = "30x12", val printDensity: Int = 2)
class TerminalPreferences(context: Context, scope: CoroutineScope) {
    private val enabled = booleanPreferencesKey("enabled")
    private val wave = booleanPreferencesKey("wave")
    private val theme = stringPreferencesKey("theme")
    private val rotation = intPreferencesKey("rotation")
    private val draft = stringPreferencesKey("draft")
    private val labelSize = stringPreferencesKey("label_size")
    private val density = intPreferencesKey("print_density")
    private val store = PreferenceDataStoreFactory.create(scope = scope, produceFile = { context.preferencesDataStoreFile("terminal") })
    val state: StateFlow<TerminalPrefs> = store.data.map {
        read(it)
    }.stateIn(scope, SharingStarted.Eagerly, TerminalPrefs())
    suspend fun update(transform: (TerminalPrefs) -> TerminalPrefs) {
        store.edit { p ->
            val next = transform(read(p))
            p[enabled] = next.enabled; p[wave] = next.wave; p[theme] = next.theme; p[rotation] = next.rotation; p[draft] = next.draft
            p[labelSize] = LabelSize.from(next.labelSize).key; p[density] = next.printDensity.coerceIn(1, 3)
        }
    }
    private fun read(p: Preferences) = TerminalPrefs(p[enabled] ?: true, p[wave] ?: false, p[theme] ?: "system", p[rotation] ?: 1, p[draft] ?: "", LabelSize.from(p[labelSize] ?: "30x12").key, (p[density] ?: 2).coerceIn(1, 3))
}
