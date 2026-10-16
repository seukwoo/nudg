// nudg's runtime on the JVM and Android. It reads programs compiled by the reference
// tools (`nudg compile x.nudg.json`) and passes the same conformance suite:
// `gradle :conformance:run`. `:compose` is the Jetpack Compose adapter; `:demo` an app.
pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositories { google(); mavenCentral() }
}
rootProject.name = "nudg"
include(":nudg", ":conformance")
// The Android modules build when local.properties points at an Android SDK (sdk.dir=...).
if (file("local.properties").exists()) include(":compose", ":demo")
