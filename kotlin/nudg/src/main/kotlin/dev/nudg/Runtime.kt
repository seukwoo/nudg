package dev.nudg

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.sqrt

/**
 * Runs a compiled Program, the same way the TypeScript reference does. Time is always
 * passed in, never read from a clock: the same events at the same times give the same
 * states and values on every platform. The conformance suite checks that.
 */
sealed interface Value {
    data class Number(val value: Double) : Value
    data class Color(val hex: String) : Value
}

private sealed interface Segment {
    data class MotionSeg(val t0: Double, val from: List<Double>, val v0: List<Double>, val to: List<Double>, val motion: Motion?) : Segment
    data class KeyframesSeg(val key: String, val t0: Double, val from: List<Double>, val to: List<Double>, val frames: List<Keyframe>, val duration: Double, val ease: Ease, val owner: State) : Segment
    data class FollowSeg(val key: String, val t0: Double, val anchor: Double, val input0: Double, val follow: Follow, val owner: State) : Segment
    /** A property slowing down from [v0] (v0.16), and settling at a range bound if it reaches one. */
    data class GlideSeg(val key: String, val t0: Double, val x0: Double, val v0: Double, val glide: Glide, val owner: State) : Segment
    /** A motion that starts at [t0] (v0.12); until then the property does what [prev] does. */
    data class DelayedSeg(val t0: Double, val prev: Segment, val to: List<Double>, val motion: Motion) : Segment
}

private class Pending(var due: Double, val order: Int, val machine: Machine.States, val state: State, val transition: Transition, val pause: List<TimerPause>) {
    val blockers = HashSet<Int>()
    var pausedAt: Double? = null
}

/** A glide's phase: still slowing down, or settling at a range bound with the property's motion. */
private sealed interface GlidePhase {
    data class Gliding(val pos: Double, val vel: Double) : GlidePhase
    data class Settling(val motion: Segment.MotionSeg) : GlidePhase
}

/** A loop running since its state was entered at [t0]. */
private class ActiveLoop(val loop: Loop, val owner: State, val t0: Double)

/** One flying piece of an emitter (1.4): where the host draws it, relative to the emitter's starting point. [rotation] in degrees. */
data class Piece(val emitter: String, val wave: Int, val index: Int, val x: Double, val y: Double, val rotation: Double, val scale: Double, val opacity: Double)

/** A number in [0, 1) from a seed, a wave, a piece's index and a field: the same 32-bit hash as every runtime. */
fun pieceRandom(seed: Int, wave: Int, index: Int, field: Int): Double {
    var h = seed * 0x9E3779B1.toInt() + wave * 0x85EBCA77.toInt() + index * 0xC2B2AE3D.toInt() + field * 0x27D4EB2F
    h = h xor (h ushr 15)
    h *= 0x2C1B3C6D
    h = h xor (h ushr 12)
    h *= 0x297A2D39
    h = h xor (h ushr 15)
    return (h.toLong() and 0xFFFFFFFFL) / 4294967296.0
}

/** Piece [index] of a wave, [age] seconds after its launch, or null before launch and after its life. */
fun pieceAt(name: String, e: Emitter, wave: Int, index: Int, age: Double): Piece? {
    fun u(field: Int) = pieceRandom(e.seed, wave, index, field)
    fun pick(r: Pair<Double, Double>, field: Int) = r.first + u(field) * (r.second - r.first)
    val life = pick(e.life, 3)
    if (age < 0 || age > life) return null
    val angle = Math.toRadians(pick(e.angle, 0))
    val speed = pick(e.speed, 1)
    val vx = speed * Math.cos(angle)
    val vy = speed * Math.sin(angle)
    val x0 = (u(5) - 0.5) * e.area.first
    val y0 = (u(6) - 0.5) * e.area.second
    val k = e.drag
    val g = e.gravity
    val x: Double
    val y: Double
    if (k > 1e-9) {
        val decay = (1 - Math.exp(-k * age)) / k
        x = x0 + vx * decay
        y = y0 + (vy + g / k) * decay - (g / k) * age
    } else {
        x = x0 + vx * age
        y = y0 + vy * age + 0.5 * g * age * age
    }
    val opacity = if (e.fade > 0 && age > life - e.fade) maxOf(0.0, (life - age) / e.fade) else 1.0
    return Piece(name, wave, index, x, y, pick(e.spin, 2) * age, pick(e.scale, 4), opacity)
}

/** A cue that came due (1.3): when, and what to play. [intensity] is 0 to 1, [pitch] in semitones. */
data class FiredCue(val t: Double, val sound: String?, val haptic: String?, val intensity: Double, val pitch: Double)

private class ScheduledCue(val t: Double, val seq: Int, val cue: Cue, val owner: State?, val intensity: Double, val pitch: Double)

/** Seconds a press is held before it is a long press, and the most between two taps of a double tap (v0.14). */
private const val LONG_PRESS = 0.5
private const val DOUBLE_TAP = 0.3
/** Logical units a scroll must travel back from its furthest point before its direction changes (v0.15). */
private const val SCROLL_SLOP = 8.0

/** An event that fires when an input crosses a value (v0.15): "host.volume>0.6". */
private class Crossing(val event: String, val input: String, val above: Boolean, val value: Double) {
    var inside = initial()
    fun initial() = if (above) 0.0 > value else 0.0 < value
    companion object {
        fun of(event: String): Crossing? {
            val i = event.indexOfLast { it == '>' || it == '<' }
            if (i < 0) return null
            val value = event.substring(i + 1).toDoubleOrNull() ?: return null
            return Crossing(event, event.substring(0, i), event[i] == '>', value)
        }
    }
}

/** One scrolled axis: the direction last reported and the furthest point in it. */
private class ScrollDirection(val back: String, val forth: String) {
    var dir: Boolean? = null // true: forth (down, right)
    var ref = 0.0
}

private const val REST_NUMBER = 1e-3
private const val REST_COLOR = 1e-4
private const val VELOCITY_WINDOW = 0.1
private val REDUCED: Motion = Motion.Tween(0.15, Ease.Linear)
private val LAYOUT_NAMES = setOf("x", "y", "width", "height", "naturalWidth", "naturalHeight")

