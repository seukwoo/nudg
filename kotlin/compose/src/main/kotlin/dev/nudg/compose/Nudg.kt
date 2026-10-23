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
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.first
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerInputChange
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import dev.nudg.DRAG_SLOP
import dev.nudg.PointerTracker
import dev.nudg.Program
import dev.nudg.draggableTargets
import dev.nudg.pinchableTargets
import dev.nudg.handledEvents
import dev.nudg.Lifecycle
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
class NudgState internal constructor(program: Program, state: List<String>, reducedMotion: Boolean, exit: List<String> = emptyList()) {
    val runtime = Runtime(program, state, reducedMotion)
    private val lifecycle = Lifecycle(runtime, exit)
    internal var onSettle: ((List<String>) -> Unit)? = null
    internal var onExit: (() -> Unit)? = null
    private var startNanos = -1L
    private var lastTime = 0.0

    /** The values at the last frame. */
    var values: Map<String, Value> by mutableStateOf(runtime.sample(0.0))
        private set

    /** Active states; changes when an event or timer changes them. */
    var state: List<String> by mutableStateOf(runtime.state())
        private set

    /** False once the component has exited (see `exit` in [rememberNudg]); true again if it is shown again. */
    var present: Boolean by mutableStateOf(true)
        private set

    init {
        lifecycle.onState = { this.state = it }
        lifecycle.onSettle = { onSettle?.invoke(it) }
        lifecycle.onExit = {
            present = false
            onExit?.invoke()
        }
    }

    /** True from creation and after a send or input, until a frame finds nothing left to move. */
    private var moving by mutableStateOf(true)
    /** Frames stopped: nothing moves and no timer or long press is pending, so time can stand still. */
    private var idle = false

    internal fun time(nanos: Long): Double {
        // Resuming after idle continues the timeline where it stopped, so a motion started
        // by the event that woke it doesn't skip the time spent idle.
        if (startNanos < 0 || idle) {
            startNanos = nanos - (lastTime * 1e9).toLong()
            idle = false
        }
        lastTime = maxOf(lastTime, (nanos - startNanos) / 1e9)
        return lastTime
    }

    internal fun frame(nanos: Long) {
        val t = time(nanos)
        values = runtime.sample(t)
        moving = lifecycle.frame(t) // a timer may have fired; settle and exit are reported from here
        if (!moving) idle = true
        if (lifecycle.present) present = true
    }

    /** Sends an event now, e.g. "track.tap" or "host.show". */
    fun send(event: String): Boolean {
        val handled = runtime.send(event, lastTime)
        changed()
        return handled
    }

    /** A layout report or an input sample, now. */
    fun input(name: String, value: Double): Boolean {
        val used = runtime.input(name, value, lastTime)
        changed()
        return used
    }

    private fun changed() {
        lifecycle.changed()
        if (lifecycle.present) present = true
        moving = true
    }

    internal val isMoving get() = moving

    internal fun number(name: String, property: String, default: Double) = (values["$name.$property"] as? Value.Number)?.value ?: default
}

/**
 * Plays [program]. [exit] names the states that mean the component is gone ("hidden"):
 * [NudgState.present] turns false and [onExit] is called once the exit motion has settled.
 * [onSettle] is called with the active states each time every value has come to rest after
 * something moved or the state changed, as in every other adapter.
 */
@Composable
fun rememberNudg(
    program: Program,
    state: List<String> = emptyList(),
    reducedMotion: Boolean = false,
    exit: List<String> = emptyList(),
    onSettle: ((List<String>) -> Unit)? = null,
    onExit: (() -> Unit)? = null,
): NudgState {
    val nudg = remember(program) { NudgState(program, state, reducedMotion, exit) }
    nudg.onSettle = onSettle
    nudg.onExit = onExit
    LaunchedEffect(nudg) {
        // Frames run while something moves; a send or input wakes the loop again.
        while (true) {
            snapshotFlow { nudg.isMoving }.first { it }
            withFrameNanos { nudg.frame(it) }
        }
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
 * cancel) and tap; for targets the file drags, dragstart, drag.x / drag.y in dp, dragend;
 * for targets the file pinches (format 0.18), a second finger ends the drag and reports
 * pinchstart, pinch.scale / rotation / x / y and pinchend.
 */
fun Modifier.nudgPress(state: NudgState, name: String): Modifier = pointerInput(state, name) {
    val draggable = name in state.runtime.program.draggableTargets
    val pinchable = name in state.runtime.program.pinchableTargets
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false)
        val tracker = PointerTracker(name, draggable, { state.send(it) }, { n, v -> state.input(n, v) }, pinchable)
        val id = { c: PointerInputChange -> c.id.value.toInt() }
        fun at(c: PointerInputChange) = (c.position.x / density).toDouble() to (c.position.y / density).toDouble()
        at(down).let { (x, y) -> tracker.down(x, y, id(down)) }
        val tracked = mutableSetOf(down.id)
        var released = false
        while (!released) {
            val event = awaitPointerEvent()
            if (event.changes.none { it.id == down.id }) break
            for (change in event.changes) {
                val (x, y) = at(change)
                if (change.id !in tracked) {
                    // A second finger: a pinch on a target that handles one.
                    if (pinchable && change.pressed) {
                        tracked.add(change.id)
                        tracker.down(x, y, id(change))
                        change.consume()
                    }
                    continue
                }
                if (change.pressed) {
                    tracker.move(x, y, id(change))
                    val travel = (change.position - down.position) / density
                    if ((draggable && travel.getDistance() > DRAG_SLOP) || tracked.size > 1) change.consume()
                } else {
                    tracked.remove(change.id)
                    val inside = change.position.x in 0f..size.width.toFloat() && change.position.y in 0f..size.height.toFloat()
                    tracker.up(inside, id(change))
                    if (change.id == down.id) released = true
                }
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
