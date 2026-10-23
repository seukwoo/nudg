#!/bin/bash
# The Swift tests on an iOS simulator: the conformance suite, a real SwiftUI render and the
# lifecycle. Usage: swift/test-ios.sh [simulator name], by default the first available iPhone.
set -eo pipefail
cd "$(dirname "$0")"
# The simulator can't read the Mac's protected folders (Documents, Desktop) without a prompt.
suite="${TMPDIR:-/tmp}/nudg-conformance"
rm -rf "$suite" && cp -R ../spec/conformance "$suite"
device="${1:-$(xcrun simctl list devices available | sed -n 's/^ *\(iPhone[^(]*\) (.*/\1/p' | head -1 | sed 's/ *$//')}"
echo "On $device"
TEST_RUNNER_NUDG_CONFORMANCE="$suite" xcodebuild test -scheme Nudg-Package -only-testing:NudgTests \
  -destination "platform=iOS Simulator,name=$device" 2>&1 \
  | grep -E "^Test Case .*(passed|failed)|Executed [0-9]+ tests?, with|error:|\*\* TEST"
