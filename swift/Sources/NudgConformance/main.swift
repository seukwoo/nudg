// Runs nudg's conformance suite (../spec/conformance) against the Swift runtime, from
// the programs the reference compiler wrote (programs/<case>.program.json). Exits 1 on
// any failure. Usage: swift run NudgConformance [path/to/spec/conformance]

import Foundation
import Nudg

let dir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "../spec/conformance")
let NUMBER_TOLERANCE = 1e-6

func channels(_ hex: String) -> [Int] {
  let h = Array(hex.dropFirst())
  return [0, 2, 4].map { Int(String(h[$0...$0 + 1]), radix: 16)! }
}

var passed = 0
var failures: [String] = []

let files = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".json") }.sorted()
for file in files {
  let c = try JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent(file))) as! [String: Any]
  guard c["doc"] != nil, let steps = c["steps"] as? [[String: Any]] else { continue }
  let name = "\(file): \(c["name"] as! String)"
  do {
    let programURL = dir.appendingPathComponent("programs").appendingPathComponent(file.replacingOccurrences(of: ".json", with: ".program.json"))
    let program = try Program.decode(Data(contentsOf: programURL))
    let rt = try Runtime(program, state: c["start"] as? [String] ?? [], reducedMotion: c["reducedMotion"] as? Bool ?? false)
    var problems: [String] = []
    for step in steps {
      let t = (step["t"] as! NSNumber).doubleValue
      if let input = step["input"] as? String {
        if try !rt.input(input, (step["value"] as! NSNumber).doubleValue, at: t) { problems.append("input \(input) at \(t)s was refused") }
      }
      if let event = step["send"] as? String {
        let handled = try rt.send(event, at: t)
        if let expected = step["handled"] as? Bool, expected != handled { problems.append("\(event) at \(t)s handled \(handled), expected \(expected)") }
      }
      guard let expect = step["expect"] as? [String: Any] else { continue }
      let values = try rt.sample(t)
      if let state = expect["state"] as? [String], rt.state() != state { problems.append("state at \(t)s: \(rt.state()), expected \(state)") }
      for (key, expected) in expect["values"] as? [String: Any] ?? [:] {
        let actual = values[key]
        if let e = expected as? String {
          guard let a = actual?.color else { problems.append("\(key) at \(t)s: expected a color"); continue }
          if zip(channels(a), channels(e)).contains(where: { abs($0 - $1) > 1 }) { problems.append("\(key) at \(t)s: expected \(e), got \(a)") }
        } else {
          let e = (expected as! NSNumber).doubleValue
          guard let a = actual?.number else { problems.append("\(key) at \(t)s: expected a number"); continue }
          if abs(a - e) > NUMBER_TOLERANCE { problems.append("\(key) at \(t)s: expected \(e), got \(a)") }
        }
      }
    }
    if problems.isEmpty { passed += 1; print("ok    \(name)") }
    else { failures.append(name); print("FAIL  \(name)\n      " + problems.prefix(5).joined(separator: "\n      ")) }
  } catch {
    failures.append(name)
    print("FAIL  \(name)\n      \(error)")
  }
}

print("\n\(passed) passed, \(failures.count) failed")
exit(failures.isEmpty ? 0 : 1)