class Runtime(val program: Program, state: List<String> = emptyList(), reducedMotion: Boolean = false) {
    private var reduced = reducedMotion
    private val active = HashMap<Machine.States, String>()
    private val segments = HashMap<String, Segment>()
    /** Under reduced motion no loop plays, except (from format 1.1) one that only fades: opacity moves nothing. */
    private val fades = program.version.split(".").map { it.toIntOrNull() ?: 0 }.let { v -> (v.getOrElse(0) { 0 } to v.getOrElse(1) { 0 }).let { (major, minor) -> major > 1 || (major == 1 && minor >= 1) } }
    private fun loopPlays(key: String) = !reduced || (fades && key.endsWith(".opacity"))
    /** Loops of the active states, by property (v0.10). Under reduced motion only opacity loops, from 1.1. */
    private val loops = LinkedHashMap<String, ActiveLoop>()
    private val inputs = HashMap<String, MutableList<Pair<Double, Double>>>()
    private val bases = HashMap<String, List<Double>>()
    private val pending = ArrayList<Pending>()
    private val layout = HashMap<String, Double>()
    private val measuredBases = HashMap<String, Measure>()
    private val requiredInputs = HashSet<String>()
    /** Inputs that states read as targets (v0.17): a new sample retargets, like a relayout. */
    private val targetInputs = HashSet<String>()
    private var order = 0
    // Gestures derived from down, up and tap (v0.14), only for targets whose events the file handles.
    private val wants by lazy { program.handledEvents }
    /** When each pressed target becomes a long press, until up, cancel or dragstart. */
    private val pressDue = LinkedHashMap<String, Double>()
    /** Targets whose current press was a long press: the tap that ends it is not a tap. */
    private val longPressed = HashSet<String>()
    private val lastTap = HashMap<String, Double>()
    // Events derived from inputs (v0.15): crossings in event-name order, and scroll directions.
    private val crossings: List<Crossing> by lazy { wants.sorted().mapNotNull(Crossing::of) }
    private val scrolls = HashMap<String, ScrollDirection>()
    private var now = 0.0
    /** Cues waiting for their time (1.3); [ScheduledCue.owner] cancels them when its state is left. */
    private val scheduled = ArrayList<ScheduledCue>()
    private var cueSeq = 0
    /** Cues that came due, until the host takes them. */
    private val due = ArrayList<FiredCue>()
    /** Loop beats have been collected up to here. */
    private var cueCursor = 0.0
    /** When each cue was last scheduled to fire, for its throttle (by identity). */
    private val lastCue = java.util.IdentityHashMap<Cue, Double>()
    /** Waves of pieces (1.4), and how many each emitter has sent. */
    private class Wave(val name: String, val wave: Int, val t0: Double)
    private val waves = ArrayList<Wave>()
    private val waveCount = HashMap<String, Int>()

    init {
        for ((key, prop) in program.properties) {
            prop.measure?.let { measuredBases[key] = it }
            if (prop.map == null) bases[key] = prop.base
            if (prop.map?.sourceKind == "input") requiredInputs.add(prop.map.source)
        }
        collectFollowInputs(program.machine)
        // Delays read from app inputs (v1.2), when their transition fires.
        for (motion in program.animate.values) motion.delayInput?.let { requiredInputs.add(it.input) }
        enterMachine(program.machine, active, ArrayList(), 0.0)
        for (path in state) enterPath(path)
        val targets = resolveTargets(active)
        val follows = activeFollows(active)
        for ((key, prop) in program.properties) {
            if (prop.map != null) continue
            val to = targets.getValue(key)
            val f = follows[key]
            segments[key] = if (f != null) followSegment(key, f, to[0], 0.0) else Segment.MotionSeg(0.0, to, to.map { 0.0 }, to, null)
        }
        walkActive(active) { s -> for ((key, loop) in s.loop) if (loopPlays(key)) loops[key] = ActiveLoop(loop, s, 0.0) }
        for (c in crossings) requiredInputs.add(c.input)
        for ((axis, back, forth) in listOf(Triple("y", "scrollup", "scrolldown"), Triple("x", "scrollleft", "scrollright"))) {
            for (event in wants) {
                val parts = event.split(".")
                if (parts.size != 2 || (parts[1] != back && parts[1] != forth)) continue
                val input = "${parts[0]}.scroll.$axis"
                requiredInputs.add(input)
                scrolls[input] = ScrollDirection("${parts[0]}.$back", "${parts[0]}.$forth")
            }
        }
    }

    // machine

    private fun enterMachine(machine: Machine, act: MutableMap<Machine.States, String>, entered: MutableList<State>, t: Double, live: Boolean = true) {
        when (machine) {
            is Machine.States -> enterState(machine, machine.initial, act, entered, t, live)
            is Machine.Regions -> for ((_, r) in machine.regions) enterMachine(r, act, entered, t, live)
        }
    }

    private fun enterState(machine: Machine.States, name: String, act: MutableMap<Machine.States, String>, entered: MutableList<State>, t: Double, live: Boolean = true) {
        act[machine] = name
        val s = machine.state(name)
        entered.add(s)
        if (live) for (timer in s.timers) pending.add(Pending(t + timer.delay, order++, machine, s, timer.transition, timer.pause))
        s.machine?.let { enterMachine(it, act, entered, t, live) }
    }

    private fun exitMachine(machine: Machine, act: MutableMap<Machine.States, String>, live: Boolean = true) {
        when (machine) {
            is Machine.Regions -> for ((_, r) in machine.regions) exitMachine(r, act, live)
            is Machine.States -> {
                val s = machine.state(act.getValue(machine))
                s.machine?.let { exitMachine(it, act, live) }
                if (live) pending.removeAll { it.state === s }
                act.remove(machine)
            }
        }
    }

    private fun enterPath(path: String) {
        val parts = path.split("/")
        var machine: Machine = program.machine
        for ((i, part) in parts.withIndex()) {
            val m = machine
            if (m is Machine.Regions) {
                machine = m.regions.firstOrNull { it.first == part }?.second ?: error("No region \"$part\" in state path \"$path\".")
                continue
            }
            m as Machine.States
            val s = m.states.firstOrNull { it.name == part } ?: error("No state \"$part\" in state path \"$path\".")
            if (active[m] != part) {
                exitMachine(m, active)
                enterState(m, part, active, ArrayList(), 0.0)
            }
            if (i < parts.size - 1) machine = s.machine ?: error("State \"$part\" has no states inside it, in state path \"$path\".")
        }
    }

