package dev.nudg

import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.hypot

/**
 * The pointer rules every adapter follows (the same as the web, React Native and
 * SwiftUI): a press is `down`; past 4 logical units of travel a draggable target gets
 * `dragstart` and `drag.x` / `drag.y` measured from the press; the release is `up` (or
 * `cancel` outside), then `dragend` after a drag, or `tap` after a press that didn't drag.
 */
const val DRAG_SLOP = 4.0

/** Every event the program handles, in any state. */
val Program.handledEvents: Set<String>
    get() {
        val out = HashSet<String>()
        fun walk(m: Machine) {
            when (m) {
                is Machine.Regions -> m.regions.forEach { walk(it.second) }
                is Machine.States -> {
                    m.`when`.forEach { out.add(it.first) }
                    for (s in m.states) {
                        s.`when`.forEach { out.add(it.first) }
                        s.timers.forEach { timer -> timer.pause.forEach { out.add(it.on); out.add(it.off) } }
                        s.machine?.let(::walk)
                    }
                }
            }
        }
        walk(machine)
        return out
    }

/** Targets whose pinches the program listens for (v0.18). */
val Program.pinchableTargets: Set<String>
    get() = handledEvents.mapNotNull { e ->
        val p = e.split(".")
        if (p.size == 2 && (p[1] == "pinchstart" || p[1] == "pinchend")) p[0] else null
    }.toSet()

/** Targets whose drags the program listens for. */
val Program.draggableTargets: Set<String>
    get() = handledEvents.mapNotNull { e ->
        val p = e.split(".")
        if (p.size == 2 && (p[1] == "dragstart" || p[1] == "dragend")) p[0] else null
    }.toSet()

/** What a pinch reports, from where the two pointers were when it started (v0.18). */
data class PinchInputs(val scale: Double, val rotation: Double, val x: Double, val y: Double)

fun nudgPinchInputs(start: List<Pair<Double, Double>>, now: List<Pair<Double, Double>>): PinchInputs {
    val (a0, b0) = start
    val (a, b) = now
    val d0 = hypot(b0.first - a0.first, b0.second - a0.second)
    val d = hypot(b.first - a.first, b.second - a.second)
    var rotation = (atan2(b.second - a.second, b.first - a.first) - atan2(b0.second - a0.second, b0.first - a0.first)) * 180 / PI
    // The turn between the two, in (-180, 180].
    rotation -= 360 * ceil(rotation / 360 - 0.5)
    return PinchInputs(if (d0 == 0.0) 1.0 else d / d0, rotation, (a.first + b.first - a0.first - b0.first) / 2, (a.second + b.second - a0.second - b0.second) / 2)
}

class PointerTracker(
    private val target: String,
    private val draggable: Boolean,
    private val send: (String) -> Unit,
    private val input: (String, Double) -> Unit,
    private val pinchable: Boolean = false,
) {
    private var origin: Pair<Double, Double>? = null
    /** The pointer that pressed first: it alone drags, taps and releases the press. */
    private var first: Int? = null
    private var dragging = false
    /** Every pointer on the target, by id, where it is now. */
    private val points = HashMap<Int, Pair<Double, Double>>()
    /** The two pointers of a pinch and where they were when it started (v0.18). */
    private var pinch: Pair<List<Int>, List<Pair<Double, Double>>>? = null
    /** This press pinched, so it neither drags nor taps afterwards. */
    private var pinched = false

    /** Pointer [id] pressed at (x, y). A second one on a pinchable target starts a pinch. */
    fun down(x: Double, y: Double, id: Int = 0) {
        points[id] = x to y
        if (origin == null) {
            origin = x to y; first = id; dragging = false; pinched = false
            send("$target.down")
            return
        }
        val firstId = first ?: return
        if (!pinchable || pinch != null || points.size != 2) return
        // A drag in progress becomes the pinch.
        if (dragging) { dragging = false; send("$target.dragend") }
        pinch = listOf(firstId, id) to listOf(points.getValue(firstId), points.getValue(id))
        pinched = true
        send("$target.pinchstart")
    }

    fun move(x: Double, y: Double, id: Int = 0) {
        if (id !in points) return
        points[id] = x to y
        pinch?.let { (ids, start) ->
            if (id !in ids) return
            val p = nudgPinchInputs(start, ids.map { points.getValue(it) })
            for ((name, value) in listOf("scale" to p.scale, "rotation" to p.rotation, "x" to p.x, "y" to p.y)) input("$target.pinch.$name", value)
            return
        }
        val (x0, y0) = origin ?: return
        if (id != first || !draggable || pinched) return
        val dx = x - x0
        val dy = y - y0
        if (!dragging) {
            if (hypot(dx, dy) <= DRAG_SLOP) return
            dragging = true
            send("$target.dragstart")
        }
        input("$target.drag.x", dx)
        input("$target.drag.y", dy)
    }

    /** Pointer [id] released; [inside] is false when it left the target. */
    fun up(inside: Boolean = true, id: Int = 0) {
        points.remove(id) ?: return
        if (pinch?.first?.contains(id) == true) { pinch = null; send("$target.pinchend") }
        if (id != first || origin == null) return
        origin = null; first = null
        send("$target.${if (inside) "up" else "cancel"}")
        if (dragging) send("$target.dragend") else if (inside && !pinched) send("$target.tap")
        dragging = false
    }

    fun cancel() {
        origin ?: return
        origin = null; first = null; points.clear()
        send("$target.cancel")
        if (pinch != null) send("$target.pinchend")
        if (dragging) send("$target.dragend")
        pinch = null
        dragging = false
    }
}

/** The web's key names: lowercased `KeyboardEvent.key`, " " as "space". */
fun nudgKeyName(key: String) = if (key == " ") "space" else key.lowercase()
