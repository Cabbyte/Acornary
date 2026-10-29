package top.protium.acornary

import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import net.openid.appauth.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

/** Uses actual AppAuth state and Keystore persistence, with synthetic token responses only. */
class TerminalAuthTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val config = AuthConfig(1, "synthetic-terminal", API, CALLBACK,
        "$ORIGIN/api/auth/oauth2/authorize", "$ORIGIN/api/auth/oauth2/token",
        "$ORIGIN/api/auth/oauth2/revoke", listOf("openid", "offline_access", "inventory:read", "inventory:write"))

    private fun request() = AuthorizationRequest.Builder(
        AuthorizationServiceConfiguration(Uri.parse(config.authorization_endpoint), Uri.parse(config.token_endpoint)),
        config.client_id, ResponseTypeValues.CODE, Uri.parse(CALLBACK)
    ).setScopes(config.scopes).build()

    private fun expiredRecord(): AuthRecord {
        val request = request()
        val response = AuthorizationResponse.Builder(request).setState(request.state).setAuthorizationCode("synthetic-code").build()
        val token = TokenResponse.Builder(response.createTokenExchangeRequest()).setTokenType("Bearer")
            .setAccessToken("synthetic-expired").setRefreshToken("synthetic-original-refresh")
            .setAccessTokenExpirationTime(System.currentTimeMillis() - 60_000).build()
        return AuthRecord(config, state = AuthState(response, token, null).jsonSerializeString())
    }

    private fun vault() = TokenVault(context, "test-auth-rotation.bin", "acornary.auth.rotation.test")

    @Test fun parallelExpiredRequestsRotateOnceAndPersistTheNewToken() = runBlocking {
        val vault = vault()
        try {
            vault.write(expiredRecord())
            var calls = 0
            val auth = TerminalAuth(context, vault) { request ->
                calls++
                assertEquals("synthetic-original-refresh", request.refreshToken)
                assertTrue(vault.read()!!.refreshInFlight)
                delay(100)
                TokenResponse.Builder(request).setTokenType("Bearer").setAccessToken("synthetic-new-access")
                    .setRefreshToken("synthetic-rotated-refresh").setAccessTokenExpiresIn(300L).build()
            }
            val tokens = coroutineScope { List(8) { async { auth.accessToken() } }.awaitAll() }
            assertEquals(1, calls)
            assertTrue(tokens.all { it == "synthetic-new-access" })
            assertFalse(vault.read()!!.refreshInFlight)
            assertEquals("synthetic-rotated-refresh", AuthState.jsonDeserialize(vault.read()!!.state!!).refreshToken)
        } finally { vault.clear() }
    }

    @Test fun lostRefreshResponseClearsCredentialsAndCannotReplayTheOldToken() = runBlocking {
        val vault = vault()
        try {
            vault.write(expiredRecord())
            var calls = 0
            val auth = TerminalAuth(context, vault) { calls++; throw IOException("Synthetic lost response") }
            repeat(2) { assertTrue(runCatching { auth.accessToken() }.exceptionOrNull() is LoginRequired) }
            assertEquals(1, calls)
            assertNull(vault.read())
            assertFalse(auth.hasCredentials())
        } finally { vault.clear() }
    }

    @Test fun processRestartWithRefreshInFlightRequiresLoginWithoutSendingAnything() = runBlocking {
        val vault = vault()
        try {
            vault.write(expiredRecord().copy(refreshInFlight = true))
            val reopened = vault()
            val auth = TerminalAuth(context, reopened) { error("Must not replay an uncertain refresh") }
            assertFalse(auth.hasCredentials())
            assertTrue(runCatching { auth.accessToken() }.exceptionOrNull() is LoginRequired)
        } finally { vault.clear() }
    }

    @Test fun cancelledRefreshCannotLeaveAReusableOldCredential() = runBlocking {
        val vault = vault()
        try {
            vault.write(expiredRecord())
            val started = CompletableDeferred<Unit>()
            val auth = TerminalAuth(context, vault) { started.complete(Unit); awaitCancellation() }
            val job = launch { runCatching { auth.accessToken() } }
            started.await()
            job.cancelAndJoin()
            assertNull(vault.read())
        } finally { vault.clear() }
    }

    @Test fun mismatchedCallbackStateIsRejectedBeforeCodeExchange() = runBlocking {
        val vault = vault()
        try {
            val request = request()
            assertEquals("S256", request.codeVerifierChallengeMethod)
            vault.write(AuthRecord(config, pendingState = request.state))
            val response = AuthorizationResponse.Builder(request).setState("different-state").setAuthorizationCode("synthetic-code").build()
            val auth = TerminalAuth(context, vault) { error("Untrusted callback must not exchange its code") }
            assertTrue(runCatching { auth.complete(response.toIntent()) }.exceptionOrNull() is LoginRequired)
            assertNull(vault.read())
        } finally { vault.clear() }
    }
}