    private fun walkActive(act: Map<Machine.States, String>, visit: (State) -> Unit) {
        fun walk(m: Machine) {
            when (m) {
                is Machine.Regions -> for ((_, r) in m.regions) walk(r)
                is Machine.States -> {
                    val s = m.state(act.getValue(m))
                    visit(s)
                    s.machine?.let(::walk)
                }
            }
        }
        walk(program.machine)
    }

    private fun collectDelayInputs(transition: Transition) {
        for ((_, motion) in transition.animate) motion.delayInput?.let { requiredInputs.add(it.input) }
        for (cue in transition.cues) collectCueInputs(cue)
    }

    /** Cue amounts and delays read from inputs (1.3). */
    private fun collectCueInputs(cue: Cue) {
        for (a in listOf(cue.intensity, cue.pitch)) if (a is CueAmount.Input) requiredInputs.add(a.input)
        cue.delayInput?.let { requiredInputs.add(it.input) }
    }

    private fun collectFollowInputs(machine: Machine) {
        when (machine) {
            is Machine.Regions -> for ((_, region) in machine.regions) collectFollowInputs(region)
            is Machine.States -> {
                for ((_, transition) in machine.`when`) collectDelayInputs(transition)
                for (state in machine.states) {
                    for ((_, follow) in state.follow) requiredInputs.add(follow.input)
                    for ((_, target) in state.input) { requiredInputs.add(target.input); targetInputs.add(target.input) }
                    for ((_, transition) in state.`when`) collectDelayInputs(transition)
                    for (timer in state.timers) collectDelayInputs(timer.transition)
                    for (cue in state.cues) collectCueInputs(cue)
                    for ((_, effect) in state.enter) if (effect is EntryEffect.Keyframes) for (f in effect.frames) for (cue in f.cues) collectCueInputs(cue)
                    for ((_, loop) in state.loop) for ((_, cues) in loop.cues) for (cue in cues) collectCueInputs(cue)
                    state.machine?.let(::collectFollowInputs)
                }
            }
        }
    }

    // targets

    private fun inputsOf(key: String, m: Measure): List<String> {
        val own = key.substringBefore(".")
        return if (m.of == "x" || m.of == "y") listOf("${m.target}.layout.${m.of}", "$own.layout.${m.of}") else listOf("${m.target}.layout.${m.of}")
    }

    private fun measured(key: String, m: Measure): Double? {
        val values = inputsOf(key, m).map { layout[it] ?: return null }
        val value = if (m.of == "x" || m.of == "y") values[0] - values[1] else values[0]
        return value * m.times + m.plus
    }

    private fun endpoint(key: String, value: MeasuredEndpoint): Double? = when (value) {
        is MeasuredEndpoint.Number -> value.value
        is MeasuredEndpoint.Measured -> measured(key, value.measure)
    }

    private fun resolvedRange(key: String, range: Pair<MeasuredEndpoint, MeasuredEndpoint>?): Pair<Double, Double>? {
        if (range == null) return null
        val a = endpoint(key, range.first) ?: return null
        val b = endpoint(key, range.second) ?: return null
        if (a == b) return null
        return minOf(a, b) to maxOf(a, b)
    }

    private fun resolvedMap(key: String, map: PropertyMap): Pair<List<Double>, List<List<Double>>>? {
        val context = if (map.sourceKind == "property") map.source else key
        val points = map.from.map { endpoint(context, it) ?: return null }
        if (points.toSet().size != points.size) return null
        // Measured values resolve in the mapped property's own coordinates (v0.11).
        val to = map.to.map { value ->
            when (value) {
                is MapValue.Channels -> value.values
                is MapValue.Measured -> listOf(measured(key, value.measure) ?: return null)
            }
        }
        return points to to
    }

    private fun clamp(key: String, value: Double): Double {
        val p = program.property(key)
        if (p.min != null && value < p.min) return p.min
        if (p.max != null && value > p.max) return p.max
        return value
    }

    private fun resolveTargets(act: Map<Machine.States, String>): Map<String, List<Double>> {
        val out = HashMap(bases)
        for ((key, m) in measuredBases) measured(key, m)?.let { out[key] = listOf(clamp(key, it)) }
        val resolvedBases = HashMap(out)
        walkActive(act) { s ->
            for ((key, value) in s.set) {
                val target = s.input[key]
                if (target != null) {
                    // The input's latest sample (0 before the first), scaled and offset (v0.17).
                    out[key] = listOf(clamp(key, (inputs[target.input]?.lastOrNull()?.second ?: 0.0) * target.times + target.plus))
                    continue
                }
                val m = s.measure[key]
                if (m == null) { out[key] = value; continue }
                out[key] = measured(key, m)?.let { listOf(clamp(key, it)) } ?: resolvedBases.getValue(key)
            }
        }
        return out
    }

    private fun activeFollows(act: Map<Machine.States, String>): Map<String, Pair<Follow, State>> {
        val out = HashMap<String, Pair<Follow, State>>()
        walkActive(act) { s -> for ((key, f) in s.follow) out[key] = f to s }
        return out
    }

    private fun activeGlides(act: Map<Machine.States, String>): Map<String, Pair<Glide, State>> {
        val out = HashMap<String, Pair<Glide, State>>()
        walkActive(act) { s -> for ((key, g) in s.glide) out[key] = g to s }
        return out
    }

    /**
     * Where a glide is at [t]: x0 + v0·m·(1 − e^(−t/m)), so it travels v0·m in all. If that
     * would pass a range bound, it reaches the bound and settles there with the property's own
     * motion, keeping the speed it had; one that starts outside the range goes straight back.
     */
    private fun glidePhase(seg: Segment.GlideSeg, t: Double): GlidePhase {
        val m = seg.glide.momentum
        val motion = program.animate[seg.key]?.let { if (reduced) REDUCED else it }
        resolvedRange(seg.key, seg.glide.range)?.let { (lo, hi) ->
            if (seg.x0 < lo || seg.x0 > hi) return GlidePhase.Settling(Segment.MotionSeg(seg.t0, listOf(seg.x0), listOf(seg.v0), listOf(if (seg.x0 < lo) lo else hi), motion))
            val end = seg.x0 + seg.v0 * m
            if (end < lo || end > hi) {
                val bound = if (end < lo) lo else hi
                val hit = -m * ln(1 - (bound - seg.x0) / (seg.v0 * m))
                if (t - seg.t0 >= hit) return GlidePhase.Settling(Segment.MotionSeg(seg.t0 + hit, listOf(bound), listOf(seg.v0 * exp(-hit / m)), listOf(bound), motion))
            }
        }
        val e = exp(-(t - seg.t0) / m)
        return GlidePhase.Gliding(seg.x0 + seg.v0 * m * (1 - e), seg.v0 * e)
    }

