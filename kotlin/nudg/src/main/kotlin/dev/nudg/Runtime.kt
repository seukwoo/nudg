package dev.nudg

import kotlin.math.abs
import kotlin.math.ceil
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
    data class KeyframesSeg(val t0: Double, val from: List<Double>, val to: List<Double>, val frames: List<Keyframe>, val duration: Double, val ease: Ease, val owner: State) : Segment
    data class FollowSeg(val key: String, val t0: Double, val anchor: Double, val input0: Double, val follow: Follow, val owner: State) : Segment
    /** A motion that starts at [t0] (v0.12); until then the property does what [prev] does. */
    data class DelayedSeg(val t0: Double, val prev: Segment, val to: List<Double>, val motion: Motion) : Segment
}

private class Pending(var due: Double, val order: Int, val machine: Machine.States, val state: State, val transition: Transition, val pause: List<TimerPause>) {
    val blockers = HashSet<Int>()
    var pausedAt: Double? = null
}

/** A loop running since its state was entered at [t0]. */
private class ActiveLoop(val loop: Loop, val owner: State, val t0: Double)

private const val REST_NUMBER = 1e-3
private const val REST_COLOR = 1e-4
private const val VELOCITY_WINDOW = 0.1
private val REDUCED: Motion = Motion.Tween(0.15, Ease.Linear)
private val LAYOUT_NAMES = setOf("x", "y", "width", "height", "naturalWidth", "naturalHeight")

class Runtime(val program: Program, state: List<String> = emptyList(), private val reducedMotion: Boolean = false) {
    private val active = HashMap<Machine.States, String>()
    private val segments = HashMap<String, Segment>()
    /** Loops of the active states, by property (v0.10). Empty under reduced motion. */
    private val loops = LinkedHashMap<String, ActiveLoop>()
    private val inputs = HashMap<String, MutableList<Pair<Double, Double>>>()
    private val bases = HashMap<String, List<Double>>()
    private val pending = ArrayList<Pending>()
    private val layout = HashMap<String, Double>()
    private val measuredBases = HashMap<String, Measure>()
    private val requiredInputs = HashSet<String>()
    private var order = 0
    private var now = 0.0

