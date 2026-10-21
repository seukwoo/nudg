package dev.nudg

/**
 * What a host hears about a player's life, by the same rules in every adapter: the active
 * states when they change, when everything has come to rest (settle), and when the
 * component has exited. Adapters call [changed] after an event, input or layout report and
 * [frame] after applying a frame's values.
 */
class Lifecycle(private val runtime: Runtime, exit: List<String> = emptyList()) {
    private val exits = exit.toSet()

    /** The active states, after an event or timer changes them. */
    var onState: ((List<String>) -> Unit)? = null

    /**
     * Every value has come to rest after something moved or the state changed. Once per
     * rest, with the active states; pending timers don't delay it, and values that follow
     * or are mapped from an input count as at rest.
     */
    var onSettle: ((List<String>) -> Unit)? = null

    /** The machine has entered an exit state from elsewhere and is settled. */
    var onExit: (() -> Unit)? = null

    /** False once the component has exited, until it leaves the exit state again. */
    var present = true
        private set

    private var lastState = runtime.state()

    // A settle is owed once something moved or the state changed, and paid at the next rest.
    private var owed = false

    // Only an exit entered from somewhere else counts; mounting in "hidden" hasn't exited anything.
    private var armed = exits.isNotEmpty() && !inExit()

    /** After an event, input sample or layout report, at the runtime's current time. */
    fun changed() {
        syncState()
        // Read the time after onState: a host may send more from inside it.
        val t = runtime.time()
        if (!runtime.resting(t)) owed = true
        // An exit with nothing left to move is complete at once; otherwise frames finish it.
        syncPresence(t)
    }

    /** After the values at [at] were applied. True while the host should keep sending frames. */
    fun frame(at: Double): Boolean {
        syncState() // timers may have fired while time advanced
        val t = maxOf(at, runtime.time())
        if (!runtime.resting(t)) owed = true
        else if (owed) {
            owed = false
            onSettle?.invoke(runtime.state())
        }
        val settled = runtime.settled(t)
        if (settled) syncPresence(t)
        return !settled || owed
    }

    private fun inExit() = runtime.state().any { it in exits || it.substringAfterLast('/') in exits }

    private fun syncState() {
        val s = runtime.state()
        if (s == lastState) return
        lastState = s
        owed = true
        onState?.invoke(s)
    }

    private fun syncPresence(t: Double) {
        if (exits.isEmpty()) return
        if (!inExit()) {
            armed = true
            present = true
            return
        }
        if (armed && present && runtime.settled(t)) {
            present = false
            armed = false
            onExit?.invoke()
        }
    }
}
