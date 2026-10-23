// Runs nudg's conformance suite (../spec/conformance) against the Swift runtime. Exits 1
// on any failure. Usage: swift run NudgConformance [path/to/spec/conformance]

import Foundation
import NudgConformanceSuite

let dir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "../spec/conformance")
let (passed, failures) = try runConformanceSuite(at: dir)
print("\n\(passed) passed, \(failures.count) failed")
exit(failures.isEmpty ? 0 : 1)
