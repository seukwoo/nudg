package dev.nudg.demo

import android.os.ParcelFileDescriptor
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.nudg.compose.systemReducedMotion
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** "Remove animations" in the system's accessibility settings is reduced motion, as Reduce Motion is on iOS. */
@RunWith(AndroidJUnit4::class)
class ReducedMotionTest {
    @get:Rule val rule = createComposeRule()

    private fun shell(command: String) {
        val out = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        ParcelFileDescriptor.AutoCloseInputStream(out).use { it.readBytes() } // wait for it to finish
    }

    @Test fun removeAnimationsIsReducedMotion() {
        shell("settings put global animator_duration_scale 0")
        try {
            var reduced: Boolean? = null
            rule.setContent { reduced = systemReducedMotion() }
            rule.waitForIdle()
            assertEquals(true, reduced)
        } finally {
            shell("settings put global animator_duration_scale 1")
        }
    }
}
