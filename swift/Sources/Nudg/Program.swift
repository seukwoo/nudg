// A compiled nudg program, read from the JSON that `nudg compile` writes (formats 1 to 4).
// Everything is already validated and resolved; this only decodes it.

import Foundation

public enum PropertyKind: String { case length, number, color }

public enum Ease {
  case linear
  case bezier(Double, Double, Double, Double)
}

public enum Motion {
  case spring(stiffness: Double, damping: Double, mass: Double, kick: Double?)
  case tween(duration: Double, ease: Ease)
}

public struct Keyframe {
  public let at: Double
  public let value: [Double]
}

public enum EntryEffect {
  case kick(Motion)
  case keyframes(frames: [Keyframe], duration: Double, ease: Ease)
}

public struct Measure {
  public let target: String
  public let of: String
  public let times: Double
  public let plus: Double
}

public enum MeasuredEndpoint {
  case number(Double)
  case measure(Measure)
}

/** A periodic offset added to a property while its state is active (v0.10). */
public struct Loop {
  public let to: MeasuredEndpoint
  public let frames: [(at: Double, value: MeasuredEndpoint)]
  public let duration: Double
  public let ease: Ease
  public let delay: Double
  public let wrap: Double?
}

/** A map's value at one point: channels, or a measured number (v0.11). */
public enum MapValue {
  case channels([Double])
  case measure(Measure)
}

public struct PropertyMap {
  public let source: String
  public let sourceKind: String
  public let from: [MeasuredEndpoint]
  public let to: [MapValue]
}

public struct Property {
  public let kind: PropertyKind
  public let base: [Double]
  public let map: PropertyMap?
  public let measure: Measure?
  public let min: Double?
  public let max: Double?
}

public struct Follow {
  public let input: String
  public let range: (MeasuredEndpoint, MeasuredEndpoint)?
  public let overdrag: Double
}

public final class Transition {
  public let to: String?
  public let nearest: (states: [String], by: String, momentum: Double)?
  public let animate: [(String, Motion)]
  public let step: [(String, Double)]?
  public let commit: [String]?
  init(to: String?, nearest: (states: [String], by: String, momentum: Double)?, animate: [(String, Motion)], step: [(String, Double)]?, commit: [String]?) {
    self.to = to; self.nearest = nearest; self.animate = animate; self.step = step; self.commit = commit
  }
}

public struct TimerPause {
  public let on: String
  public let off: String
}

public final class Timer {
  public let key: String
  public let delay: Double
  public let transition: Transition
  public let pause: [TimerPause]
  init(key: String, delay: Double, transition: Transition, pause: [TimerPause]) { self.key = key; self.delay = delay; self.transition = transition; self.pause = pause }
}

public final class State {
  public let name: String
  public let set: [(String, [Double])]
  public let measure: [String: Measure]
  public let follow: [(String, Follow)]
  public let enter: [(String, EntryEffect)]
  public let loop: [(String, Loop)]
  public let when: [(String, Transition)]
  public let timers: [Timer]
  public let machine: Machine?
  init(name: String, set: [(String, [Double])], measure: [String: Measure], follow: [(String, Follow)], enter: [(String, EntryEffect)], loop: [(String, Loop)], when: [(String, Transition)], timers: [Timer], machine: Machine?) {
    self.name = name; self.set = set; self.measure = measure; self.follow = follow; self.enter = enter; self.loop = loop; self.when = when; self.timers = timers; self.machine = machine
  }
  func transition(for event: String) -> Transition? { when.first { $0.0 == event }?.1 }
}

public final class Machine {
  public enum Kind {
    case states(initial: String, states: [State], when: [(String, Transition)])
    case regions([(String, Machine)])
  }
  public let kind: Kind
  init(_ kind: Kind) { self.kind = kind }
  func state(_ name: String) -> State? {
    if case let .states(_, states, _) = kind { return states.first { $0.name == name } }
    return nil
  }
}

public struct Program {
  public let version: String
  public let targets: [String]
  /** In file order. */
  public let properties: [(String, Property)]
  public let animate: [String: Motion]
  public let machine: Machine

  public func property(_ key: String) -> Property? { properties.first { $0.0 == key }?.1 }

  public enum DecodeError: Error, CustomStringConvertible {
    case notAProgram(String)
    public var description: String { if case let .notAProgram(m) = self { return m }; return "" }
  }

  /** Reads `nudg compile` output. */
  public static func decode(_ data: Data) throws -> Program {
    guard let j = try JSONSerialization.jsonObject(with: data) as? [String: Any], let format = j["nudgProgram"] as? Int, (1...4).contains(format) else {
      throw DecodeError.notAProgram("Not a compiled nudg program (formats 1 to 4). Compile it with `nudg compile`.")
    }
    let properties: [(String, Property)] = (j["properties"] as! [[String: Any]]).map { p in
      (p["key"] as! String, Property(
        kind: PropertyKind(rawValue: p["kind"] as! String)!,
        base: doubles(p["base"]),
        map: (p["map"] as? [String: Any]).map { m in PropertyMap(source: m["source"] as! String, sourceKind: m["sourceKind"] as? String ?? "property", from: (m["from"] as! [Any]).map(readEndpoint), to: (m["to"] as! [Any]).map { v in v is [Any] ? .channels(doubles(v)) : .measure(readMeasure(v as! [String: Any])) }) },
        measure: (p["measure"] as? [String: Any]).map(readMeasure),
        min: number(p["min"]),
        max: number(p["max"])))
    }
    var animate: [String: Motion] = [:]
    for a in j["animate"] as! [[String: Any]] { animate[a["key"] as! String] = readMotion(a["motion"]!) }
    return Program(version: j["version"] as! String, targets: j["targets"] as! [String], properties: properties, animate: animate, machine: readMachine(j["machine"]!))
  }
}

