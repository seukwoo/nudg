package dev.nudg

/** A compiled nudg program, read from the JSON that `nudg compile` writes (formats 1 to 4). */

enum class PropertyKind { LENGTH, NUMBER, COLOR }

sealed interface Ease {
    data object Linear : Ease
    data class Bezier(val x1: Double, val y1: Double, val x2: Double, val y2: Double) : Ease
}

sealed interface Motion {
    data class Spring(val stiffness: Double, val damping: Double, val mass: Double, val kick: Double?) : Motion
    data class Tween(val duration: Double, val ease: Ease) : Motion
}

data class Keyframe(val at: Double, val value: List<Double>)
sealed interface EntryEffect {
    data class Kick(val motion: Motion) : EntryEffect
    data class Keyframes(val frames: List<Keyframe>, val duration: Double, val ease: Ease) : EntryEffect
}

data class Measure(val target: String, val of: String, val times: Double, val plus: Double)
sealed interface MeasuredEndpoint {
    data class Number(val value: Double) : MeasuredEndpoint
    data class Measured(val measure: Measure) : MeasuredEndpoint
}
/** A periodic offset added to a property while its state is active (v0.10). */
data class Loop(val to: MeasuredEndpoint, val frames: List<Pair<Double, MeasuredEndpoint>>, val duration: Double, val ease: Ease, val delay: Double, val wrap: Double?)
/** A map's value at one point: channels, or a measured number (v0.11). */
sealed interface MapValue {
    data class Channels(val values: List<Double>) : MapValue
    data class Measured(val measure: Measure) : MapValue
}
data class PropertyMap(val source: String, val sourceKind: String, val from: List<MeasuredEndpoint>, val to: List<MapValue>)
data class Property(val kind: PropertyKind, val base: List<Double>, val map: PropertyMap?, val measure: Measure?, val min: Double?, val max: Double?)
data class Follow(val input: String, val range: Pair<MeasuredEndpoint, MeasuredEndpoint>?, val overdrag: Double)
data class Nearest(val states: List<String>, val by: String, val momentum: Double)

class Transition(val to: String?, val nearest: Nearest?, val animate: List<Pair<String, Motion>>, val step: List<Pair<String, Double>>?, val commit: List<String>?)
data class TimerPause(val on: String, val off: String)
class Timer(val key: String, val delay: Double, val transition: Transition, val pause: List<TimerPause>)

class State(
    val name: String,
    val set: List<Pair<String, List<Double>>>,
    val measure: Map<String, Measure>,
    val follow: List<Pair<String, Follow>>,
    val enter: List<Pair<String, EntryEffect>>,
    val loop: List<Pair<String, Loop>>,
    val `when`: List<Pair<String, Transition>>,
    val timers: List<Timer>,
    val machine: Machine?,
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
            val j = Json.parse(text) as Map<String, Any?>
            require((j["nudgProgram"] as? Double) in setOf(1.0, 2.0, 3.0, 4.0)) { "Not a compiled nudg program (formats 1 to 4). Compile it with `nudg compile`." }
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
            if (m["kind"] == "tween") {
                val e = m["ease"]
                val ease = if (e is List<*>) doubles(e).let { Ease.Bezier(it[0], it[1], it[2], it[3]) } else Ease.Linear
                return Motion.Tween(m["duration"] as Double, ease)
            }
            return Motion.Spring(m["stiffness"] as Double, m["damping"] as Double, m["mass"] as Double, m["kick"] as? Double)
        }

        private fun ease(v: Any?): Ease = if (v is List<*>) doubles(v).let { Ease.Bezier(it[0], it[1], it[2], it[3]) } else Ease.Linear

        private fun entryEffect(v: Any?): EntryEffect {
            val e = obj(v)
            if (e["kind"] == "keyframes") {
                val frames = list(e["frames"]).map { f -> obj(f).let { Keyframe(it["at"] as Double, doubles(it["value"])) } }
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
                list(s["follow"]).map { e ->
                    obj(e).let { f ->
                        val r = list(f["range"]).map(::endpoint)
                        (f["key"] as String) to Follow(f["input"] as String, if (r.size == 2) r[0] to r[1] else null, f["overdrag"] as Double)
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
            )
        }
    }
}
