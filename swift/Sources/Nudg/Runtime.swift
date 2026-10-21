// Runs a compiled Program, the same way the TypeScript reference does. Time is always
// passed in, never read from a clock: the same events at the same times give the same
// states and values on every platform. The conformance suite checks that.

import Foundation

public enum Value: Equatable {
  case number(Double)
  case color(String)
  public var number: Double? { if case let .number(v) = self { return v }; return nil }
  public var color: String? { if case let .color(v) = self { return v }; return nil }
}

public enum RuntimeError: Error { case timeWentBackwards(Double, Double), badStatePath(String) }

private enum Segment {
  case motion(t0: Double, from: [Double], v0: [Double], to: [Double], motion: Motion?)
  case keyframes(t0: Double, from: [Double], to: [Double], frames: [Keyframe], duration: Double, ease: Ease, owner: State)
  case follow(key: String, t0: Double, anchor: Double, input0: Double, follow: Follow, owner: State)
  var to: [Double]? {
    switch self {
    case let .motion(_, _, _, to, _), let .keyframes(_, _, to, _, _, _, _): return to
    case .follow: return nil
    }
  }
}

private final class Pending {
  var due: Double
  let order: Int, machine: Machine, state: State, transition: Transition, pause: [TimerPause]
  var blockers: Set<Int> = []
  var pausedAt: Double?
  init(due: Double, order: Int, machine: Machine, state: State, transition: Transition, pause: [TimerPause]) {
    self.due = due; self.order = order; self.machine = machine; self.state = state; self.transition = transition; self.pause = pause
  }
}

private let REST_NUMBER = 1e-3, REST_COLOR = 1e-4
private let VELOCITY_WINDOW = 0.1
private let REDUCED: Motion = .tween(duration: 0.15, ease: .linear)
private let LAYOUT_NAMES: Set<String> = ["x", "y", "width", "height", "naturalWidth", "naturalHeight"]

public final class Runtime {
  public let program: Program
  private var active: [ObjectIdentifier: String] = [:]
  private var segments: [String: Segment] = [:]
  private var inputs: [String: [(Double, Double)]] = [:]
  private var bases: [String: [Double]] = [:]
  private var pending: [Pending] = []
  private var layout: [String: Double] = [:]
  private var measuredBases: [String: Measure] = [:]
  private var requiredInputs: Set<String> = []
  private var order = 0
  private var now = 0.0
  private let reduced: Bool

  public init(_ program: Program, state: [String] = [], reducedMotion: Bool = false) throws {
    self.program = program
    self.reduced = reducedMotion
    for (key, prop) in program.properties {
      if let m = prop.measure { measuredBases[key] = m }
      if prop.map == nil { bases[key] = prop.base }
      if let map = prop.map, map.sourceKind == "input" { requiredInputs.insert(map.source) }
    }
    collectFollowInputs(program.machine)
    var entered: [State] = []
    enterMachine(program.machine, &active, &entered, 0)
    for path in state { try enterPath(path) }
    let targets = resolveTargets(active)
    let follows = activeFollows(active)
    for (key, prop) in program.properties where prop.map == nil {
      let to = targets[key]!
      if let f = follows[key] { segments[key] = followSegment(key, f, to[0], 0) }
      else { segments[key] = .motion(t0: 0, from: to, v0: to.map { _ in 0 }, to: to, motion: nil) }
    }
  }

  // MARK: machine

  private func enterMachine(_ machine: Machine, _ act: inout [ObjectIdentifier: String], _ entered: inout [State], _ t: Double, live: Bool = true) {
    switch machine.kind {
    case let .states(initial, _, _): enterState(machine, initial, &act, &entered, t, live: live)
    case let .regions(regions): for (_, r) in regions { enterMachine(r, &act, &entered, t, live: live) }
    }
  }