private func number(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue }
private func doubles(_ v: Any?) -> [Double] { (v as? [Any] ?? []).map { ($0 as! NSNumber).doubleValue } }
private func readMeasure(_ m: [String: Any]) -> Measure {
  Measure(target: m["target"] as! String, of: m["of"] as! String, times: number(m["times"]) ?? 1, plus: number(m["plus"]) ?? 0)
}

private func readEndpoint(_ value: Any) -> MeasuredEndpoint {
  if let n = number(value) { return .number(n) }
  return .measure(readMeasure(value as! [String: Any]))
}

private func readMotion(_ v: Any) -> Motion {
  let m = v as! [String: Any]
  if (m["kind"] as! String) == "tween" {
    let ease: Ease
    if let e = m["ease"] as? [Any] { let d = doubles(e); ease = .bezier(d[0], d[1], d[2], d[3]) } else { ease = .linear }
    return .tween(duration: number(m["duration"])!, ease: ease)
  }
  return .spring(stiffness: number(m["stiffness"])!, damping: number(m["damping"])!, mass: number(m["mass"])!, kick: number(m["kick"]))
}

private func readEase(_ v: Any?) -> Ease {
  if let e = v as? [Any] { let d = doubles(e); return .bezier(d[0], d[1], d[2], d[3]) }
  return .linear
}

private func readEntryEffect(_ v: Any) -> EntryEffect {
  let effect = v as! [String: Any]
  if (effect["kind"] as? String) == "keyframes" {
    let frames = (effect["frames"] as! [[String: Any]]).map { Keyframe(at: number($0["at"])!, value: doubles($0["value"])) }
    return .keyframes(frames: frames, duration: number(effect["duration"])!, ease: readEase(effect["ease"]))
  }
  return .kick(readMotion(v))
}

private func readTransition(_ v: Any) -> Transition {
  let t = v as! [String: Any]
  let nearest = (t["nearest"] as? [String: Any]).map { n in (states: n["states"] as! [String], by: n["by"] as! String, momentum: number(n["momentum"])!) }
  return Transition(
    to: t["to"] as? String,
    nearest: nearest,
    animate: (t["animate"] as! [[String: Any]]).map { ($0["key"] as! String, readMotion($0["motion"]!)) },
    step: (t["step"] as? [[String: Any]])?.map { ($0["key"] as! String, number($0["delta"])!) },
    commit: t["commit"] as? [String])
}

private func readMachine(_ v: Any) -> Machine {
  let m = v as! [String: Any]
  if (m["kind"] as! String) == "regions" {
    return Machine(.regions((m["regions"] as! [[String: Any]]).map { ($0["name"] as! String, readMachine($0["machine"]!)) }))
  }
  let states = (m["states"] as! [[String: Any]]).map(readState)
  let when = (m["when"] as! [[String: Any]]).map { ($0["event"] as! String, readTransition($0)) }
  return Machine(.states(initial: m["initial"] as! String, states: states, when: when))
}

private func readState(_ s: [String: Any]) -> State {
  var measures: [String: Measure] = [:]
  for e in s["measure"] as! [[String: Any]] { measures[e["key"] as! String] = readMeasure(e) }
  return State(
    name: s["name"] as! String,
    set: (s["set"] as! [[String: Any]]).map { ($0["key"] as! String, doubles($0["value"])) },
    measure: measures,
    follow: (s["follow"] as! [[String: Any]]).map { f in
      let r = (f["range"] as? [Any] ?? []).map(readEndpoint)
      return (f["key"] as! String, Follow(input: f["input"] as! String, range: r.count == 2 ? (r[0], r[1]) : nil, overdrag: number(f["overdrag"])!))
    },
    enter: (s["enter"] as! [[String: Any]]).map { ($0["key"] as! String, readEntryEffect($0["effect"] ?? $0["motion"]!)) },
    loop: (s["loop"] as? [[String: Any]] ?? []).map { l in
      (l["key"] as! String, Loop(
        to: readEndpoint(l["to"]!),
        frames: (l["frames"] as! [[String: Any]]).map { (at: number($0["at"])!, value: readEndpoint($0["value"]!)) },
        duration: number(l["duration"])!,
        ease: readEase(l["ease"]),
        delay: number(l["delay"]) ?? 0,
        wrap: number(l["wrap"])))
    },
    when: (s["when"] as! [[String: Any]]).map { ($0["event"] as! String, readTransition($0)) },
    timers: (s["timers"] as! [[String: Any]]).map { timer in
      Timer(
        key: timer["key"] as! String,
        delay: number(timer["delay"])!,
        transition: readTransition(timer["transition"]!),
        pause: (timer["pause"] as? [[String: Any]] ?? []).map { TimerPause(on: $0["on"] as! String, off: $0["off"] as! String) })
    },
    machine: s["machine"].map(readMachine))
}
