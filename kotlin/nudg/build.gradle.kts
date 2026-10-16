plugins { kotlin("jvm") }

kotlin { jvmToolchain(17) }

// Published as com.github.seukwoo.nudg:nudg (JitPack builds it from a git tag; see jitpack.yml).
plugins.apply("maven-publish")
group = (findProperty("nudgGroup") as String?) ?: "com.github.seukwoo.nudg"
version = (findProperty("version") as String?)?.takeIf { it != "unspecified" } ?: "0.0.0-local"
java { withSourcesJar() }
extensions.configure<PublishingExtension> {
    publications { create<MavenPublication>("release") { from(components["java"]); artifactId = "nudg" } }
}
