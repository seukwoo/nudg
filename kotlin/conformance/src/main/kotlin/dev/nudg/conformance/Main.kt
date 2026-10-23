package dev.nudg.conformance

import dev.nudg.Program
import dev.nudg.Runtime
import dev.nudg.Value
import dev.nudg.draggableTargets
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
                (expect["resting"] as? Boolean)?.let { if (rt.resting(t) != it) problems.add("resting at ${t}s: expected $it") }
                (expect["settled"] as? Boolean)?.let { if (rt.settled(t) != it) problems.add("settled at ${t}s: expected $it") }
                (expect["looping"] as? Boolean)?.let { if (rt.looping() != it) problems.add("looping at ${t}s: expected $it") }
            }
            if (problems.isEmpty()) { passed++; println("ok    $name") } else { failures.add(name); println("FAIL  $name\n      " + problems.take(5).joinToString("\n      ")) }
        } catch (e: Exception) {
            failures.add(name); println("FAIL  $name\n      $e")
        }
    }
    // The pointer rules, on the drag toggle: a drag of 30 units to the right turns it on.
    run {
        val program = Program.decode(File(dir, "programs/drag-flick.program.json").readText())
        val rt = Runtime(program)
        var t = 0.0
        val log = ArrayList<String>()
        val tracker = dev.nudg.PointerTracker("track", "track" in program.draggableTargets, { log.add(it); rt.send(it, t) }, { n, v -> rt.input(n, v, t) })
        tracker.down(100.0, 50.0)
        for (i in 1..6) { t += 1.0 / 60; tracker.move(100.0 + i * 5, 50.0) }
        tracker.up()
        rt.sample(t + 2)
        if (rt.state() == listOf("on") && log == listOf("track.down", "track.dragstart", "track.up", "track.dragend")) { passed++; println("ok    pointer: a 30-unit drag turns the drag toggle on, with no tap") }
        else { failures.add("pointer"); println("FAIL  pointer: state ${rt.state()}, events $log") }
    }
    // Two pointers on a pinchable target (v0.18): the drag ends, a pinch reports its inputs, and the press doesn't tap.
    run {
        val log = ArrayList<String>()
        val tracker = dev.nudg.PointerTracker("image", true, { log.add(it) }, { n, v -> log.add("$n=${Math.round(v * 100) / 100.0}") }, pinchable = true)
        tracker.down(100.0, 100.0, 1); tracker.move(110.0, 100.0, 1); tracker.down(200.0, 100.0, 2)
        tracker.move(110.0, 110.0, 1); tracker.move(110.0, 310.0, 2); tracker.up(true, 2); tracker.move(150.0, 150.0, 1); tracker.up(true, 1)
        val expected = listOf("image.down", "image.dragstart", "image.drag.x=10.0", "image.drag.y=0.0", "image.dragend", "image.pinchstart",
            "image.pinch.scale=1.01", "image.pinch.rotation=-6.34", "image.pinch.x=0.0", "image.pinch.y=5.0",
            "image.pinch.scale=2.22", "image.pinch.rotation=90.0", "image.pinch.x=-45.0", "image.pinch.y=110.0", "image.pinchend", "image.up")
        if (log == expected) { passed++; println("ok    pointer: a second pointer ends the drag and pinches; the press doesn't tap") }
        else { failures.add("pinch"); println("FAIL  pinch: $log") }
    }
    // Lifecycle, by the same rules as every adapter: one settle per rest, exit once settled.
    run {
        val rt = Runtime(Program.decode(File(dir, "programs/toggle-tap.program.json").readText()))
        val life = dev.nudg.Lifecycle(rt, exit = listOf("off"))
        val settles = ArrayList<List<String>>()
        var exits = 0
        life.onSettle = { settles.add(it) }
        life.onExit = { exits++ }
        var t = 0.0
        fun frames(until: Double) { while (t < until) { t += 1.0 / 60; rt.sample(t); life.frame(t) } }
        rt.send("track.tap", t); life.changed()
        frames(0.05)
        rt.send("track.tap", t); life.changed() // interrupted: only the rest after it is reported
        frames(0.1)
        rt.send("track.tap", t); life.changed()
        frames(2.0)
        val once = settles == listOf(listOf("on")) && exits == 0 && life.present
        rt.send("track.tap", t); life.changed()
        frames(4.0)
        if (once && settles == listOf(listOf("on"), listOf("off")) && exits == 1 && !life.present) { passed++; println("ok    lifecycle: one settle per rest, exit once the exit state settled") }
        else { failures.add("lifecycle"); println("FAIL  lifecycle: settles $settles, exits $exits, present ${life.present}") }
    }

    println("\n$passed passed, ${failures.size} failed")
    exitProcess(if (failures.isEmpty()) 0 else 1)
}

/** The library's reader, reused for the case files. */
private fun parseJson(text: String): Any? {
    val m = Class.forName("dev.nudg.Json").getDeclaredField("INSTANCE").get(null)
    return m.javaClass.getMethod("parse", String::class.java).invoke(m, text)
}
