plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "dev.nudg.compose"
    compileSdk = 37
    defaultConfig { minSdk = 24 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildFeatures { compose = true }
}
dependencies {
    api(project(":nudg"))
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.runtime:runtime")
}

// Published as com.github.seukwoo.nudg:compose (JitPack builds it from a git tag; see jitpack.yml).
plugins.apply("maven-publish")
group = (findProperty("nudgGroup") as String?) ?: "com.github.seukwoo.nudg"
version = (findProperty("version") as String?)?.takeIf { it != "unspecified" } ?: "0.0.0-local"
android { publishing { singleVariant("release") { withSourcesJar() } } }
afterEvaluate {
    extensions.configure<PublishingExtension> {
        publications { create<MavenPublication>("release") { from(components["release"]); artifactId = "compose" } }
    }
}
