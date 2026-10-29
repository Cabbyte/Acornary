plugins { id("com.android.application") }
android {
    namespace = "top.protium.acornary.aod.overlay"
    compileSdk = 36
    val releaseKey = providers.environmentVariable("ACORNARY_ANDROID_KEYSTORE").orNull
    if (releaseKey != null) {
        signingConfigs.create("terminalRelease") {
            storeFile = file(releaseKey)
            storePassword = providers.environmentVariable("ACORNARY_ANDROID_KEY_PASSWORD").get()
            keyAlias = "acornary-terminal"
            keyPassword = storePassword
        }
        buildTypes.getByName("release").signingConfig = signingConfigs.getByName("terminalRelease")
    }

    defaultConfig {
        applicationId = "top.protium.acornary.aod.overlay"
        minSdk = 31
        targetSdk = 36
        versionCode = 2
        versionName = "0.2.0-terminal"
    }
}