    private fun followSegment(key: String, f: Pair<Follow, State>, anchor: Double, t: Double) = Segment.FollowSeg(key, t, anchor, inputAt(f.first.input, t), f.first, f.second)

    // inputs and evaluation

    /** Seconds a motion waits: its `delay`, or (v1.2) input × times + plus, from 0 up to max. */
    private fun delayOf(motion: Motion, t: Double): Double {
        val d = motion.delayInput ?: return motion.delay
        return minOf(d.max ?: Double.POSITIVE_INFINITY, maxOf(0.0, inputAt(d.input, t) * d.times + d.plus))
    }

    // cues (1.3)

    private fun amount(a: CueAmount?, fallback: Double, t: Double): Double = when (a) {
        null -> fallback
        is CueAmount.Number -> a.value
        is CueAmount.Input -> inputAt(a.input, t) * a.times + a.plus
    }

    private fun push(cue: Cue, at: Double, owner: State?, t: Double) {
        val last = lastCue[cue]
        if (cue.throttle != null && last != null && at - last < cue.throttle - 1e-9) return
        lastCue[cue] = at
        scheduled.add(ScheduledCue(at, ++cueSeq, cue, owner, amount(cue.intensity, 1.0, t).coerceIn(0.0, 1.0), amount(cue.pitch, 0.0, t)))
    }

    /** Schedules a cue's firings for a moment at [t]. Under reduced motion its delay is ignored, as motion's is. */
    private fun schedule(cue: Cue, t: Double, owner: State?) {
        val d = cue.delayInput
        var wait = if (d != null) minOf(d.max ?: Double.POSITIVE_INFINITY, maxOf(0.0, inputAt(d.input, t) * d.times + d.plus)) else cue.delay
        if (reduced) wait = 0.0
        for (k in 0 until cue.repeatCount) push(cue, t + wait + k * cue.repeatEvery, owner, t)
    }

    private fun activeStates(): Set<State> {
        val out = java.util.Collections.newSetFromMap(java.util.IdentityHashMap<State, Boolean>())
        walkActive(active) { out.add(it) }
        return out
    }

    /** The cues of what happened at [t]: transitions that fired, states entered (and their entry beats), states left. */
    private fun cueMoment(t: Double, fired: List<Transition>, entered: List<State>, before: Set<State>) {
        val after = activeStates()
        scheduled.removeAll { c -> val o = c.owner; o != null && c.t > t && ((o in before && o !in after) || entered.any { it === o }) }
        for (transition in fired) for (cue in transition.cues) schedule(cue, t, null)
        // Emitters send a wave (1.4); under reduced motion, nothing flies.
        if (!reduced) {
            for (name in fired.flatMap { it.emit } + entered.flatMap { it.emit }) {
                val n = waveCount[name] ?: 0
                waveCount[name] = n + 1
                waves.add(Wave(name, n, t))
            }
        }
        for (state in entered) {
            for (cue in state.cues) schedule(cue, t, state)
            for ((_, effect) in state.enter) {
                if (effect !is EntryEffect.Keyframes) continue
                val beats = effect.frames.filter { it.cues.isNotEmpty() }
                // Reduced motion skips the beats; their first cue still marks the moment.
                if (reduced) {
                    for (cue in beats.firstOrNull()?.cues ?: emptyList()) schedule(cue, t, state)
                    continue
                }
                for (frame in beats) for (cue in frame.cues) schedule(cue, t + frame.at * effect.duration, state)
            }
        }
        flushCues(t)
    }

    /** Moves cues due by [time] to [due], with the loop beats since the last flush. */
    private fun flushCues(time: Double) {
        if (time > cueCursor) {
            // By property name, so every runtime lists beats due at the same time in the same order.
            for ((_, running) in loops.entries.sortedBy { it.key }) {
                val loop = running.loop
                if (loop.cues.isEmpty()) continue
                val start = running.t0 + loop.delay
                var k = maxOf(0, Math.floor((cueCursor - start) / loop.duration).toInt())
                while (start + k * loop.duration <= time) {
                    for ((at, cues) in loop.cues) {
                        val beat = start + (k + at) * loop.duration
                        if (beat <= cueCursor || beat > time) continue
                        for (cue in cues) push(cue, beat, running.owner, beat)
                    }
                    k++
                }
            }
            cueCursor = time
        }
        val ready = scheduled.filter { it.t <= time + 1e-9 }.sortedWith(compareBy({ it.t }, { it.seq }))
        if (ready.isEmpty()) return
        scheduled.removeAll(ready.toSet())
        for (c in ready) due.add(FiredCue(c.t, c.cue.sound, c.cue.haptic, c.intensity, c.pitch))
    }

    /**
     * Cues that have come due since the last call (1.3), in time order: from transitions, entered
     * states, entry keyframes and loop beats. Each has the time it was due.
     */
    fun takeCues(): List<FiredCue> {
        val out = due.toList()
        due.clear()
        return out
    }

    private fun inputAt(name: String, t: Double): Double {
        var value = 0.0
        for ((ti, v) in inputs[name] ?: return 0.0) { if (ti > t) break; value = v }
        return value
    }

    private fun velocityAt(name: String, t: Double): Double {
        val points = (inputs[name] ?: return 0.0).filter { it.first >= t - VELOCITY_WINDOW - 1e-9 && it.first <= t + 1e-9 }
        if (points.size < 2) return 0.0
        val mt = points.sumOf { it.first } / points.size
        val mv = points.sumOf { it.second } / points.size
        var num = 0.0
        var den = 0.0
        for ((ti, v) in points) { num += (ti - mt) * (v - mv); den += (ti - mt) * (ti - mt) }
        return if (den == 0.0) 0.0 else num / den
    }

