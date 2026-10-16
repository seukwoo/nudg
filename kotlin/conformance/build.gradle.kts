plugins {
    kotlin("jvm")
    application
}

kotlin { jvmToolchain(17) }
dependencies { implementation(project(":nudg")) }
application { mainClass.set("dev.nudg.conformance.MainKt") }
tasks.named<JavaExec>("run") { workingDir = rootDir }
