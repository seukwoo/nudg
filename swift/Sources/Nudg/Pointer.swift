// The pointer rules every adapter follows (the same as the web and React Native): a
// press is `down`; past 4 logical units of travel a draggable target gets `dragstart`
// and `drag.x` / `drag.y` measured from the press; the release is `up` (or `cancel`
// outside), then `dragend` after a drag, or `tap` after a press that didn't drag.

import Foundation

public let dragSlop = 4.0

public extension Program {
  /** Every event the program handles, in any state. */
  var handledEvents: Set<String> {
    var out = Set<String>()
    func walk(_ m: Machine) {
      switch m.kind {
      case let .regions(regions): for (_, r) in regions { walk(r) }
      case let .states(_, states, when):
        for (e, _) in when { out.insert(e) }
        for s in states {
          for (e, _) in s.when { out.insert(e) }
          for timer in s.timers { for pair in timer.pause { out.insert(pair.on); out.insert(pair.off) } }
          if let inner = s.machine { walk(inner) }
        }
      }
    }
    walk(machine)
    return out
  }

  /** Targets whose pinches the program listens for (v0.18). */
  var pinchableTargets: Set<String> {
    Set(handledEvents.compactMap { e in
      let parts = e.split(separator: ".")
      return parts.count == 2 && (parts[1] == "pinchstart" || parts[1] == "pinchend") ? String(parts[0]) : nil
    })
  }

  /** Targets whose drags the program listens for. */
  var draggableTargets: Set<String> {
    Set(handledEvents.compactMap { e in
      let parts = e.split(separator: ".")
      return parts.count == 2 && (parts[1] == "dragstart" || parts[1] == "dragend") ? String(parts[0]) : nil
    })
  }
}

/** What a pinch reports, from where the two pointers were when it started (v0.18). */
public func nudgPinchInputs(start: [(Double, Double)], now: [(Double, Double)]) -> (scale: Double, rotation: Double, x: Double, y: Double) {
  let (a0, b0) = (start[0], start[1]), (a, b) = (now[0], now[1])
  let d0 = hypot(b0.0 - a0.0, b0.1 - a0.1), d = hypot(b.0 - a.0, b.1 - a.1)
  var rotation = (atan2(b.1 - a.1, b.0 - a.0) - atan2(b0.1 - a0.1, b0.0 - a0.0)) * 180 / .pi
  // The turn between the two, in (-180, 180].
  rotation -= 360 * (rotation / 360 - 0.5).rounded(.up)
  return (d0 == 0 ? 1 : d / d0, rotation, (a.0 + b.0 - a0.0 - b0.0) / 2, (a.1 + b.1 - a0.1 - b0.1) / 2)
}

public final class PointerTracker {
  private let target: String
  private let draggable: Bool
  private let pinchable: Bool
  private let send: (String) -> Void
  private let input: (String, Double) -> Void
  private var origin: (Double, Double)?
  /** The pointer that pressed first: it alone drags, taps and releases the press. */
  private var first: Int?
  private var dragging = false
  /** Every pointer on the target, by id, where it is now. */
  private var points: [Int: (Double, Double)] = [:]
  /** The two pointers of a pinch and where they were when it started (v0.18). */
  private var pinch: (ids: [Int], start: [(Double, Double)])?
  /** This press pinched, so it neither drags nor taps afterwards. */
  private var pinched = false

  public init(target: String, draggable: Bool, pinchable: Bool = false, send: @escaping (String) -> Void, input: @escaping (String, Double) -> Void) {
    self.target = target; self.draggable = draggable; self.pinchable = pinchable; self.send = send; self.input = input
  }

  /** Pointer `id` pressed at (x, y). A second one on a pinchable target starts a pinch. */
  public func down(_ x: Double, _ y: Double, id: Int = 0) {
    points[id] = (x, y)
    if origin == nil {
      origin = (x, y); first = id; dragging = false; pinched = false
      send("\(target).down")
      return
    }
    guard pinchable, pinch == nil, points.count == 2, let first else { return }
    // A drag in progress becomes the pinch.
    if dragging { dragging = false; send("\(target).dragend") }
    pinch = ([first, id], [points[first]!, points[id]!])
    pinched = true
    send("\(target).pinchstart")
  }

  public func move(_ x: Double, _ y: Double, id: Int = 0) {
    guard points[id] != nil else { return }
    points[id] = (x, y)
    if let pinch {
      guard pinch.ids.contains(id) else { return }
      let p = nudgPinchInputs(start: pinch.start, now: pinch.ids.map { points[$0]! })
      for (name, value) in [("scale", p.scale), ("rotation", p.rotation), ("x", p.x), ("y", p.y)] { input("\(target).pinch.\(name)", value) }
      return
    }
    guard let (x0, y0) = origin, id == first, draggable, !pinched else { return }
    let dx = x - x0, dy = y - y0
    if !dragging {
      if hypot(dx, dy) <= dragSlop { return }
      dragging = true
      send("\(target).dragstart")
    }
    input("\(target).drag.x", dx)
    input("\(target).drag.y", dy)
  }

  /** Pointer `id` released; `inside` is false when it left the target. */
  public func up(inside: Bool = true, id: Int = 0) {
    guard points.removeValue(forKey: id) != nil else { return }
    if let pinch, pinch.ids.contains(id) { self.pinch = nil; send("\(target).pinchend") }
    guard id == first, origin != nil else { return }
    origin = nil; first = nil
    send("\(target).\(inside ? "up" : "cancel")")
    if dragging { send("\(target).dragend") } else if inside && !pinched { send("\(target).tap") }
    dragging = false
  }

  public func cancel() {
    guard origin != nil else { return }
    origin = nil; first = nil; points = [:]
    send("\(target).cancel")
    if pinch != nil { send("\(target).pinchend") }
    if dragging { send("\(target).dragend") }
    pinch = nil
    dragging = false
  }
}

/** The web's key names: lowercased `KeyboardEvent.key`, " " as "space". */
public func nudgKeyName(_ key: String) -> String { key == " " ? "space" : key.lowercased() }
