package dev.nudg.demo

import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** NudgCompare on a device: the bundle `nudg compare --bundle` wrote, played on the demo's own toggle. */
@RunWith(AndroidJUnit4::class)
class CompareTest {
    @get:Rule val rule = createAndroidComposeRule<CompareActivity>()

    /** Where the knob's left edge is drawn inside its track, in dp. */
    private fun knob(side: String): Float {
        val node = rule.onNodeWithTag("track-$side")
        val image = node.captureToImage().toPixelMap()
        val y = image.height / 2
        val left = (0 until image.width).first { x -> image[x, y].let { it.red > 0.95f && it.green > 0.95f && it.blue > 0.95f } }
        return left / rule.density.density
    }

    @Test fun theHeadlineComesFirstAndBothSidesPlayTheTap() {
        // It plays in a loop, so it is never idle: the tests drive the clock by hand.
        rule.mainClock.autoAdvance = false
        rule.onNodeWithText("A clear change", substring = true).assertExists()
        rule.mainClock.advanceTimeBy(150)
        rule.onNodeWithTag("state-a").assertTextEquals("on")
        rule.onNodeWithTag("state-b").assertTextEquals("on")
    }

    @Test fun theBouncierSideIsDrawnAheadWhereTheVerdictSaysAndBothLandTogether() {
        rule.mainClock.autoAdvance = false
        // The tap at 0.1 s; the verdict says the two differ most 0.16 s later, by 5.9 units.
        rule.mainClock.advanceTimeBy(260)
        val gap = knob("b") - knob("a")
        assertTrue("B is drawn ahead of A by about 5.9 dp, got $gap", gap in 4.5f..7.5f)
        rule.mainClock.advanceTimeBy(1500)
        assertEquals(knob("a"), knob("b"), 0.6f)
    }

    @Test fun aTapOnOneSideHappensOnTheOther() {
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.onNodeWithTag("state-b").assertTextEquals("on")
        rule.onNodeWithTag("track-b").performClick()
        rule.mainClock.advanceTimeBy(50)
        rule.onNodeWithTag("state-a").assertTextEquals("off")
        rule.onNodeWithTag("state-b").assertTextEquals("off")
    }
}