  private func enterState(_ machine: Machine, _ name: String, _ act: inout [ObjectIdentifier: String], _ entered: inout [State], _ t: Double, live: Bool = true) {
    act[ObjectIdentifier(machine)] = name
    let state = machine.state(name)!
    entered.append(state)
    if live { for timer in state.timers { pending.append(Pending(due: t + timer.delay, order: order, machine: machine, state: state, transition: timer.transition, pause: timer.pause)); order += 1 } }
    if let inner = state.machine { enterMachine(inner, &act, &entered, t, live: live) }
  }

  private func exitMachine(_ machine: Machine, _ act: inout [ObjectIdentifier: String], live: Bool = true) {
    switch machine.kind {
    case let .regions(regions): for (_, r) in regions { exitMachine(r, &act, live: live) }
    case .states:
      let state = machine.state(act[ObjectIdentifier(machine)]!)!
      if let inner = state.machine { exitMachine(inner, &act, live: live) }
      if live { pending.removeAll { $0.state === state } }
      act[ObjectIdentifier(machine)] = nil
    }
  }

  private func enterPath(_ path: String) throws {
    let parts = path.split(separator: "/").map(String.init)
    var machine = program.machine
    for (i, part) in parts.enumerated() {
      if case let .regions(regions) = machine.kind {
        guard let r = regions.first(where: { $0.0 == part })?.1 else { throw RuntimeError.badStatePath(path) }
        machine = r
        continue
      }
      guard let state = machine.state(part) else { throw RuntimeError.badStatePath(path) }
      if active[ObjectIdentifier(machine)] != part {
        exitMachine(machine, &active)
        var entered: [State] = []
        enterState(machine, part, &active, &entered, 0)
      }
      if i < parts.count - 1 {
        guard let inner = state.machine else { throw RuntimeError.badStatePath(path) }
        machine = inner
      }
    }
  }

  private func walkActive(_ act: [ObjectIdentifier: String], _ visit: (State) -> Void) {
    func walk(_ m: Machine) {
      switch m.kind {
      case let .regions(regions): for (_, r) in regions { walk(r) }
      case .states:
        let state = m.state(act[ObjectIdentifier(m)]!)!
        visit(state)
        if let inner = state.machine { walk(inner) }
      }
    }
    walk(program.machine)
  }

  private func collectFollowInputs(_ machine: Machine) {
    switch machine.kind {
    case let .regions(regions): for (_, region) in regions { collectFollowInputs(region) }
    case let .states(_, states, _):
      for state in states {
        for (_, follow) in state.follow { requiredInputs.insert(follow.input) }
        if let inner = state.machine { collectFollowInputs(inner) }
      }
    }
  }

  // MARK: targets

  private func inputsOf(_ key: String, _ m: Measure) -> [String] {
    let own = String(key.split(separator: ".")[0])
    return m.of == "x" || m.of == "y" ? ["\(m.target).layout.\(m.of)", "\(own).layout.\(m.of)"] : ["\(m.target).layout.\(m.of)"]
  }

  private func measured(_ key: String, _ m: Measure) -> Double? {
    let values = inputsOf(key, m).map { layout[$0] }
    if values.contains(where: { $0 == nil }) { return nil }
    let value = m.of == "x" || m.of == "y" ? values[0]! - values[1]! : values[0]!
    return value * m.times + m.plus
  }

  private func endpoint(_ key: String, _ value: MeasuredEndpoint) -> Double? {
    switch value {
    case let .number(number): return number
    case let .measure(measure): return measured(key, measure)
    }
  }

  private func resolvedRange(_ key: String, _ range: (MeasuredEndpoint, MeasuredEndpoint)?) -> (Double, Double)? {
    guard let range, let a = endpoint(key, range.0), let b = endpoint(key, range.1), a != b else { return nil }
    return (min(a, b), max(a, b))
  }

