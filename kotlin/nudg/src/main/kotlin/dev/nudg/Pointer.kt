package dev.nudg

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
                    for (s in m.states) { s.`when`.forEach { out.add(it.first) }; s.machine?.let(::walk) }
                }
            }
        }
        walk(machine)
        return out
    }

/** Targets whose drags the program listens for. */
val Program.draggableTargets: Set<String>
    get() = handledEvents.mapNotNull { e ->
        val p = e.split(".")
        if (p.size == 2 && (p[1] == "dragstart" || p[1] == "dragend")) p[0] else null
    }.toSet()

class PointerTracker(private val target: String, private val draggable: Boolean, private val send: (String) -> Unit, private val input: (String, Double) -> Unit) {
    private var origin: Pair<Double, Double>? = null
    private var dragging = false

    fun down(x: Double, y: Double) {
        origin = x to y
        dragging = false
        send("$target.down")
    }

    fun move(x: Double, y: Double) {
        val (x0, y0) = origin ?: return
        if (!draggable) return
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

    fun up(inside: Boolean = true) {
        origin ?: return
        origin = null
        send("$target.${if (inside) "up" else "cancel"}")
        if (dragging) send("$target.dragend") else if (inside) send("$target.tap")
        dragging = false
    }

    fun cancel() {
        origin ?: return
        origin = null
        send("$target.cancel")
        if (dragging) send("$target.dragend")
        dragging = false
    }
}

/** The web's key names: lowercased `KeyboardEvent.key`, " " as "space". */
fun nudgKeyName(key: String) = if (key == " ") "space" else key.lowercase()
