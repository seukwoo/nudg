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

  /** Targets whose drags the program listens for. */
  var draggableTargets: Set<String> {
    Set(handledEvents.compactMap { e in
      let parts = e.split(separator: ".")
      return parts.count == 2 && (parts[1] == "dragstart" || parts[1] == "dragend") ? String(parts[0]) : nil
    })
  }
}

public final class PointerTracker {
  private let target: String
  private let draggable: Bool
  private let send: (String) -> Void
  private let input: (String, Double) -> Void
  private var origin: (Double, Double)?
  private var dragging = false

  public init(target: String, draggable: Bool, send: @escaping (String) -> Void, input: @escaping (String, Double) -> Void) {
    self.target = target; self.draggable = draggable; self.send = send; self.input = input
  }

  public func down(_ x: Double, _ y: Double) {
    origin = (x, y)
    dragging = false
    send("\(target).down")
  }

  public func move(_ x: Double, _ y: Double) {
    guard let (x0, y0) = origin, draggable else { return }
    let dx = x - x0, dy = y - y0
    if !dragging {
      if hypot(dx, dy) <= dragSlop { return }
      dragging = true
      send("\(target).dragstart")
    }
    input("\(target).drag.x", dx)
    input("\(target).drag.y", dy)
  }

  public func up(inside: Bool = true) {
    guard origin != nil else { return }
    origin = nil
    send("\(target).\(inside ? "up" : "cancel")")
    if dragging { send("\(target).dragend") } else if inside { send("\(target).tap") }
    dragging = false
  }

  public func cancel() {
    guard origin != nil else { return }
    origin = nil
    send("\(target).cancel")
    if dragging { send("\(target).dragend") }
    dragging = false
  }
}

/** The web's key names: lowercased `KeyboardEvent.key`, " " as "space". */
public func nudgKeyName(_ key: String) -> String { key == " " ? "space" : key.lowercased() }
