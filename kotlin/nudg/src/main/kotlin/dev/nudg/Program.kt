package dev.nudg

/** A compiled nudg program, read from the JSON that `nudg compile` writes (formats 1 to 10). */

enum class PropertyKind { LENGTH, NUMBER, COLOR }

sealed interface Ease {
    data object Linear : Ease
    data class Bezier(val x1: Double, val y1: Double, val x2: Double, val y2: Double) : Ease
}

/** A delay read from an app input when the transition fires (v1.2): input × times + plus seconds, from 0 up to max. */
data class DelayInput(val input: String, val times: Double, val plus: Double, val max: Double?)

sealed interface Motion {
    /** Seconds before the motion starts (v0.12). */
    val delay: Double
    /** A delay read from an input instead (v1.2). */
    val delayInput: DelayInput?
    data class Spring(val stiffness: Double, val damping: Double, val mass: Double, val kick: Double?, override val delay: Double = 0.0, override val delayInput: DelayInput? = null) : Motion
    data class Tween(val duration: Double, val ease: Ease, override val delay: Double = 0.0, override val delayInput: DelayInput? = null) : Motion
}

data class Keyframe(val at: Double, val value: List<Double>, val cues: List<Cue> = emptyList())

/** A number, or one read from an app input when the cue fires (1.3): input × times + plus. */
sealed interface CueAmount {
    data class Number(val value: Double) : CueAmount
    data class Input(val input: String, val times: Double, val plus: Double) : CueAmount
}

/** A named moment for sound and haptics (1.3). Compared by identity, so a throttle can tell one cue from another. */
class Cue(
    val sound: String?,
    val haptic: String?,
    val intensity: CueAmount?,
    val pitch: CueAmount?,
    val delay: Double,
    val delayInput: DelayInput?,
    val repeatCount: Int,
    val repeatEvery: Double,
    val throttle: Double?,
)
sealed interface EntryEffect {
    data class Kick(val motion: Motion) : EntryEffect
    data class Keyframes(val frames: List<Keyframe>, val duration: Double, val ease: Ease) : EntryEffect
}

data class Measure(val target: String, val of: String, val times: Double, val plus: Double)
/** A state target read from a continuous input (v0.17), scaled and offset like a measurement. */
data class InputTarget(val input: String, val times: Double, val plus: Double)
sealed interface MeasuredEndpoint {
    data class Number(val value: Double) : MeasuredEndpoint
    data class Measured(val measure: Measure) : MeasuredEndpoint
}
/** A periodic offset added to a property while its state is active (v0.10). */
data class Loop(val to: MeasuredEndpoint, val frames: List<Pair<Double, MeasuredEndpoint>>, val duration: Double, val ease: Ease, val delay: Double, val wrap: Double?, val cues: List<Pair<Double, List<Cue>>> = emptyList())
/** A map's value at one point: channels, or a measured number (v0.11). */
sealed interface MapValue {
    data class Channels(val values: List<Double>) : MapValue
    data class Measured(val measure: Measure) : MapValue
}
data class PropertyMap(val source: String, val sourceKind: String, val from: List<MeasuredEndpoint>, val to: List<MapValue>)
data class Property(val kind: PropertyKind, val base: List<Double>, val map: PropertyMap?, val measure: Measure?, val min: Double?, val max: Double?)
/** [multiply]: scale by the input's ratio since entry instead of adding its change, for a pinch (v0.18). */
data class Follow(val input: String, val range: Pair<MeasuredEndpoint, MeasuredEndpoint>?, val overdrag: Double, val multiply: Boolean = false)
/** A property that keeps its velocity and slows down by itself while a state is active (v0.16). */
data class Glide(val momentum: Double, val range: Pair<MeasuredEndpoint, MeasuredEndpoint>?)
data class Nearest(val states: List<String>, val by: String, val momentum: Double)

class Transition(val to: String?, val nearest: Nearest?, val animate: List<Pair<String, Motion>>, val step: List<Pair<String, Double>>?, val commit: List<String>?, val cues: List<Cue> = emptyList())
data class TimerPause(val on: String, val off: String)
class Timer(val key: String, val delay: Double, val transition: Transition, val pause: List<TimerPause>)