  private func resolvedMap(_ key: String, _ map: PropertyMap) -> [Double]? {
    let context = map.sourceKind == "property" ? map.source : key
    let points = map.from.map { endpoint(context, $0) }
    if points.contains(where: { $0 == nil }) { return nil }
    let values = points.map { $0! }
    return Set(values).count == values.count ? values : nil
  }

  private func clamp(_ key: String, _ value: Double) -> Double {
    let prop = program.property(key)!
    if let lo = prop.min, value < lo { return lo }
    if let hi = prop.max, value > hi { return hi }
    return value
  }

  private func resolveTargets(_ act: [ObjectIdentifier: String]) -> [String: [Double]] {
    var out = bases
    for (key, m) in measuredBases { if let v = measured(key, m) { out[key] = [clamp(key, v)] } }
    let resolvedBases = out
    walkActive(act) { state in
      for (key, value) in state.set {
        guard let m = state.measure[key] else { out[key] = value; continue }
        if let v = measured(key, m) { out[key] = [clamp(key, v)] } else { out[key] = resolvedBases[key]! }
      }
    }
    return out
  }

  private func activeFollows(_ act: [ObjectIdentifier: String]) -> [String: (follow: Follow, owner: State)] {
    var out: [String: (follow: Follow, owner: State)] = [:]
    walkActive(act) { state in for (key, f) in state.follow { out[key] = (f, state) } }
    return out
  }

  private func followSegment(_ key: String, _ f: (follow: Follow, owner: State), _ anchor: Double, _ t: Double) -> Segment {
    .follow(key: key, t0: t, anchor: anchor, input0: inputAt(f.follow.input, t), follow: f.follow, owner: f.owner)
  }

  // MARK: inputs and evaluation

  private func inputAt(_ name: String, _ t: Double) -> Double {
    var value = 0.0
    for (ti, v) in inputs[name] ?? [] { if ti > t { break }; value = v }
    return value
  }

  private func velocityAt(_ name: String, _ t: Double) -> Double {
    let points = (inputs[name] ?? []).filter { $0.0 >= t - VELOCITY_WINDOW - 1e-9 && $0.0 <= t + 1e-9 }
    if points.count < 2 { return 0 }
    let mt = points.reduce(0) { $0 + $1.0 } / Double(points.count)
    let mv = points.reduce(0) { $0 + $1.1 } / Double(points.count)
    var num = 0.0, den = 0.0
    for (ti, v) in points { num += (ti - mt) * (v - mv); den += (ti - mt) * (ti - mt) }
    return den == 0 ? 0 : num / den
  }

  private func evaluate(_ segment: Segment, _ t: Double) -> ([Double], [Double]) {
    switch segment {
    case let .follow(key, _, anchor, input0, follow, _):
      let raw = anchor + inputAt(follow.input, t) - input0
      var value = raw, factor = 1.0
      if let (lo, hi) = resolvedRange(key, follow.range) {
        if raw < lo { value = lo - (lo - raw) * follow.overdrag; factor = follow.overdrag }
        else if raw > hi { value = hi + (raw - hi) * follow.overdrag; factor = follow.overdrag }
      }
      return ([value], [velocityAt(follow.input, t) * factor])
    case let .motion(t0, from, v0, to, motion):
      return evaluateMotion(t0: t0, from: from, v0: v0, to: to, motion: motion, t: t)
    case let .keyframes(t0, from, to, frames, duration, ease, _):
      return evaluateKeyframes(t0: t0, from: from, to: to, frames: frames, duration: duration, ease: ease, t: t)
    }
  }

