package top.protium.acornary

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import kotlinx.serialization.Serializable
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Serializable data class AuthRecord(val config: AuthConfig, val state: String? = null, val pendingState: String? = null, val refreshInFlight: Boolean = false)

/** Credential-encrypted storage; unavailable until the first system unlock. */
class TokenVault(context: Context, name: String = "terminal-auth.bin", private val alias: String = "acornary.auth.v1") {
    private val file = AtomicFile(File(context.noBackupFilesDir, name))
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun read(): AuthRecord? {
        if (!file.baseFile.exists()) return null
        return runCatching {
            val bytes = file.readFully()
            require(bytes.size > 28)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            wire.decodeFromString<AuthRecord>(cipher.doFinal(bytes.copyOfRange(12, bytes.size)).decodeToString())
        }.getOrElse { file.delete(); null }
    }
    @Synchronized fun write(value: AuthRecord) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val bytes = cipher.iv + cipher.doFinal(wire.encodeToString(value).encodeToByteArray())
        val stream = file.startWrite()
        try { stream.write(bytes); file.finishWrite(stream) } catch (error: Exception) { file.failWrite(stream); throw error }
    }
    @Synchronized fun clear() = file.delete()
}
