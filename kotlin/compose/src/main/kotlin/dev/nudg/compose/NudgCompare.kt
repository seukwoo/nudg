package dev.nudg.compose

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.nudg.Comparison

/** How long a run lingers at rest before it starts over. */
private const val PAUSE = 0.8

/**
 * Plays a comparison's two versions side by side, each through [content], the app's own
 * composable for one player: the headline first, then before and after, in a loop, the
 * native side of `nudg compare` (`nudg compare a b --bundle x.compare.json`). A tap or drag
 * on either side happens on both. Replay starts over; ¼× and ⅒× slow both down.
 *
 *   NudgCompare(Comparison.decode(assets.open("toggle.compare.json").bufferedReader().readText())) { state ->
 *       Toggle(state)
 *   }
 */
@Composable
fun NudgCompare(comparison: Comparison, modifier: Modifier = Modifier, content: @Composable (NudgState) -> Unit) {
    var run by remember { mutableIntStateOf(0) }
    var speed by remember { mutableDoubleStateOf(1.0) }
    val (a, b, mirror) = remember(comparison, run) {
        val a = NudgState(comparison.a, comparison.start, comparison.reducedMotion)
        val b = NudgState(comparison.b, comparison.start, comparison.reducedMotion)
        // What a person does on one side happens on the other too; layout stays each side's own.
        val mirror = Mirror()
        for ((from, to) in listOf(a to b, b to a)) {
            from.onSend = { e -> mirror { to.send(e) } }
            from.onInput = { n, v -> if (".layout." !in n) mirror { to.input(n, v) } }
        }
        Triple(a, b, mirror)
    }
    a.speed = speed
    b.speed = speed
    LaunchedEffect(a) { a.play() }
    LaunchedEffect(b) { b.play() }
    LaunchedEffect(a, b) {
        // The comparison's timeline: its steps to both at once, then a pause at rest, then again.
        var elapsed = 0.0
        var last = -1L
        var next = 0
        while (true) {
            withFrameNanos { n ->
                if (last >= 0) elapsed += (n - last) / 1e9 * speed
                last = n
            }
            while (next < comparison.steps.size && comparison.steps[next].t <= elapsed) {
                val step = comparison.steps[next++]
                mirror {
                    for (s in listOf(a, b)) when (step) {
                        is Comparison.Step.Event -> s.send(step.name)
                        is Comparison.Step.Input -> s.input(step.name, step.value)
                    }
                }
            }
            if (next == comparison.steps.size && elapsed > comparison.until + PAUSE) {
                run++
                break
            }
        }
    }
    Column(modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        BasicText(comparison.headline, style = TextStyle(fontSize = 15.sp))
        comparison.suggestion?.let { BasicText(it, style = TextStyle(fontSize = 13.sp, color = Color.Gray)) }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            for ((label, role, state) in listOf(Triple(comparison.labels.first, "before", a), Triple(comparison.labels.second, "the change", b))) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    BasicText(
                        buildAnnotatedString {
                            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(label) }
                            withStyle(SpanStyle(color = Color.Gray)) { append(" · $role") }
                        },
                        style = TextStyle(fontSize = 12.sp),
                    )
                    // A new player on replay gets fresh composables, so gesture state doesn't carry over.
                    key(state) { content(state) }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            Control("Replay") { run++ }
            for ((value, label) in listOf(1.0 to "1×", 0.25 to "¼×", 0.1 to "⅒×")) {
                Control(label, selected = speed == value) { speed = value }
            }
        }
    }
}

/** Runs a send unless one is already running, so a mirrored send isn't mirrored back. */
private class Mirror {
    private var running = false
    operator fun invoke(send: () -> Unit) {
        if (running) return
        running = true
        send()
        running = false
    }
}

/** A plain text button: the adapter brings no design system of its own. */
@Composable
private fun Control(label: String, selected: Boolean = false, onClick: () -> Unit) {
    BasicText(
        label,
        Modifier.clickable(role = Role.Button, onClickLabel = label, onClick = onClick).padding(vertical = 8.dp),
        style = TextStyle(fontSize = 15.sp, color = Color(0xFF2563EB), fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal),
    )
}
