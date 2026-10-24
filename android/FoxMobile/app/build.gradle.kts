plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

android {
    namespace = "com.foxbro.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.foxbro.mobile"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    // Keep Java and Kotlin bytecode targets aligned; Gradle rejects 1.8 vs 17.
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}