    private fun evaluate(seg: Segment, t: Double): Pair<List<Double>, List<Double>> = when (seg) {
        is Segment.FollowSeg -> {
            // A multiplying follow scales by the input's ratio since entry (a pinch); otherwise it adds the change.
            // From an input at 0 there is no ratio, so it holds.
            val gain = if (!seg.follow.multiply) 1.0 else if (seg.input0 == 0.0) 0.0 else seg.anchor / seg.input0
            val raw = if (seg.follow.multiply) (if (seg.input0 == 0.0) seg.anchor else inputAt(seg.follow.input, t) * gain) else seg.anchor + inputAt(seg.follow.input, t) - seg.input0
            var value = raw
            var factor = 1.0
            resolvedRange(seg.key, seg.follow.range)?.let { (lo, hi) ->
                if (raw < lo) { value = lo - (lo - raw) * seg.follow.overdrag; factor = seg.follow.overdrag }
                else if (raw > hi) { value = hi + (raw - hi) * seg.follow.overdrag; factor = seg.follow.overdrag }
            }
            listOf(value) to listOf(velocityAt(seg.follow.input, t) * factor * gain)
        }
        is Segment.MotionSeg -> evaluateMotion(seg, t)
        is Segment.KeyframesSeg -> evaluateKeyframes(seg, t)
        is Segment.DelayedSeg -> if (t < seg.t0) evaluate(seg.prev, t) else evaluateMotion(started(seg), t)
        is Segment.GlideSeg -> when (val p = glidePhase(seg, t)) {
            is GlidePhase.Settling -> evaluateMotion(p.motion, t)
            is GlidePhase.Gliding -> listOf(p.pos) to listOf(p.vel)
        }
    }

    /** The motion a delayed segment becomes: from wherever [Segment.DelayedSeg.prev] is when the delay ends. */
    private fun started(seg: Segment.DelayedSeg): Segment.MotionSeg {
        val (from, v0) = evaluate(seg.prev, seg.t0)
        return Segment.MotionSeg(seg.t0, from, v0, seg.to, seg.motion)
    }

    /** A loop's offset and its rate at [t]; 0 before its delay, and while a measured point is unknown. */
    private fun loopOffset(key: String, running: ActiveLoop, t: Double): Pair<Double, Double> {
        val loop = running.loop
        val local = t - running.t0 - loop.delay
        if (local < 0) return 0.0 to 0.0
        val points = ArrayList<Pair<Double, Double>>()
        points.add(0.0 to 0.0)
        for ((at, value) in loop.frames + (1.0 to loop.to)) points.add(at to (endpoint(key, value) ?: return 0.0 to 0.0))
        val u = (local - loop.duration * floor(local / loop.duration)) / loop.duration
        for (i in 1 until points.size) {
            val (a0, v0) = points[i - 1]
            val (a1, v1) = points[i]
            if (u > a1) continue
            val p = (u - a0) / (a1 - a0)
            val ease = (if (i >= 2) loop.frameEases.getOrNull(i - 2) else null) ?: loop.ease
            return v0 + (v1 - v0) * easeAt(ease, p) to (v1 - v0) * easeSlope(ease, p) / ((a1 - a0) * loop.duration)
        }
        return points.last().second to 0.0
    }

    /** What a property shows: its motion, plus the offset of a running loop. */
    private fun displayed(key: String, t: Double): Pair<List<Double>, List<Double>> {
        val (pos, vel) = evaluate(segments.getValue(key), t)
        val running = loops[key] ?: return pos to vel
        val (offset, rate) = loopOffset(key, running, t)
        return listOf(pos[0] + offset) to listOf(vel[0] + rate)
    }

    /**
     * Entry keyframes at [t]. Measured frames (1.5) resolve now, so they follow relayout; one not
     * reported yet is left out. Each leg takes the ease of the frame it starts from, else the effect's.
     */
    private fun evaluateKeyframes(seg: Segment.KeyframesSeg, t: Double): Pair<List<Double>, List<Double>> {
        val u = (t - seg.t0) / seg.duration
        if (u >= 1) return seg.to to seg.to.map { 0.0 }
        val points = ArrayList<Keyframe>()
        points.add(Keyframe(0.0, seg.from))
        for (frame in seg.frames) {
            val m = frame.measure
            if (m == null) points.add(frame) else measured(seg.key, m)?.let { points.add(Keyframe(frame.at, listOf(it), ease = frame.ease)) }
        }
        points.add(Keyframe(1.0, seg.to))
        for (i in 1 until points.size) {
            val a = points[i - 1]
            val b = points[i]
            if (u > b.at) continue
            val local = maxOf(0.0, (u - a.at) / (b.at - a.at))
            val legEase = a.ease ?: seg.ease
            val progress = easeAt(legEase, local)
            val slope = easeSlope(legEase, local) / ((b.at - a.at) * seg.duration)
            return a.value.zip(b.value) { from, to -> from + (to - from) * progress } to a.value.zip(b.value) { from, to -> (to - from) * slope }
        }
        return seg.to to seg.to.map { 0.0 }
    }

    private fun evaluateMotion(seg: Segment.MotionSeg, t: Double): Pair<List<Double>, List<Double>> {
        val dt = t - seg.t0
        val zero = seg.to.map { 0.0 }
        return when (val m = seg.motion) {
            null -> seg.to to zero
            is Motion.Tween -> {
                if (dt >= m.duration) return seg.to to zero
                val u = dt / m.duration
                val p = easeAt(m.ease, u)
                val slope = easeSlope(m.ease, u) / m.duration
                seg.from.zip(seg.to) { f, to -> f + (to - f) * p } to seg.from.zip(seg.to) { f, to -> (to - f) * slope }
            }
            is Motion.Spring -> {
                val pos = ArrayList<Double>()
                val vel = ArrayList<Double>()
                for (i in seg.from.indices) {
                    val (x, v) = springAt(m.stiffness, m.damping, m.mass, seg.from[i] - seg.to[i], seg.v0[i], dt)
                    pos.add(seg.to[i] + x); vel.add(v)
                }
                pos to vel
            }
        }
    }

