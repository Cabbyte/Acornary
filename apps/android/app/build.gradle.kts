plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}
android {
    namespace = "top.protium.acornary"
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
        applicationId = "top.protium.acornary"
        minSdk = 31
        targetSdk = 36
        versionCode = 4
        versionName = "0.3.1-terminal"
        manifestPlaceholders["appAuthRedirectScheme"] = "top.protium.acornary"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.08.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("net.openid:appauth:0.11.1")
    implementation("androidx.room:room-runtime:2.8.3")
    annotationProcessor("androidx.room:room-compiler:2.8.3")
    implementation("androidx.datastore:datastore-preferences:1.1.7")
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.08.01"))
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    implementation("androidx.camera:camera-camera2:1.4.2")
    implementation("androidx.camera:camera-lifecycle:1.4.2")
    implementation("androidx.camera:camera-view:1.4.2")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    implementation("com.google.zxing:core:3.5.3")
    testImplementation("junit:junit:4.13.2")
}