  private func evaluateKeyframes(t0: Double, from: [Double], to: [Double], frames: [Keyframe], duration: Double, ease: Ease, t: Double) -> ([Double], [Double]) {
    let u = (t - t0) / duration
    if u >= 1 { return (to, to.map { _ in 0 }) }
    let points = [Keyframe(at: 0, value: from)] + frames + [Keyframe(at: 1, value: to)]
    for i in 1..<points.count where u <= points[i].at {
      let a = points[i - 1], b = points[i]
      let local = max(0, (u - a.at) / (b.at - a.at))
      let progress = easeAt(ease, local)
      let slope = easeSlope(ease, local) / ((b.at - a.at) * duration)
      return (zip(a.value, b.value).map { $0 + ($1 - $0) * progress }, zip(a.value, b.value).map { ($1 - $0) * slope })
    }
    return (to, to.map { _ in 0 })
  }

  private func evaluateMotion(t0: Double, from: [Double], v0: [Double], to: [Double], motion: Motion?, t: Double) -> ([Double], [Double]) {
    let dt = t - t0
    let zero = to.map { _ in 0.0 }
    guard let motion else { return (to, zero) }
    switch motion {
    case let .tween(duration, ease):
      if dt >= duration { return (to, zero) }
      let u = dt / duration
      let p = easeAt(ease, u), slope = easeSlope(ease, u) / duration
      return (zip(from, to).map { $0 + ($1 - $0) * p }, zip(from, to).map { ($1 - $0) * slope })
    case let .spring(k, c, m, _):
      var pos: [Double] = [], vel: [Double] = []
      for i in from.indices {
        let (x, v) = springAt(stiffness: k, damping: c, mass: m, x0: from[i] - to[i], v0: v0[i], t: dt)
        pos.append(to[i] + x); vel.append(v)
      }
      return (pos, vel)
    }
  }

  // MARK: transitions

  private func nearest(_ machine: Machine, _ choice: (states: [String], by: String, momentum: Double), _ t: Double) -> String {
    let (pos, vel) = evaluate(segments[choice.by]!, t)
    let projected = pos[0] + vel[0] * choice.momentum
    var best = choice.states[0], bestDistance = Double.infinity
    for name in choice.states {
      var hypothetical = active
      exitMachine(machine, &hypothetical, live: false)
      var entered: [State] = []
      enterState(machine, name, &hypothetical, &entered, t, live: false)
      let distance = abs(projected - resolveTargets(hypothetical)[choice.by]![0])
      if distance < bestDistance { best = name; bestDistance = distance }
    }
    return best
  }

  private func perform(_ machine: Machine, _ transition: Transition, _ t: Double, _ fired: inout [Transition], _ entered: inout [State]) {
    fired.append(transition)
    if transition.to == nil && transition.nearest == nil { return }
    let target = transition.to ?? nearest(machine, transition.nearest!, t)
    exitMachine(machine, &active)
    enterState(machine, target, &active, &entered, t)
  }

  private func handle(_ machine: Machine, _ event: String, _ t: Double, _ fired: inout [Transition], _ entered: inout [State]) -> Bool {
    switch machine.kind {
    case let .regions(regions):
      var handled = false
      for (_, r) in regions { if handle(r, event, t, &fired, &entered) { handled = true } }
      return handled
    case let .states(_, _, machineWhen):
      let state = machine.state(active[ObjectIdentifier(machine)]!)!
      if let inner = state.machine, handle(inner, event, t, &fired, &entered) { return true }
      guard let transition = state.transition(for: event) ?? machineWhen.first(where: { $0.0 == event })?.1 else { return false }
      perform(machine, transition, t, &fired, &entered)
      return true
    }
  }

