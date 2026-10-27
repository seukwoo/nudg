package dev.nudg.demo

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.pinch
import androidx.compose.ui.test.swipeRight
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The Compose adapter on a device: real touch input through the system, into the same
 * compiled files the other platforms play. Run with an emulator up:
 * ./gradlew :demo:connectedDebugAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class DemoTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @Test fun aTapTurnsTheToggleOn() {
        rule.onNodeWithTag("state").assertTextEquals("toggle: off")
        rule.onNodeWithTag("track").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("state").assertTextEquals("toggle: on")
    }

    @Test fun anAccessibilityActivationIsATap() {
        // What TalkBack's double tap does: the node's click action, no touch at all.
        rule.onNodeWithTag("track").performSemanticsAction(SemanticsActions.OnClick)
        rule.waitForIdle()
        rule.onNodeWithTag("state").assertTextEquals("toggle: on")
    }

    @Test fun aDragAcrossTurnsTheDragToggleOnWithoutATap() {
        rule.onNodeWithTag("dragtrack").performTouchInput { swipeRight(startX = left + 4f, endX = right, durationMillis = 300) }
        rule.waitForIdle()
        rule.mainClock.advanceTimeBy(1000)
        rule.onNodeWithText("drag: on").assertExists()
    }

    @Test fun twoFingersPinchTheImageAndTheZoomStays() {
        rule.onNodeWithTag("image").performTouchInput {
            // From 40 px apart to 120 px apart: a ratio of 3.
            pinch(center - Offset(20f, 0f), center - Offset(60f, 0f), center + Offset(20f, 0f), center + Offset(60f, 0f), durationMillis = 400)
        }
        rule.waitForIdle()
        rule.mainClock.advanceTimeBy(500)
        rule.onNodeWithTag("pinchstate").assertTextContains("held", substring = true)
        rule.onNodeWithTag("pinchstate").assertTextContains("3.", substring = true)
    }
}