    // transitions

    private fun nearest(machine: Machine.States, choice: Nearest, t: Double): String {
        val (pos, vel) = displayed(choice.by, t)
        val projected = pos[0] + vel[0] * choice.momentum
        var best = choice.states[0]
        var bestDistance = Double.POSITIVE_INFINITY
        for (name in choice.states) {
            val hypothetical = HashMap(active)
            exitMachine(machine, hypothetical, live = false)
            enterState(machine, name, hypothetical, ArrayList(), t, live = false)
            val distance = abs(projected - resolveTargets(hypothetical).getValue(choice.by)[0])
            if (distance < bestDistance) { best = name; bestDistance = distance }
        }
        return best
    }

    private fun perform(machine: Machine.States, transition: Transition, t: Double, fired: MutableList<Transition>, entered: MutableList<State>) {
        fired.add(transition)
        if (transition.to == null && transition.nearest == null) return
        val target = transition.to ?: nearest(machine, transition.nearest!!, t)
        exitMachine(machine, active)
        enterState(machine, target, active, entered, t)
    }

    private fun handle(machine: Machine, event: String, t: Double, fired: MutableList<Transition>, entered: MutableList<State>): Boolean = when (machine) {
        is Machine.Regions -> {
            var handled = false
            for ((_, r) in machine.regions) if (handle(r, event, t, fired, entered)) handled = true
            handled
        }
        is Machine.States -> {
            val s = machine.state(active.getValue(machine))
            if (s.machine != null && handle(s.machine, event, t, fired, entered)) true
            else {
                val transition = s.transition(event) ?: machine.`when`.firstOrNull { it.first == event }?.second
                if (transition == null) false else { perform(machine, transition, t, fired, entered); true }
            }
        }
    }

    private fun settle(t: Double, fired: List<Transition>, entered: List<State>, snap: Boolean = false) {
        val committed = HashSet<String>()
        for (tr in fired) {
            for (key in tr.commit ?: emptyList()) {
                bases[key] = listOf(clamp(key, displayed(key, t).first[0]))
                measuredBases.remove(key)
                committed.add(key)
            }
            for ((key, delta) in tr.step ?: emptyList()) {
                val from = measuredBases[key]?.let { measured(key, it) } ?: bases.getValue(key)[0]
                bases[key] = listOf(clamp(key, from + delta))
                measuredBases.remove(key)
            }
        }
        val overrides = HashMap<String, Motion>()
        for (tr in fired) for ((key, m) in tr.animate) overrides[key] = m
        val targets = resolveTargets(active)
        val follows = activeFollows(active)
        val glides = activeGlides(active)
        val activeStates = LinkedHashSet<State>()
        walkActive(active) { activeStates.add(it) }
        val isEntered = { s: State -> entered.any { it === s } }

        // A loop that ends hands off like a released drag: the motion continues from the
        // displayed value with the loop's velocity, its offset first reduced by `wrap`.
        val handoff = HashMap<String, Pair<List<Double>, List<Double>>>()
        for ((key, running) in loops.entries.toList()) {
            if (running.owner in activeStates && !isEntered(running.owner)) continue
            val (pos, vel) = evaluate(segments.getValue(key), t)
            var (offset, rate) = loopOffset(key, running, t)
            // Into (-wrap/2, wrap/2]: the same rule in every runtime, whatever its rounding.
            running.loop.wrap?.let { wrap -> offset -= wrap * ceil(offset / wrap - 0.5) }
            handoff[key] = listOf(pos[0] + offset) to listOf(vel[0] + rate)
            loops.remove(key)
        }
        for (s in activeStates) if (isEntered(s)) for ((key, loop) in s.loop) if (loopPlays(key)) loops[key] = ActiveLoop(loop, s, t)

        for ((key, prop) in program.properties) {
            if (prop.map != null) continue
            val seg = segments.getValue(key)
            val f = follows[key]
            if (f != null) {
                val keep = seg is Segment.FollowSeg && seg.owner === f.second && !isEntered(f.second) && key !in handoff
                if (!keep) segments[key] = followSegment(key, f, (handoff[key] ?: evaluate(seg, t)).first[0], t)
                continue
            }
            val g = glides[key]
            if (g != null) {
                // Glide on from wherever the value is, with the velocity it has.
                val keep = seg is Segment.GlideSeg && seg.owner === g.second && !isEntered(g.second) && key !in handoff
                if (!keep) {
                    val (pos, vel) = handoff[key] ?: evaluate(seg, t)
                    segments[key] = Segment.GlideSeg(key, t, pos[0], if (key in committed) 0.0 else vel[0], g.first, g.second)
                }
                continue
            }
            val to = targets.getValue(key)
            if (seg is Segment.KeyframesSeg && seg.owner in activeStates && !isEntered(seg.owner) && key !in handoff) {
                segments[key] = seg.copy(to = to)
                continue
            }
            if ((seg is Segment.MotionSeg && seg.to == to || seg is Segment.DelayedSeg && seg.to == to) && key !in handoff) continue
            if (snap) { segments[key] = Segment.MotionSeg(t, to, to.map { 0.0 }, to, null); continue }
            val (pos, v) = handoff[key] ?: evaluate(seg, t)
            val vel = if (key in committed) v.map { 0.0 } else v
            val motion = overrides[key] ?: program.animate[key]
            val wait = motion?.let { delayOf(it, t) } ?: 0.0
            if (motion != null && wait > 0 && !reduced) {
                // Until the delay ends the property keeps doing what it was doing: a pending
                // motion that hasn't started is dropped, and a value placed here holds still.
                val prev = when {
                    key in handoff || key in committed -> Segment.MotionSeg(t, pos, vel.map { 0.0 }, pos, null)
                    seg is Segment.DelayedSeg && t < seg.t0 -> seg.prev
                    else -> seg
                }
                segments[key] = Segment.DelayedSeg(t + wait, prev, to, motion)
                continue
            }
            segments[key] = Segment.MotionSeg(t, pos, vel, to, motion?.let { if (reduced) REDUCED else it })
        }
        if (reduced) return
        for (s in entered) {
            for ((key, effect) in s.enter) {
                val seg = segments.getValue(key)
                val to = when (seg) {
                    is Segment.MotionSeg -> seg.to
                    is Segment.KeyframesSeg -> seg.to
                    is Segment.DelayedSeg -> seg.to
                    is Segment.FollowSeg, is Segment.GlideSeg -> continue
                }
                val (pos, v) = evaluate(seg, t)
                when (effect) {
                    is EntryEffect.Keyframes -> segments[key] = Segment.KeyframesSeg(key, t, pos, to, effect.frames, effect.duration, effect.ease, s)
                    is EntryEffect.Kick -> {
                        val vel = v.toMutableList()
                        val kick = effect.motion
                        if (kick is Motion.Spring) vel[0] += kick.kick ?: 0.0
                        segments[key] = Segment.MotionSeg(t, pos, vel, to, kick)
                    }
                }
            }
        }
    }