  private func settle(_ t: Double, _ fired: [Transition], _ entered: [State], snap: Bool = false) {
    var committed = Set<String>()
    for transition in fired {
      for key in transition.commit ?? [] {
        bases[key] = [clamp(key, evaluate(segments[key]!, t).0[0])]
        measuredBases[key] = nil
        committed.insert(key)
      }
      for (key, delta) in transition.step ?? [] {
        let from = measuredBases[key].flatMap { measured(key, $0) } ?? bases[key]![0]
        bases[key] = [clamp(key, from + delta)]
        measuredBases[key] = nil
      }
    }
    var overrides: [String: Motion] = [:]
    for transition in fired { for (key, m) in transition.animate { overrides[key] = m } }
    let targets = resolveTargets(active)
    let follows = activeFollows(active)
    var activeStates = Set<ObjectIdentifier>()
    walkActive(active) { activeStates.insert(ObjectIdentifier($0)) }

    for (key, prop) in program.properties where prop.map == nil {
      let segment = segments[key]!
      if let f = follows[key] {
        var restart = true
        if case let .follow(_, _, _, _, _, owner) = segment, owner === f.owner, !entered.contains(where: { $0 === f.owner }) { restart = false }
        if restart { segments[key] = followSegment(key, f, evaluate(segment, t).0[0], t) }
        continue
      }
      let to = targets[key]!
      if case let .keyframes(t0, from, _, frames, duration, ease, owner) = segment,
         activeStates.contains(ObjectIdentifier(owner)), !entered.contains(where: { $0 === owner }) {
        segments[key] = .keyframes(t0: t0, from: from, to: to, frames: frames, duration: duration, ease: ease, owner: owner)
        continue
      }
      if case let .motion(_, _, _, current, _) = segment, current == to { continue }
      if snap {
        segments[key] = .motion(t0: t, from: to, v0: to.map { _ in 0 }, to: to, motion: nil)
        continue
      }
      var (pos, vel) = evaluate(segment, t)
      if committed.contains(key) { vel = vel.map { _ in 0 } }
      let motion = overrides[key] ?? program.animate[key]
      segments[key] = .motion(t0: t, from: pos, v0: vel, to: to, motion: motion.map { reduced ? REDUCED : $0 })
    }

    if reduced { return }
    for state in entered {
      for (key, effect) in state.enter {
        let segment = segments[key]!
        guard let to = segment.to else { continue }
        let (pos, v) = evaluate(segment, t)
        switch effect {
        case let .keyframes(frames, duration, ease):
          segments[key] = .keyframes(t0: t, from: pos, to: to, frames: frames, duration: duration, ease: ease, owner: state)
        case let .kick(kick):
          var vel = v
          if case let .spring(_, _, _, k) = kick { vel[0] += k ?? 0 }
          segments[key] = .motion(t0: t, from: pos, v0: vel, to: to, motion: kick)
        }
      }
    }
  }

  private func fireDue(_ t: Double) {
    while true {
      var next: Pending?
      for p in pending where p.pausedAt == nil && p.due <= t + 1e-9 {
        if next == nil || p.due < next!.due || (p.due == next!.due && p.order < next!.order) { next = p }
      }
      guard let due = next else { return }
      pending.removeAll { $0 === due }
      var fired: [Transition] = [], entered: [State] = []
      perform(due.machine, due.transition, due.due, &fired, &entered)
      settle(due.due, fired, entered)
    }
  }

  private func controlTimers(_ event: String, _ t: Double) -> Bool {
    var handled = false
    for timer in pending {
      for (i, pair) in timer.pause.enumerated() {
        if event == pair.on {
          handled = true
          if timer.blockers.contains(i) { continue }
          if timer.blockers.isEmpty { timer.pausedAt = t }
          timer.blockers.insert(i)
        } else if event == pair.off {
          handled = true
          if timer.blockers.remove(i) == nil || !timer.blockers.isEmpty { continue }
          timer.due += t - timer.pausedAt!
          timer.pausedAt = nil
        }
      }
    }
    return handled
  }

  private func advanceTo(_ t: Double) throws {
    if !t.isFinite || t < now { throw RuntimeError.timeWentBackwards(t, now) }
    now = t
    fireDue(t)
  }

  private func valueOf(_ key: String, _ t: Double) -> [Double] {
    let prop = program.property(key)!
    if let map = prop.map {
      guard let from = resolvedMap(key, map) else { return prop.base }
      let source = map.sourceKind == "input" ? inputAt(map.source, t) : evaluate(segments[map.source]!, t).0[0]
      return interpolate(from, map.to, source)
    }
    return evaluate(segments[key]!, t).0
  }

