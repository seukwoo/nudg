package dev.nudg.compose

import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.utf16CodePoint
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import dev.nudg.DRAG_SLOP
import dev.nudg.PointerTracker
import dev.nudg.Program
import dev.nudg.draggableTargets
import dev.nudg.handledEvents
import dev.nudg.nudgKeyName
import dev.nudg.Runtime
import dev.nudg.Value
import kotlin.math.roundToInt

/**
 * Jetpack Compose adapter. The runtime's values are read inside graphics layer, draw and
 * layout blocks, so a frame redraws or relayouts only what moves, never recomposes.
 *
 *   val toggle = rememberNudg(Program.decode(assets.open("toggle.program.json").readText()))
 *   Box(Modifier.nudg(toggle, "track").clickable { toggle.send("track.tap") }) {
 *     Box(Modifier.size(24.dp).nudg(toggle, "knob").background(Color.White, CircleShape))
 *   }
 */
@Stable
class NudgState internal constructor(program: Program, state: List<String>, reducedMotion: Boolean) {
    val runtime = Runtime(program, state, reducedMotion)
    private var startNanos = -1L
    private var lastTime = 0.0

    /** The values at the last frame. */
    var values: Map<String, Value> by mutableStateOf(runtime.sample(0.0))
        private set

    /** Active states; changes when an event or timer changes them. */
    var state: List<String> by mutableStateOf(runtime.state())
        private set

    private var moving by mutableStateOf(false)

    internal fun time(nanos: Long): Double {
        if (startNanos < 0) startNanos = nanos
        lastTime = maxOf(lastTime, (nanos - startNanos) / 1e9)
        return lastTime
    }

    internal fun frame(nanos: Long) {
        val t = time(nanos)
        values = runtime.sample(t)
        val s = runtime.state()
        if (s != state) state = s
        moving = !runtime.settled(t)
    }

    /** Sends an event now, e.g. "track.tap" or "host.show". */
    fun send(event: String): Boolean {
        val handled = runtime.send(event, lastTime)
        moving = true
        return handled
    }

    /** A layout report or an input sample, now. */
    fun input(name: String, value: Double): Boolean {
        val used = runtime.input(name, value, lastTime)
        moving = true
        return used
    }

    internal val isMoving get() = moving

    internal fun number(name: String, property: String, default: Double) = (values["$name.$property"] as? Value.Number)?.value ?: default
}

@Composable
fun rememberNudg(program: Program, state: List<String> = emptyList(), reducedMotion: Boolean = false): NudgState {
    val nudg = remember(program) { NudgState(program, state, reducedMotion) }
    LaunchedEffect(nudg) {
        // Frames run while something moves; a send or input wakes the loop again.
        while (true) withFrameNanos { nudg.frame(it) }
    }
    return nudg
}

/** Applies a target's values: offset, rotation, scale and opacity in a graphics layer, size in layout, color behind. */
fun Modifier.nudg(state: NudgState, name: String): Modifier = this
    .layout { measurable, constraints ->
        val w = (state.values["$name.width"] as? Value.Number)?.let { (it.value * density).roundToInt() }
        val h = (state.values["$name.height"] as? Value.Number)?.let { (it.value * density).roundToInt() }
        val placeable = measurable.measure(
            constraints.copy(
                minWidth = w ?: constraints.minWidth, maxWidth = w ?: constraints.maxWidth,
                minHeight = h ?: constraints.minHeight, maxHeight = h ?: constraints.maxHeight,
            ),
        )
        layout(placeable.width, placeable.height) { placeable.place(0, 0) }
    }
    .graphicsLayer {
        translationX = (state.number(name, "x", 0.0) * density).toFloat()
        translationY = (state.number(name, "y", 0.0) * density).toFloat()
        rotationZ = state.number(name, "rotation", 0.0).toFloat()
        val s = state.number(name, "scale", 1.0)
        scaleX = (s * state.number(name, "scaleX", 1.0)).toFloat()
        scaleY = (s * state.number(name, "scaleY", 1.0)).toFloat()
        alpha = state.number(name, "opacity", 1.0).toFloat()
    }
    .drawBehind {
        (state.values["$name.color"] as? Value.Color)?.let { drawRect(parseHex(it.hex)) }
    }

/**
 * Press and drag for a target, by the same rules as every other adapter: down, up (or
 * cancel) and tap; for targets the file drags, dragstart, drag.x / drag.y in dp, dragend.
 */
fun Modifier.nudgPress(state: NudgState, name: String): Modifier = pointerInput(state, name) {
    val draggable = name in state.runtime.program.draggableTargets
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false)
        val tracker = PointerTracker(name, draggable, { state.send(it) }, { n, v -> state.input(n, v) })
        tracker.down(0.0, 0.0)
        var released = false
        while (!released) {
            val event = awaitPointerEvent()
            val change = event.changes.firstOrNull { it.id == down.id } ?: break
            val travel = (change.position - down.position) / density
            tracker.move(travel.x.toDouble(), travel.y.toDouble())
            if (draggable && travel.getDistance() > DRAG_SLOP) change.consume()
            if (!change.pressed) {
                released = true
                val inside = change.position.x in 0f..size.width.toFloat() && change.position.y in 0f..size.height.toFloat()
                tracker.up(inside)
            }
        }
        if (!released) tracker.cancel()
    }
}

/** Keys while focused: `target.key.<name>` for the keys the file listens for. */
fun Modifier.nudgKeys(state: NudgState, name: String): Modifier = onKeyEvent { e ->
    if (e.type != KeyEventType.KeyDown) return@onKeyEvent false
    val key = when (e.key) {
        Key.DirectionLeft -> "arrowleft"; Key.DirectionRight -> "arrowright"; Key.DirectionUp -> "arrowup"; Key.DirectionDown -> "arrowdown"
        Key.Escape -> "escape"; Key.Enter -> "enter"; Key.Spacebar -> "space"; Key.Tab -> "tab"
        Key.MoveHome -> "home"; Key.MoveEnd -> "end"; Key.PageUp -> "pageup"; Key.PageDown -> "pagedown"
        Key.Backspace -> "backspace"; Key.Delete -> "delete"
        else -> e.utf16CodePoint.takeIf { it > 0 }?.let { nudgKeyName(String(Character.toChars(it))) } ?: return@onKeyEvent false
    }
    val event = "$name.key.$key"
    if (event !in state.runtime.program.handledEvents) return@onKeyEvent false
    state.send(event)
    true
}.focusable()

/** Reports the composable's untransformed box in dp for `measure` (format 0.4). Put it before `nudg` in the chain. */
@Composable
fun Modifier.nudgLayout(state: NudgState, name: String): Modifier {
    val density = androidx.compose.ui.platform.LocalDensity.current.density.toDouble()
    return onGloballyPositioned { c ->
        val p = c.positionInRoot()
        state.input("$name.layout.x", p.x / density)
        state.input("$name.layout.y", p.y / density)
        state.input("$name.layout.width", c.size.width / density)
        state.input("$name.layout.height", c.size.height / density)
    }
}

private fun parseHex(hex: String): Color {
    val h = hex.removePrefix("#")
    val v = h.substring(0, 6).toLong(16)
    val a = if (h.length == 8) h.substring(6, 8).toInt(16) else 255
    return Color(red = ((v shr 16) and 0xff).toInt(), green = ((v shr 8) and 0xff).toInt(), blue = (v and 0xff).toInt(), alpha = a)
}
