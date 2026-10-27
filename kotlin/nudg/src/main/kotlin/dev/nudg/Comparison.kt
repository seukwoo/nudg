package dev.nudg

/**
 * A comparison bundle, as `nudg compare a b --bundle x.compare.json` writes it: both
 * versions compiled, the events they play under, and what the verdict says. The Compose
 * adapter's NudgCompare plays it on the app's own composables.
 */
class Comparison(
    /** What to call A (before) and B (the change). */
    val labels: Pair<String, String>,
    /** What the tool says first, e.g. "A clear change: knob.x … settles 0.68 s later". */
    val headline: String,
    /** The next turn the tool proposes, if any. */
    val suggestion: String?,
    val properties: List<PropertyVerdict>,
    val steps: List<Step>,
    /** Leaf states to start in; empty for the file's initial state. */
    val start: List<String>,
    val reducedMotion: Boolean,
    /** Seconds until both versions have settled. */
    val until: Double,
    val a: Program,
    val b: Program,
) {
    /** Something that happens at a time in the comparison: an event, or an input sample. */
    sealed class Step(val t: Double) {
        class Event(t: Double, val name: String) : Step(t)
        class Input(t: Double, val name: String, val value: Double) : Step(t)
    }

    /** One property's verdict: "imperceptible", "subtle" or "clear", and a sentence. */
    class PropertyVerdict(val property: String, val verdict: String, val summary: String)

    companion object {
        /** Reads `nudg compare --bundle` output. */
        fun decode(text: String): Comparison {
            val j = Json.parse(text) as? Map<*, *>
            val labels = j?.get("labels") as? List<*>
            require(j != null && j["nudgCompare"] == 1.0 && labels?.size == 2) { "Not a nudg comparison bundle (format 1). Write one with `nudg compare a b --bundle x.compare.json`." }
            @Suppress("UNCHECKED_CAST")
            fun program(v: Any?) = Program.fromJson(v as Map<String, Any?>)
            return Comparison(
                labels = labels!![0] as String to labels[1] as String,
                headline = j["headline"] as? String ?: "",
                suggestion = j["suggestion"] as? String,
                properties = (j["properties"] as? List<*> ?: emptyList<Any>()).map { p -> (p as Map<*, *>).let { PropertyVerdict(it["property"] as String, it["verdict"] as String, it["summary"] as String) } },
                steps = (j["events"] as? List<*> ?: emptyList<Any>()).map { e ->
                    (e as Map<*, *>).let {
                        val t = it["t"] as Double
                        if (it["event"] is String) Step.Event(t, it["event"] as String) else Step.Input(t, it["input"] as String, it["value"] as Double)
                    }
                },
                start = (j["start"] as? List<*>)?.map { it as String } ?: emptyList(),
                reducedMotion = j["reducedMotion"] as? Boolean ?: false,
                until = j["until"] as? Double ?: 0.0,
                a = program(j["a"]),
                b = program(j["b"]),
            )
        }
    }
}