  // MARK: public API

  /** Sends an event at time `t` (seconds). Returns false if nothing handled it. */
  @discardableResult
  public func send(_ event: String, at t: Double) throws -> Bool {
    try advanceTo(t)
    if let dot = event.firstIndex(of: "."), event[event.index(after: dot)...] == "dragstart" {
      let target = event[..<dot]
      for axis in ["x", "y"] { inputs["\(target).drag.\(axis)"] = [(t, 0)] }
    }
    var fired: [Transition] = [], entered: [State] = []
    let timerHandled = controlTimers(event, t)
    if !handle(program.machine, event, t, &fired, &entered) { return timerHandled }
    settle(t, fired, entered)
    return true
  }

  /** Records a referenced continuous input or a layout report. */
  @discardableResult
  public func input(_ name: String, _ value: Double, at t: Double) throws -> Bool {
    try advanceTo(t)
    let parts = name.split(separator: ".").map(String.init)
    guard value.isFinite else { return false }
    if parts.count == 3 && program.targets.contains(parts[0]) && parts[1] == "layout" {
      guard LAYOUT_NAMES.contains(parts[2]) else { return false }
      let first = layout[name] == nil
      if layout[name] == value { return true }
      layout[name] = value
      settle(t, [], [], snap: first)
      return true
    }
    guard requiredInputs.contains(name) else { return false }
    inputs[name, default: []].append((t, value))
    return true
  }

  /** Values at time `t`: numbers in logical units, colors as hex. */
  public func sample(_ t: Double) throws -> [String: Value] {
    try advanceTo(t)
    var out: [String: Value] = [:]
    for (key, prop) in program.properties {
      let c = valueOf(key, t)
      out[key] = prop.kind == .color ? .color(oklabToHex(c)) : .number(c[0])
    }
    return out
  }

  /** Active leaf states as paths, e.g. ["on"] or ["checked/on", "press/up"]. */
  public func state() -> [String] {
    var out: [String] = []
    func walk(_ m: Machine, _ prefix: String) {
      switch m.kind {
      case let .regions(regions): for (name, r) in regions { walk(r, prefix.isEmpty ? name : "\(prefix)/\(name)") }
      case .states:
        let name = active[ObjectIdentifier(m)]!
        let state = m.state(name)!
        let path = prefix.isEmpty ? name : "\(prefix)/\(name)"
        if let inner = state.machine { walk(inner, path) } else { out.append(path) }
      }
    }
    walk(program.machine, "")
    return out
  }

  /** True when every property has come to rest and no unpaused timer is counting down. */
  public func settled(_ t: Double, property: String? = nil) throws -> Bool {
    try advanceTo(t)
    if property == nil && pending.contains(where: { $0.pausedAt == nil }) { return false }
    let keys = property.map { [$0] } ?? program.properties.map { $0.0 }
    return keys.allSatisfy { key in
      let prop = program.property(key)!
      if prop.map?.sourceKind == "input" { return true }
      let source = prop.map?.source ?? key
      if case let .keyframes(t0, _, _, _, duration, _, _) = segments[source]! { return t - t0 >= duration }
      guard case let .motion(t0, from, v0, to, motion) = segments[source]!, let motion else { return true }
      switch motion {
      case let .tween(duration, _): return t - t0 >= duration
      case let .spring(k, _, m, _):
        let (pos, vel) = evaluateMotion(t0: t0, from: from, v0: v0, to: to, motion: motion, t: t)
        let eps = program.property(source)!.kind == .color ? REST_COLOR : REST_NUMBER
        let inertia = m / k
        return pos.indices.allSatisfy { hypot(pos[$0] - to[$0], vel[$0] * inertia.squareRoot()) < eps }
      }
    }
  }
}