    /** Fires every timer and long press due by [t], earliest first; a timer before a long press due at the same time. */
    private fun fireDue(t: Double) {
        while (true) {
            var next: Pending? = null
            for (p in pending) if (p.pausedAt == null && p.due <= t + 1e-9 && (next == null || p.due < next.due || (p.due == next.due && p.order < next.order))) next = p
            var press: Pair<String, Double>? = null
            for ((target, due) in pressDue) if (due <= t + 1e-9 && (press == null || due < press.second)) press = target to due
            if (press != null && (next == null || press.second < next.due)) {
                flushCues(press.second)
                pressDue.remove(press.first)
                longPressed.add(press.first)
                dispatch("${press.first}.longpress", press.second)
                continue
            }
            val due = next ?: return
            pending.remove(due)
            val fired = ArrayList<Transition>()
            val entered = ArrayList<State>()
            // Loop beats up to the timer belong to the states before it.
            flushCues(due.due)
            val before = activeStates()
            perform(due.machine, due.transition, due.due, fired, entered)
            settle(due.due, fired, entered)
            cueMoment(due.due, fired, entered, before)
        }
    }

    private fun controlTimers(event: String, t: Double): Boolean {
        var handled = false
        for (timer in pending) for ((i, pair) in timer.pause.withIndex()) {
            if (event == pair.on) {
                handled = true
                if (i in timer.blockers) continue
                if (timer.blockers.isEmpty()) timer.pausedAt = t
                timer.blockers.add(i)
            } else if (event == pair.off) {
                handled = true
                if (!timer.blockers.remove(i) || timer.blockers.isNotEmpty()) continue
                timer.due += t - timer.pausedAt!!
                timer.pausedAt = null
            }
        }
        return handled
    }

    private fun advanceTo(t: Double) {
        require(t.isFinite() && t >= now) { "Time must not go backwards: got $t, already at $now." }
        now = t
        fireDue(t)
        flushCues(t)
    }

    private fun valueOf(key: String, t: Double): List<Double> {
        val p = program.property(key)
        p.map?.let {
            val (from, to) = resolvedMap(key, it) ?: return p.base
            val source = if (it.sourceKind == "input") inputAt(it.source, t) else displayed(it.source, t).first[0]
            return interpolate(from, to, source)
        }
        return displayed(key, t).first
    }

    // public API

    /** Sends an event at time `t` (seconds). Returns false if nothing handled it. */
    fun send(event: String, t: Double): Boolean {
        advanceTo(t)
        val target = event.substringBefore('.')
        val name = event.substringAfter('.', "")
        if (name == "dragstart") {
            for (axis in listOf("x", "y")) inputs["$target.drag.$axis"] = mutableListOf(t to 0.0)
            for (c in crossings) if (c.input.startsWith("$target.drag.")) c.inside = c.initial()
        }
        if (name == "pinchstart") {
            // A pinch's inputs start over: ratio 1, rotation and travel 0 (v0.18).
            for ((input, start) in listOf("scale" to 1.0, "rotation" to 0.0, "x" to 0.0, "y" to 0.0)) {
                inputs["$target.pinch.$input"] = mutableListOf(t to start)
                for (c in crossings) if (c.input == "$target.pinch.$input") c.inside = if (c.above) start > c.value else start < c.value
            }
        }
        if (name == "down" && "$target.longpress" in wants) {
            pressDue[target] = t + LONG_PRESS
            longPressed.remove(target)
        }
        if (name == "up" || name == "cancel" || name == "dragstart" || name == "pinchstart") pressDue.remove(target)
        if (name == "tap" && longPressed.remove(target)) return false
        val handled = dispatch(event, t)
        if (name == "tap" && "$target.doubletap" in wants) {
            val previous = lastTap[target]
            if (previous != null && t - previous <= DOUBLE_TAP + 1e-9) {
                lastTap.remove(target)
                return dispatch("$target.doubletap", t) || handled
            }
            lastTap[target] = t
        }
        return handled
    }

    /** Delivers one event at [t]: pause reasons first, then the machine. False if nothing handled it. */
    private fun dispatch(event: String, t: Double): Boolean {
        val fired = ArrayList<Transition>()
        val entered = ArrayList<State>()
        val timerHandled = controlTimers(event, t)
        val before = activeStates()
        if (!handle(program.machine, event, t, fired, entered)) return timerHandled
        settle(t, fired, entered)
        cueMoment(t, fired, entered, before)
        return true
    }

    /**
     * The host's reduced-motion setting changed at time [t]. Motions started from then on follow
     * it, and so do loops: turning it on stops the loops it doesn't allow (they hand off as on a
     * state exit and return with the reduced tween), turning it off starts the active states'
     * loops from [t]. Motions already moving finish as they are.
     */
    fun setReducedMotion(on: Boolean, t: Double) {
        advanceTo(t)
        if (on == reduced) return
        reduced = on
        for ((key, running) in loops.entries.toList()) {
            if (loopPlays(key)) continue
            val segment = segments.getValue(key)
            loops.remove(key)
            val to = when (segment) {
                is Segment.MotionSeg -> segment.to
                is Segment.KeyframesSeg -> segment.to
                is Segment.DelayedSeg -> segment.to
                else -> continue
            }
            val (pos, vel) = evaluate(segment, t)
            var (offset, rate) = loopOffset(key, running, t)
            // Into (-wrap/2, wrap/2], as when a state with a loop is left.
            running.loop.wrap?.let { wrap -> offset -= wrap * ceil(offset / wrap - 0.5) }
            segments[key] = Segment.MotionSeg(t, listOf(pos[0] + offset), listOf(vel[0] + rate), to, REDUCED)
        }
        walkActive(active) { s -> for ((key, loop) in s.loop) if (key !in loops && loopPlays(key)) loops[key] = ActiveLoop(loop, s, t) }
    }