class State(
    val name: String,
    val set: List<Pair<String, List<Double>>>,
    val measure: Map<String, Measure>,
    val input: Map<String, InputTarget>,
    val follow: List<Pair<String, Follow>>,
    val glide: List<Pair<String, Glide>>,
    val enter: List<Pair<String, EntryEffect>>,
    val loop: List<Pair<String, Loop>>,
    val `when`: List<Pair<String, Transition>>,
    val timers: List<Timer>,
    val machine: Machine?,
    /** Cues when the state is entered through a transition (1.3). */
    val cues: List<Cue> = emptyList(),
) {
    fun transition(event: String) = `when`.firstOrNull { it.first == event }?.second
}

sealed class Machine {
    class States(val initial: String, val states: List<State>, val `when`: List<Pair<String, Transition>>) : Machine() {
        fun state(name: String) = states.first { it.name == name }
    }
    class Regions(val regions: List<Pair<String, Machine>>) : Machine()
}

class Program(val version: String, val targets: List<String>, val properties: List<Pair<String, Property>>, val animate: Map<String, Motion>, val machine: Machine) {
    private val byKey = properties.toMap()
    fun property(key: String): Property = byKey.getValue(key)

    companion object {
        /** Reads `nudg compile` output. */
        fun decode(text: String): Program {
            @Suppress("UNCHECKED_CAST")
            return fromJson(Json.parse(text) as Map<String, Any?>)
        }

        internal fun fromJson(j: Map<String, Any?>): Program {
            require((j["nudgProgram"] as? Double) in setOf(1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0)) { "Not a compiled nudg program (formats 1 to 10). Compile it with `nudg compile`." }
            val properties = list(j["properties"]).map { p ->
                obj(p).let { m ->
                    (m["key"] as String) to Property(
                        PropertyKind.valueOf((m["kind"] as String).uppercase()),
                        doubles(m["base"]),
                        (m["map"] as? Map<*, *>)?.let { mp -> PropertyMap(mp["source"] as String, mp["sourceKind"] as? String ?: "property", list(mp["from"]).map(::endpoint), list(mp["to"]).map { v -> if (v is List<*>) MapValue.Channels(doubles(v)) else MapValue.Measured(measure(obj(v))) }) },
                        (m["measure"] as? Map<*, *>)?.let(::measure),
                        m["min"] as? Double,
                        m["max"] as? Double,
                    )
                }
            }
            val animate = list(j["animate"]).associate { a -> obj(a).let { (it["key"] as String) to motion(it["motion"]) } }
            return Program(j["version"] as String, list(j["targets"]).map { it as String }, properties, animate, machine(j["machine"]))
        }

        private fun obj(v: Any?) = v as Map<*, *>
        private fun list(v: Any?) = (v as? List<*>) ?: emptyList<Any?>()
        private fun doubles(v: Any?) = list(v).map { it as Double }
        private fun measure(m: Map<*, *>) = Measure(m["target"] as String, m["of"] as String, m["times"] as? Double ?: 1.0, m["plus"] as? Double ?: 0.0)
        private fun endpoint(value: Any?) = if (value is Double) MeasuredEndpoint.Number(value) else MeasuredEndpoint.Measured(measure(obj(value)))

        private fun motion(v: Any?): Motion {
            val m = obj(v)
            // Format 9 (v1.2): a delay read from an input is an object where a number used to be.
            val delayInput = (m["delay"] as? Map<*, *>)?.let { d -> DelayInput(d["input"] as String, d["times"] as? Double ?: 1.0, d["plus"] as? Double ?: 0.0, d["max"] as? Double) }
            val delay = m["delay"] as? Double ?: 0.0
            if (m["kind"] == "tween") {
                val e = m["ease"]
                val ease = if (e is List<*>) doubles(e).let { Ease.Bezier(it[0], it[1], it[2], it[3]) } else Ease.Linear
                return Motion.Tween(m["duration"] as Double, ease, delay, delayInput)
            }
            return Motion.Spring(m["stiffness"] as Double, m["damping"] as Double, m["mass"] as Double, m["kick"] as? Double, delay, delayInput)
        }

        /** Format 10 (1.3): a list of cues, where the file has one. */
        private fun cues(v: Any?): List<Cue> = list(v).map { c ->
            obj(c).let { m ->
                fun amount(a: Any?): CueAmount? = when (a) {
                    is Double -> CueAmount.Number(a)
                    is Map<*, *> -> CueAmount.Input(a["input"] as String, a["times"] as? Double ?: 1.0, a["plus"] as? Double ?: 0.0)
                    else -> null
                }
                val d = m["delay"] as? Map<*, *>
                val r = m["repeat"] as? Map<*, *>
                Cue(
                    m["sound"] as? String, m["haptic"] as? String,
                    amount(m["intensity"]), amount(m["pitch"]),
                    m["delay"] as? Double ?: 0.0,
                    d?.let { DelayInput(it["input"] as String, it["times"] as? Double ?: 1.0, it["plus"] as? Double ?: 0.0, it["max"] as? Double) },
                    (r?.get("count") as? Double)?.toInt() ?: 1, r?.get("every") as? Double ?: 0.0,
                    m["throttle"] as? Double,
                )
            }
        }

        private fun ease(v: Any?): Ease = if (v is List<*>) doubles(v).let { Ease.Bezier(it[0], it[1], it[2], it[3]) } else Ease.Linear

        private fun entryEffect(v: Any?): EntryEffect {
            val e = obj(v)
            if (e["kind"] == "keyframes") {
                val frames = list(e["frames"]).map { f -> obj(f).let { Keyframe(it["at"] as Double, doubles(it["value"]), cues(it["cue"])) } }
                return EntryEffect.Keyframes(frames, e["duration"] as Double, ease(e["ease"]))
            }
            return EntryEffect.Kick(motion(v))
        }

        private fun transition(v: Any?): Transition {
            val t = obj(v)
            return Transition(
                t["to"] as? String,
                (t["nearest"] as? Map<*, *>)?.let { n -> Nearest(list(n["states"]).map { it as String }, n["by"] as String, n["momentum"] as Double) },
                list(t["animate"]).map { a -> obj(a).let { (it["key"] as String) to motion(it["motion"]) } },
                (t["step"] as? List<*>)?.map { s -> obj(s).let { (it["key"] as String) to (it["delta"] as Double) } },
                (t["commit"] as? List<*>)?.map { it as String },
                cues(t["cue"]),
            )
        }

        private fun machine(v: Any?): Machine {
            val m = obj(v)
            if (m["kind"] == "regions") return Machine.Regions(list(m["regions"]).map { r -> obj(r).let { (it["name"] as String) to machine(it["machine"]) } })
            return Machine.States(
                m["initial"] as String,
                list(m["states"]).map(::state),
                list(m["when"]).map { w -> obj(w).let { (it["event"] as String) to transition(it) } },
            )
        }

        private fun state(v: Any?): State {
            val s = obj(v)
            return State(
                s["name"] as String,
                list(s["set"]).map { e -> obj(e).let { (it["key"] as String) to doubles(it["value"]) } },
                list(s["measure"]).associate { e -> obj(e).let { (it["key"] as String) to measure(it) } },
                list(s["input"]).associate { e -> obj(e).let { (it["key"] as String) to InputTarget(it["input"] as String, it["times"] as? Double ?: 1.0, it["plus"] as? Double ?: 0.0) } },
                list(s["follow"]).map { e ->
                    obj(e).let { f ->
                        val r = list(f["range"]).map(::endpoint)
                        (f["key"] as String) to Follow(f["input"] as String, if (r.size == 2) r[0] to r[1] else null, f["overdrag"] as Double, f["multiply"] as? Boolean ?: false)
                    }
                },
                list(s["glide"]).map { e ->
                    obj(e).let { g ->
                        val r = list(g["range"]).map(::endpoint)
                        (g["key"] as String) to Glide(g["momentum"] as Double, if (r.size == 2) r[0] to r[1] else null)
                    }
                },
                list(s["enter"]).map { e -> obj(e).let { (it["key"] as String) to entryEffect(it["effect"] ?: it["motion"]) } },
                list(s["loop"]).map { e ->
                    obj(e).let { l ->
                        (l["key"] as String) to Loop(
                            endpoint(l["to"]),
                            list(l["frames"]).map { f -> obj(f).let { (it["at"] as Double) to endpoint(it["value"]) } },
                            l["duration"] as Double,
                            ease(l["ease"]),
                            l["delay"] as? Double ?: 0.0,
                            l["wrap"] as? Double,
                            list(l["frames"]).mapNotNull { f -> obj(f).let { if (it["cue"] == null) null else (it["at"] as Double) to cues(it["cue"]) } },
                        )
                    }
                },
                list(s["when"]).map { w -> obj(w).let { (it["event"] as String) to transition(it) } },
                list(s["timers"]).map { t -> obj(t).let {
                    Timer(
                        it["key"] as String,
                        it["delay"] as Double,
                        transition(it["transition"]),
                        list(it["pause"]).map { p -> obj(p).let { pair -> TimerPause(pair["on"] as String, pair["off"] as String) } },
                    )
                } },
                s["machine"]?.let(::machine),
                cues(s["cue"]),
            )
        }
    }
}
