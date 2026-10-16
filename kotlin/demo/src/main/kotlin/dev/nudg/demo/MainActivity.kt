package dev.nudg.demo

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.nudg.Program
import dev.nudg.compose.nudg
import dev.nudg.compose.nudgPress
import dev.nudg.compose.rememberNudg

/** The same toggle and press files the web and SwiftUI demos play. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val toggleProgram = Program.decode(assets.open("toggle.program.json").bufferedReader().readText())
        val pressProgram = Program.decode(assets.open("press.program.json").bufferedReader().readText())
        val dragProgram = Program.decode(assets.open("toggle-drag.program.json").bufferedReader().readText())
        setContent {
            val toggle = rememberNudg(toggleProgram)
            val press = rememberNudg(pressProgram)
            val drag = rememberNudg(dragProgram)
            Column(
                Modifier.fillMaxSize().background(Color(0xFFFAFAF9)).semantics { testTagsAsResourceId = true },
                verticalArrangement = Arrangement.spacedBy(40.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("toggle: ${toggle.state.joinToString(" ")}", fontSize = 18.sp, modifier = Modifier.testTag("state"))
                Box(
                    Modifier.testTag("track").size(width = 52.dp, height = 32.dp).clip(RoundedCornerShape(16.dp))
                        .nudg(toggle, "track").nudgPress(toggle, "track").padding(4.dp),
                ) {
                    Box(Modifier.size(24.dp).nudg(toggle, "knob").background(Color.White, CircleShape))
                }
                Text("drag: ${drag.state.joinToString(" ")}", fontSize = 18.sp)
                Box(
                    Modifier.testTag("dragtrack").size(width = 52.dp, height = 32.dp).clip(RoundedCornerShape(16.dp))
                        .nudg(drag, "track").nudgPress(drag, "track").padding(4.dp),
                ) {
                    Box(Modifier.size(24.dp).nudg(drag, "knob").background(Color.White, CircleShape))
                }
                Box(
                    Modifier.testTag("button").nudgPress(press, "button").nudg(press, "button")
                        .background(Color(0xFF2563EB), RoundedCornerShape(12.dp)).padding(horizontal = 28.dp, vertical = 14.dp),
                ) {
                    Text("Press me", color = Color.White, fontSize = 17.sp)
                }
            }
        }
    }
}
