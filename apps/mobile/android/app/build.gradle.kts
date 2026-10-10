import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing - loaded from android/key.properties (gitignored; written by CI from
// secrets, or created locally pointing at the keystore in docs/secrets/). Falls back to
// debug signing when absent so `flutter run --release` keeps working without it.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
val hasReleaseSigning = keystorePropertiesFile.exists()
if (hasReleaseSigning) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    namespace = "com.rajendrakhope.sevarath"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // AGP 8 disables resValue() by default - needed below for each flavor's app_name.
    buildFeatures {
        resValues = true
    }

    defaultConfig {
        applicationId = "com.rajendrakhope.sevarath"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Two installable apps from one codebase (docs/architecture.md §7.2): `user` keeps today's
    // applicationId/name unchanged (no suffix) so it stays the same app for anyone who already
    // installed it; `driver` gets a distinct applicationId (installable side by side) and app
    // name. Paired with `lib/main_user.dart`/`lib/main_driver.dart` via
    // `flutter build apk --flavor user -t lib/main_user.dart` (or `driver`/`main_driver.dart`).
    flavorDimensions += "app"
    productFlavors {
        create("user") {
            dimension = "app"
            resValue("string", "app_name", "SevaRath")
        }
        create("driver") {
            dimension = "app"
            applicationIdSuffix = ".driver"
            resValue("string", "app_name", "SevaRath Driver")
        }
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseSigning) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
