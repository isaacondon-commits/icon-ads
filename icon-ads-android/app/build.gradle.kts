import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties()
if (keystorePropsFile.exists()) keystoreProps.load(keystorePropsFile.inputStream())

// Shared enrollment secret sent on device registration, matched against
// ENROLLMENT_SECRET on the backend. Not a per-device credential — it just proves
// the caller is a real ICON ADS build, not an arbitrary script hitting the public
// /api/device/register endpoint with a guessed deviceId. See TECHNICAL.md.
val enrollmentPropsFile = rootProject.file("enrollment.properties")
val enrollmentProps = Properties()
if (enrollmentPropsFile.exists()) enrollmentProps.load(enrollmentPropsFile.inputStream())

android {
    namespace = "com.iconads.player"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.iconads.player"
        minSdk = 26
        targetSdk = 34
        versionCode = 4
        versionName = "1.3"

        buildConfigField("String", "BASE_URL", "\"https://icon-ads-backend.onrender.com\"")
        buildConfigField("String", "ENROLLMENT_KEY", "\"${enrollmentProps["key"] as? String ?: ""}\"")
    }

    signingConfigs {
        create("release") {
            storeFile = file(keystoreProps["storeFile"] as? String ?: "iconads-release.keystore")
            storePassword = keystoreProps["storePassword"] as? String ?: ""
            keyAlias = keystoreProps["keyAlias"] as? String ?: "iconads"
            keyPassword = keystoreProps["keyPassword"] as? String ?: ""
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            buildConfigField("String", "BASE_URL", "\"https://icon-ads-backend.onrender.com\"")
        }
        debug {
            buildConfigField("String", "BASE_URL", "\"https://icon-ads-backend.onrender.com\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }
}

dependencies {
    // Media3 (ExoPlayer)
    implementation("androidx.media3:media3-exoplayer:1.3.1")
    implementation("androidx.media3:media3-ui:1.3.1")

    // WorkManager
    implementation("androidx.work:work-runtime-ktx:2.9.0")

    // Retrofit + OkHttp + Gson
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // Coil (carga de imágenes locales)
    implementation("io.coil-kt:coil:2.6.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")

    // Room
    val roomVersion = "2.6.1"
    implementation("androidx.room:room-runtime:$roomVersion")
    implementation("androidx.room:room-ktx:$roomVersion")
    ksp("androidx.room:room-compiler:$roomVersion")

    // AndroidX
    implementation("androidx.core:core-ktx:1.13.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
}
