package top.protium.acornary

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiFailure(val status: Int, val code: String, override val message: String) : IOException(message)
val http = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS)
    .callTimeout(30, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()

suspend fun fetch(request: Request): String = suspendCancellableCoroutine { continuation ->
    val call = http.newCall(request)
    continuation.invokeOnCancellation { call.cancel() }
    call.enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) { if (continuation.isActive) continuation.resumeWithException(error) }
        override fun onResponse(call: Call, response: Response) {
            response.use {
                try {
                    val text = it.body?.string() ?: ""
                    if (!it.isSuccessful) {
                        val error = runCatching { wire.parseToJsonElement(text).jsonObject["error"]?.jsonObject }.getOrNull()
                        throw ApiFailure(it.code, error?.get("code")?.jsonPrimitive?.contentOrNull ?: "HTTP_ERROR",
                            error?.get("message")?.jsonPrimitive?.contentOrNull ?: "请求未完成（${it.code}）")
                    }
                    if (continuation.isActive) continuation.resume(text)
                } catch (error: Exception) { if (continuation.isActive) continuation.resumeWithException(error) }
            }
        }
    })
}

class TerminalApi(private val auth: TerminalAuth) {
    suspend fun get(path: String): String = request(path, null)
    suspend fun post(path: String, body: String): String = request(path, body)
    private suspend fun request(path: String, body: String?): String {
        require(path.startsWith('/') && !path.contains(".."))
        suspend fun send(force: Boolean): String {
            val token = auth.accessToken(force)
            val request = Request.Builder().url(API + path).header("Authorization", "Bearer $token").header("Accept", "application/json")
            if (body != null) request.post(body.toRequestBody("application/json".toMediaType()))
            return fetch(request.build())
        }
        return try { send(false) } catch (error: ApiFailure) {
            if (error.status != 401) throw error
            send(true)
        }
    }
}
