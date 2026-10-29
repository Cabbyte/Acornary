package top.protium.acornary

import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import net.openid.appauth.*
import okhttp3.FormBody
import okhttp3.Request
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class LoginRequired : Exception("请重新登录松仓。")

class TerminalAuth(private val context: Context) {
    private val vault = TokenVault(context)
    private val mutex = Mutex()
    private val service = AuthorizationService(context)
    fun hasCredentials(): Boolean = vault.read()?.let { it.state != null && !it.refreshInFlight } == true

    suspend fun begin(activity: Activity, forceLogin: Boolean = false) {
        val config = wire.decodeFromString<AuthConfig>(fetch(Request.Builder().url("$API/config").build())).also { it.validate() }
        val request = AuthorizationRequest.Builder(
            AuthorizationServiceConfiguration(Uri.parse(config.authorization_endpoint), Uri.parse(config.token_endpoint)),
            config.client_id, ResponseTypeValues.CODE, Uri.parse(CALLBACK)
        ).setScopes(config.scopes).setAdditionalParameters(mapOf("resource" to API))
            .apply { if (forceLogin) setPrompt("login") }.build()
        mutex.withLock { withContext(Dispatchers.IO) { vault.write(AuthRecord(config, pendingState = request.state)) } }
        val complete = PendingIntent.getActivity(context, 10, Intent(context, MainActivity::class.java)
            .setAction("top.protium.acornary.AUTH_COMPLETE").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
        val cancel = PendingIntent.getActivity(context, 11, Intent(context, MainActivity::class.java)
            .setAction("top.protium.acornary.AUTH_CANCELLED").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        withContext(Dispatchers.Main) { service.performAuthorizationRequest(request, complete, cancel) }
    }

    suspend fun complete(intent: Intent) = mutex.withLock {
        val record = withContext(Dispatchers.IO) { vault.read() } ?: throw LoginRequired()
        val response = AuthorizationResponse.fromIntent(intent)
        val error = AuthorizationException.fromIntent(intent)
        if (response == null || error != null || response.state != record.pendingState || record.pendingState == null ||
            response.request.clientId != record.config.client_id || response.request.redirectUri.toString() != CALLBACK) {
            withContext(Dispatchers.IO) { vault.clear() }; throw LoginRequired()
        }
        // A code exchange is single-use too. A process crash cannot replay it.
        withContext(Dispatchers.IO) { vault.write(record.copy(pendingState = null)) }
        val token = exchange(response.createTokenExchangeRequest(mapOf("resource" to API)))
        if (token.refreshToken == null) throw LoginRequired()
        val state = AuthState(response, null).apply { update(token, null) }
        require(state.isAuthorized)
        withContext(Dispatchers.IO) { vault.write(record.copy(state = state.jsonSerializeString(), pendingState = null)) }
    }

    suspend fun accessToken(forceRefresh: Boolean = false): String = mutex.withLock {
        val record = withContext(Dispatchers.IO) { vault.read() } ?: throw LoginRequired()
        if (record.refreshInFlight || record.state == null) throw LoginRequired()
        val state = AuthState.jsonDeserialize(record.state)
        if (!state.isAuthorized) throw LoginRequired()
        if (forceRefresh) state.setNeedsTokenRefresh(true)
        if (state.needsTokenRefresh) {
            if (state.refreshToken == null) throw LoginRequired()
            withContext(Dispatchers.IO) { vault.write(record.copy(refreshInFlight = true)) }
            try {
                val rotated = exchange(state.createTokenRefreshRequest(mapOf("resource" to API)))
                if (rotated.refreshToken == null || rotated.refreshToken == state.refreshToken) throw LoginRequired()
                state.update(rotated, null)
                withContext(Dispatchers.IO) { vault.write(record.copy(state = state.jsonSerializeString(), refreshInFlight = false)) }
            } catch (error: Exception) {
                // Strict server rotation: a lost response must never reuse the old refresh token.
                withContext(NonCancellable + Dispatchers.IO) { vault.clear() }
                throw LoginRequired()
            }
        }
        state.accessToken ?: throw LoginRequired()
    }

    private suspend fun exchange(request: TokenRequest): TokenResponse = suspendCancellableCoroutine { continuation ->
        service.performTokenRequest(request) { response, error ->
            if (continuation.isActive) {
                if (response != null && error == null) continuation.resume(response)
                else continuation.resumeWithException(LoginRequired())
            }
        }
    }
    suspend fun logout() = mutex.withLock {
        val old = withContext(Dispatchers.IO) { vault.read().also { vault.clear() } }
        val refresh = old?.state?.let { runCatching { AuthState.jsonDeserialize(it).refreshToken }.getOrNull() }
        if (refresh != null) runCatching {
            fetch(Request.Builder().url(old.config.revocation_endpoint).post(FormBody.Builder()
                .add("client_id", old.config.client_id).add("token", refresh).add("token_type_hint", "refresh_token").build()).build())
        }
    }
    suspend fun clear() = mutex.withLock { withContext(Dispatchers.IO) { vault.clear() } }
}
