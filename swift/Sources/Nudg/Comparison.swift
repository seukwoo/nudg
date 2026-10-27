// A comparison bundle, as `nudg compare a b --bundle x.compare.json` writes it: both
// versions compiled, the events they play under, and what the verdict says. NudgSwiftUI's
// NudgCompare plays it on the app's own views.

import Foundation

public struct Comparison {
  /** Something that happens at a time in the comparison: an event, or an input sample. */
  public enum Step {
    case event(t: Double, name: String)
    case input(t: Double, name: String, value: Double)

    public var t: Double {
      switch self {
      case let .event(t, _), let .input(t, _, _): return t
      }
    }
  }

  /** One property's verdict: "imperceptible", "subtle" or "clear", and a sentence. */
  public struct PropertyVerdict {
    public let property: String
    public let verdict: String
    public let summary: String
  }

  /** What to call A (before) and B (the change). */
  public let labels: (String, String)
  /** What the tool says first, e.g. "A clear change: knob.x … settles 0.68 s later". */
  public let headline: String
  /** The next turn the tool proposes, if any. */
  public let suggestion: String?
  public let properties: [PropertyVerdict]
  public let steps: [Step]
  /** Leaf states to start in; empty for the file's initial state. */
  public let start: [String]
  public let reducedMotion: Bool
  /** Seconds until both versions have settled. */
  public let until: Double
  public let a: Program
  public let b: Program

  public enum DecodeError: Error, CustomStringConvertible {
    case notAComparison(String)
    public var description: String { if case let .notAComparison(m) = self { return m }; return "" }
  }

  /** Reads `nudg compare --bundle` output. */
  public static func decode(_ data: Data) throws -> Comparison {
    guard let j = try JSONSerialization.jsonObject(with: data) as? [String: Any], j["nudgCompare"] as? Int == 1,
          let labels = j["labels"] as? [String], labels.count == 2, let a = j["a"], let b = j["b"] else {
      throw DecodeError.notAComparison("Not a nudg comparison bundle (format 1). Write one with `nudg compare a b --bundle x.compare.json`.")
    }
    let steps: [Step] = (j["events"] as? [[String: Any]] ?? []).map { e in
      let t = (e["t"] as? NSNumber)?.doubleValue ?? 0
      if let name = e["event"] as? String { return .event(t: t, name: name) }
      return .input(t: t, name: e["input"] as? String ?? "", value: (e["value"] as? NSNumber)?.doubleValue ?? 0)
    }
    return Comparison(
      labels: (labels[0], labels[1]),
      headline: j["headline"] as? String ?? "",
      suggestion: j["suggestion"] as? String,
      properties: (j["properties"] as? [[String: Any]] ?? []).map { PropertyVerdict(property: $0["property"] as? String ?? "", verdict: $0["verdict"] as? String ?? "", summary: $0["summary"] as? String ?? "") },
      steps: steps,
      start: j["start"] as? [String] ?? [],
      reducedMotion: j["reducedMotion"] as? Bool ?? false,
      until: (j["until"] as? NSNumber)?.doubleValue ?? 0,
      a: try Program.decode(JSONSerialization.data(withJSONObject: a)),
      b: try Program.decode(JSONSerialization.data(withJSONObject: b)))
  }
}