    /** Records a referenced continuous input or a layout report. */
    fun input(name: String, value: Double, t: Double): Boolean {
        advanceTo(t)
        val parts = name.split(".")
        if (!value.isFinite()) return false
        if (parts.size == 3 && parts[0] in program.targets && parts[1] == "layout") {
            if (parts[2] !in LAYOUT_NAMES) return false
            val first = name !in layout
            if (layout[name] == value) return true
            layout[name] = value
            settle(t, emptyList(), emptyList(), snap = first)
            return true
        }
        if (name !in requiredInputs) return false
        inputs.getOrPut(name) { ArrayList() }.add(t to value)
        // A target read from this input moves to the new value with its motion, before any
        // event the sample derives.
        if (name in targetInputs) settle(t, emptyList(), emptyList())
        // Direction first: a scroll that has come back SCROLL_SLOP from its furthest point turns.
        scrolls[name]?.let { s ->
            if (s.dir != true && value >= s.ref + SCROLL_SLOP) {
                s.dir = true; s.ref = value
                dispatch(s.forth, t)
            } else if (s.dir != false && value <= s.ref - SCROLL_SLOP) {
                s.dir = false; s.ref = value
                dispatch(s.back, t)
            } else if (s.dir == true) s.ref = maxOf(s.ref, value)
            else if (s.dir == false) s.ref = minOf(s.ref, value)
        }
        // Then crossings: each fires once on entering its side, and again only after leaving it.
        for (c in crossings) {
            if (c.input != name) continue
            val inside = if (c.above) value > c.value else value < c.value
            if (inside && !c.inside) dispatch(c.event, t)
            c.inside = inside
        }
        return true
    }

    /** Values at time `t`: numbers in logical units, colors as hex. */
    fun sample(t: Double): Map<String, Value> {
        advanceTo(t)
        return program.properties.associate { (key, prop) ->
            val c = valueOf(key, t)
            key to if (prop.kind == PropertyKind.COLOR) Value.Color(oklabToHex(c)) else Value.Number(c[0])
        }
    }

    /** Active leaf states as paths, e.g. ["on"] or ["checked/on", "press/up"]. */
    fun state(): List<String> {
        val out = ArrayList<String>()
        fun walk(m: Machine, prefix: String) {
            when (m) {
                is Machine.Regions -> for ((name, r) in m.regions) walk(r, if (prefix.isEmpty()) name else "$prefix/$name")
                is Machine.States -> {
                    val name = active.getValue(m)
                    val path = if (prefix.isEmpty()) name else "$prefix/$name"
                    val inner = m.state(name).machine
                    if (inner != null) walk(inner, path) else out.add(path)
                }
            }
        }
        walk(program.machine, "")
        return out
    }

    /** True when every property has come to rest and no unpaused timer is counting down. */
    fun settled(t: Double, property: String? = null): Boolean {
        advanceTo(t)
        if (property == null && (pending.any { it.pausedAt == null } || pressDue.isNotEmpty() || scheduled.isNotEmpty() || flying(t))) return false
        val keys = property?.let { listOf(it) } ?: program.properties.map { it.first }
        return keys.all { atRest(it, t) }
    }

    /** True when every property has come to rest, whatever timers are pending: nothing is moving. */
    fun resting(t: Double): Boolean {
        advanceTo(t)
        if (flying(t)) return false
        return program.properties.all { atRest(it.first, t) }
    }

    /** The latest time the runtime has been advanced to by an event, input or sample. */
    fun time(): Double = now

    /** True while an active state loops a property (v0.10): values change every frame though nothing is settling. */
    fun looping(): Boolean = loops.isNotEmpty()

    private fun emitter(name: String) = program.emitters.first { it.first == name }.second

    /** True while a wave has pieces still to launch or alive at [t] (1.4); drops the waves that are over. */
    private fun flying(t: Double): Boolean {
        waves.removeAll { w -> val e = emitter(w.name); t - w.t0 > (e.count - 1) * e.stagger + e.life.second }
        return waves.isNotEmpty()
    }

    /** The pieces flying at the time the runtime was last advanced to (1.4), of one emitter or all. */
    fun pieces(name: String? = null): List<Piece> {
        val out = ArrayList<Piece>()
        for (w in waves) {
            if (name != null && w.name != name) continue
            val e = emitter(w.name)
            for (i in 0 until e.count) pieceAt(w.name, e, w.wave, i, now - w.t0 - i * e.stagger)?.let(out::add)
        }
        return out
    }

    /** Whether one property has come to rest at [t]; see the spec's rest rule. */
    private fun atRest(key: String, t: Double): Boolean {
        if (program.property(key).map?.sourceKind == "input") return true
        val source = program.property(key).map?.source ?: key
        val current = segments.getValue(source)
        // A pending motion is a change still to come.
        if (current is Segment.DelayedSeg && t < current.t0) return false
        val unwrapped = if (current is Segment.DelayedSeg) started(current) else current
        val seg = if (unwrapped is Segment.GlideSeg) {
            when (val p = glidePhase(unwrapped, t)) {
                // Still gliding: at rest once what is left of its travel is under the threshold.
                is GlidePhase.Gliding -> return abs(p.vel) * unwrapped.glide.momentum < REST_NUMBER
                is GlidePhase.Settling -> p.motion
            }
        } else unwrapped
        if (seg is Segment.KeyframesSeg) return t - seg.t0 >= seg.duration
        if (seg !is Segment.MotionSeg || seg.motion == null) return true
        return when (val m = seg.motion) {
            is Motion.Tween -> t - seg.t0 >= m.duration
            is Motion.Spring -> {
                val (pos, vel) = evaluateMotion(seg, t)
                val eps = if (program.property(source).kind == PropertyKind.COLOR) REST_COLOR else REST_NUMBER
                val inertia = m.mass / m.stiffness
                pos.indices.all { hypot(pos[it] - seg.to[it], vel[it] * sqrt(inertia)) < eps }
            }
        }
    }
}
