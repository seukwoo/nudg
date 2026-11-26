import { test } from "node:test";
import assert from "node:assert/strict";
import { vibration } from "../src/dom/feedback.ts";

test("vibrate follows a cue's intensity: shorter pulses for a weaker cue, the intent's own at 1", () => {
  assert.deepEqual(vibration("success", 1), [10, 50, 14]);
  assert.equal(vibration("rigid", 1), 10);
  // a putt (0.3) against a full swing (1): the pulse is about half as long; the pauses keep their length
  assert.equal(vibration("heavy", 0.3), Math.round(24 * (0.35 + 0.65 * 0.3)));
  assert.ok((vibration("heavy", 0.3) as number) < (vibration("heavy", 1) as number));
  assert.deepEqual(vibration("error", 0), [8, 40, 8, 40, 8]);
  assert.equal(vibration("tick", 0), 3, "never shorter than 3 ms");
  assert.equal(vibration("medium", 2), 16, "intensity is clamped to 1");
  assert.equal(vibration("unknown", 1), undefined);
});
