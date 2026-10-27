package dev.nudg.demo

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.nudg.Comparison
import dev.nudg.compose.NudgCompare
import dev.nudg.compose.nudg
import dev.nudg.compose.nudgPress

/**
 * The toggle against a bouncier version of itself, as `nudg compare --bundle` wrote it
 * (spec/conformance/programs/toggle-bouncier.compare.json): both play the app's own toggle.
 */
class CompareActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val comparison = Comparison.decode(assets.open("toggle-bouncier.compare.json").bufferedReader().readText())
        setContent {
            Column(Modifier.fillMaxSize().background(Color(0xFFFAFAF9)).safeDrawingPadding().semantics { testTagsAsResourceId = true }) {
                NudgCompare(comparison) { state ->
                    val side = if (state.runtime.program === comparison.a) "a" else "b"
                    Column {
                        Box(
                            Modifier.testTag("track-$side").size(width = 52.dp, height = 32.dp).clip(RoundedCornerShape(16.dp))
                                .nudg(state, "track").nudgPress(state, "track").padding(4.dp),
                        ) {
                            Box(Modifier.size(24.dp).nudg(state, "knob").background(Color.White, CircleShape))
                        }
                        Text(state.state.joinToString(" "), fontSize = 13.sp, modifier = Modifier.testTag("state-$side").padding(top = 6.dp))
                    }
                }
            }
        }
    }
}