    init {
        for ((key, prop) in program.properties) {
            prop.measure?.let { measuredBases[key] = it }
            if (prop.map == null) bases[key] = prop.base
            if (prop.map?.sourceKind == "input") requiredInputs.add(prop.map.source)
        }
        collectFollowInputs(program.machine)
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
        if (!reducedMotion) walkActive(active) { s -> for ((key, loop) in s.loop) loops[key] = ActiveLoop(loop, s, 0.0) }
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

    private fun collectFollowInputs(machine: Machine) {
        when (machine) {
            is Machine.Regions -> for ((_, region) in machine.regions) collectFollowInputs(region)
            is Machine.States -> for (state in machine.states) {
                for ((_, follow) in state.follow) requiredInputs.add(follow.input)
                state.machine?.let(::collectFollowInputs)
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

    private fun followSegment(key: String, f: Pair<Follow, State>, anchor: Double, t: Double) = Segment.FollowSeg(key, t, anchor, inputAt(f.first.input, t), f.first, f.second)

    // inputs and evaluation

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
            val raw = seg.anchor + inputAt(seg.follow.input, t) - seg.input0
            var value = raw
            var factor = 1.0
            resolvedRange(seg.key, seg.follow.range)?.let { (lo, hi) ->
                if (raw < lo) { value = lo - (lo - raw) * seg.follow.overdrag; factor = seg.follow.overdrag }
                else if (raw > hi) { value = hi + (raw - hi) * seg.follow.overdrag; factor = seg.follow.overdrag }
            }
            listOf(value) to listOf(velocityAt(seg.follow.input, t) * factor)
        }
        is Segment.MotionSeg -> evaluateMotion(seg, t)
        is Segment.KeyframesSeg -> evaluateKeyframes(seg, t)
        is Segment.DelayedSeg -> if (t < seg.t0) evaluate(seg.prev, t) else evaluateMotion(started(seg), t)
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
            return v0 + (v1 - v0) * easeAt(loop.ease, p) to (v1 - v0) * easeSlope(loop.ease, p) / ((a1 - a0) * loop.duration)
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

    private fun evaluateKeyframes(seg: Segment.KeyframesSeg, t: Double): Pair<List<Double>, List<Double>> {
        val u = (t - seg.t0) / seg.duration
        if (u >= 1) return seg.to to seg.to.map { 0.0 }
        val points = listOf(Keyframe(0.0, seg.from)) + seg.frames + Keyframe(1.0, seg.to)
        for (i in 1 until points.size) {
            val a = points[i - 1]
            val b = points[i]
            if (u > b.at) continue
            val local = maxOf(0.0, (u - a.at) / (b.at - a.at))
            val progress = easeAt(seg.ease, local)
            val slope = easeSlope(seg.ease, local) / ((b.at - a.at) * seg.duration)
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
        if (!reducedMotion) {
            for (s in activeStates) if (isEntered(s)) for ((key, loop) in s.loop) loops[key] = ActiveLoop(loop, s, t)
        }

        for ((key, prop) in program.properties) {
            if (prop.map != null) continue
            val seg = segments.getValue(key)
            val f = follows[key]
            if (f != null) {
                val keep = seg is Segment.FollowSeg && seg.owner === f.second && !isEntered(f.second) && key !in handoff
                if (!keep) segments[key] = followSegment(key, f, (handoff[key] ?: evaluate(seg, t)).first[0], t)
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
            if (motion != null && motion.delay > 0 && !reducedMotion) {
                // Until the delay ends the property keeps doing what it was doing: a pending
                // motion that hasn't started is dropped, and a value placed here holds still.
                val prev = when {
                    key in handoff || key in committed -> Segment.MotionSeg(t, pos, vel.map { 0.0 }, pos, null)
                    seg is Segment.DelayedSeg && t < seg.t0 -> seg.prev
                    else -> seg
                }
                segments[key] = Segment.DelayedSeg(t + motion.delay, prev, to, motion)
                continue
            }
            segments[key] = Segment.MotionSeg(t, pos, vel, to, motion?.let { if (reducedMotion) REDUCED else it })
        }
        if (reducedMotion) return
        for (s in entered) {
            for ((key, effect) in s.enter) {
                val seg = segments.getValue(key)
                val to = when (seg) {
                    is Segment.MotionSeg -> seg.to
                    is Segment.KeyframesSeg -> seg.to
                    is Segment.DelayedSeg -> seg.to
                    is Segment.FollowSeg -> continue
                }
                val (pos, v) = evaluate(seg, t)
                when (effect) {
                    is EntryEffect.Keyframes -> segments[key] = Segment.KeyframesSeg(t, pos, to, effect.frames, effect.duration, effect.ease, s)
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

    private fun fireDue(t: Double) {
        while (true) {
            var next: Pending? = null
            for (p in pending) if (p.pausedAt == null && p.due <= t + 1e-9 && (next == null || p.due < next.due || (p.due == next.due && p.order < next.order))) next = p
            val due = next ?: return
            pending.remove(due)
            val fired = ArrayList<Transition>()
            val entered = ArrayList<State>()
            perform(due.machine, due.transition, due.due, fired, entered)
            settle(due.due, fired, entered)
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
        val dot = event.indexOf('.')
        if (dot > 0 && event.substring(dot + 1) == "dragstart") {
            for (axis in listOf("x", "y")) inputs["${event.substring(0, dot)}.drag.$axis"] = mutableListOf(t to 0.0)
        }
        val fired = ArrayList<Transition>()
        val entered = ArrayList<State>()
        val timerHandled = controlTimers(event, t)
        if (!handle(program.machine, event, t, fired, entered)) return timerHandled
        settle(t, fired, entered)
        return true
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
        if (property == null && pending.any { it.pausedAt == null }) return false
        val keys = property?.let { listOf(it) } ?: program.properties.map { it.first }
        return keys.all { atRest(it, t) }
    }

    /** True when every property has come to rest, whatever timers are pending: nothing is moving. */
    fun resting(t: Double): Boolean {
        advanceTo(t)
        return program.properties.all { atRest(it.first, t) }
    }

    /** The latest time the runtime has been advanced to by an event, input or sample. */
    fun time(): Double = now

    /** True while an active state loops a property (v0.10): values change every frame though nothing is settling. */
    fun looping(): Boolean = loops.isNotEmpty()

    /** Whether one property has come to rest at [t]; see the spec's rest rule. */
    private fun atRest(key: String, t: Double): Boolean {
        if (program.property(key).map?.sourceKind == "input") return true
        val source = program.property(key).map?.source ?: key
        val current = segments.getValue(source)
        // A pending motion is a change still to come.
        if (current is Segment.DelayedSeg && t < current.t0) return false
        val seg = if (current is Segment.DelayedSeg) started(current) else current
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
