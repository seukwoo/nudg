package dev.nudg.conformance

import dev.nudg.Program
import dev.nudg.Runtime
import dev.nudg.Value
import java.io.File
import kotlin.math.abs
import kotlin.system.exitProcess

/**
 * Runs nudg's conformance suite (../spec/conformance) against the Kotlin runtime, from
 * the programs the reference compiler wrote. Exits 1 on any failure.
 */
fun main(args: Array<String>) {
    val dir = File(args.firstOrNull() ?: "../spec/conformance")
    var passed = 0
    val failures = ArrayList<String>()
    for (file in dir.listFiles { f -> f.name.endsWith(".json") }!!.sortedBy { it.name }) {
        @Suppress("UNCHECKED_CAST")
        val c = parseJson(file.readText()) as Map<String, Any?>
        val steps = c["steps"] as? List<*> ?: continue
        if (c["doc"] == null) continue
        val name = "${file.name}: ${c["name"]}"
        try {
            val program = Program.decode(File(dir, "programs/" + file.name.removeSuffix(".json") + ".program.json").readText())
            val rt = Runtime(program, (c["start"] as? List<*>)?.map { it as String } ?: emptyList(), c["reducedMotion"] as? Boolean ?: false)
            val problems = ArrayList<String>()
            for (s in steps) {
                val step = s as Map<*, *>
                val t = step["t"] as Double
                (step["input"] as? String)?.let { if (!rt.input(it, step["value"] as Double, t)) problems.add("input $it at ${t}s was refused") }
                (step["send"] as? String)?.let { ev ->
                    val handled = rt.send(ev, t)
                    (step["handled"] as? Boolean)?.let { if (it != handled) problems.add("$ev at ${t}s handled $handled, expected $it") }
                }
                val expect = step["expect"] as? Map<*, *> ?: continue
                val values = rt.sample(t)
                (expect["state"] as? List<*>)?.let { if (rt.state() != it) problems.add("state at ${t}s: ${rt.state()}, expected $it") }
                for ((key, expected) in (expect["values"] as? Map<*, *> ?: emptyMap<Any, Any>())) {
                    val actual = values[key]
                    if (expected is String) {
                        val a = (actual as? Value.Color)?.hex ?: run { problems.add("$key at ${t}s: expected a color"); null } ?: continue
                        val ch = { h: String -> listOf(1, 3, 5).map { h.substring(it, it + 2).toInt(16) } }
                        if (ch(a).zip(ch(expected)).any { (x, y) -> abs(x - y) > 1 }) problems.add("$key at ${t}s: expected $expected, got $a")
                    } else {
                        val a = (actual as? Value.Number)?.value ?: run { problems.add("$key at ${t}s: expected a number"); null } ?: continue
                        if (abs(a - expected as Double) > 1e-6) problems.add("$key at ${t}s: expected $expected, got $a")
                    }
                }
            }
            if (problems.isEmpty()) { passed++; println("ok    $name") } else { failures.add(name); println("FAIL  $name\n      " + problems.take(5).joinToString("\n      ")) }
        } catch (e: Exception) {
            failures.add(name); println("FAIL  $name\n      $e")
        }
    }
    println("\n$passed passed, ${failures.size} failed")
    exitProcess(if (failures.isEmpty()) 0 else 1)
}

/** The library's reader, reused for the case files. */
private fun parseJson(text: String): Any? {
    val m = Class.forName("dev.nudg.Json").getDeclaredField("INSTANCE").get(null)
    return m.javaClass.getMethod("parse", String::class.java).invoke(m, text)
}
