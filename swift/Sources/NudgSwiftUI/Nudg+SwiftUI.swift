// SwiftUI adapter. A model owns the runtime; views read its values every frame through
// TimelineView, so nothing but the animated views redraws while things move.
//
//   @StateObject var toggle = NudgModel(try! Program.decode(data))
//   Capsule().nudg(toggle, "track").overlay(Circle().nudg(toggle, "knob"))
//     .onTapGesture { toggle.send("track.tap") }

#if canImport(SwiftUI)
import Combine
import Foundation
import Nudg
import SwiftUI

@MainActor
public final class NudgModel: ObservableObject {
  public let runtime: Runtime
  /** Active states; updates when an event or timer changes them. */
  @Published public private(set) var state: [String]
  /** False once the component has exited (see `exit`); render nothing then. True again if it is shown again. */
  @Published public private(set) var present = true
  private let start: Date
  private let clock: () -> Date
  private var lastTime = 0.0
  private let lifecycle: Lifecycle
  // Views read values while SwiftUI updates them; what they report is published afterwards.
  private var inFrame = false

  /**
   * `exit` names the states that mean the component is gone ("hidden"): `present` turns false
   * and `onExit` is called once the exit motion has settled. `onSettle` is called with the
   * active states each time every value has come to rest after something moved or the
   * state changed, as in every other adapter.
   */
  public init(_ program: Program, state: [String] = [], reducedMotion: Bool? = nil, exit: [String] = [], onSettle: (([String]) -> Void)? = nil, onExit: (() -> Void)? = nil, clock: @escaping () -> Date = Date.init) {
    #if os(iOS)
    let reduce = reducedMotion ?? UIAccessibility.isReduceMotionEnabled
    #else
    let reduce = reducedMotion ?? false
    #endif
    self.runtime = try! Runtime(program, state: state, reducedMotion: reduce)
    self.clock = clock
    self.start = clock()
    self.state = runtime.state()
    self.lifecycle = Lifecycle(runtime, exit: exit)
    lifecycle.onState = { [unowned self] s in publish { self.state = s } }
    lifecycle.onSettle = onSettle.map { callback in { [unowned self] s in publish { callback(s) } } }
    lifecycle.onExit = { [unowned self] in
      publish {
        self.present = false
        onExit?()
      }
    }
  }

  private func publish(_ change: @escaping () -> Void) {
    if inFrame { DispatchQueue.main.async(execute: change) } else { change() }
  }

  private func changed() {
    lifecycle.changed()
    if lifecycle.present && !present { present = true }
  }

  /** The player's time in seconds. Never goes backwards, whatever the views ask. */
  public func time(at date: Date) -> Double {
    lastTime = max(lastTime, date.timeIntervalSince(start))
    return lastTime
  }

  /** Sends an event now, e.g. "track.tap" or "host.show". */
  @discardableResult
  public func send(_ event: String) -> Bool {
    let handled = (try? runtime.send(event, at: time(at: clock()))) ?? false
    changed()
    objectWillChange.send()
    return handled
  }

  /** A layout report or an input sample, now. */
  @discardableResult
  public func input(_ name: String, _ value: Double) -> Bool {
    let used = (try? runtime.input(name, value, at: time(at: clock()))) ?? false
    changed()
    objectWillChange.send()
    return used
  }

  public func values(at date: Date) -> [String: Value] {
    let t = time(at: date)
    let v = (try? runtime.sample(t)) ?? [:]
    inFrame = true
    lifecycle.frame(t) // a timer may have fired; settle and exit are reported from here
    if lifecycle.present && !present { publish { self.present = true } }
    inFrame = false
    return v
  }

  public func settled(at date: Date) -> Bool { (try? runtime.settled(time(at: date))) ?? true }

  /** True while a state loops a property (format 0.10), so views keep redrawing after motion settles. */
  public var looping: Bool { runtime.looping() }

  /** The model's own clock: the real time in an app, a fixed one in tests and previews. */
  public var now: Date { clock() }
}

/** Applies a target's values to a view: offset, rotation, scale, opacity, size, background color. */
public struct NudgTarget: ViewModifier {
  @ObservedObject var model: NudgModel
  let name: String

  public func body(content: Content) -> some View {
    // The timeline only says when to redraw; the time comes from the model's clock.
    TimelineView(.animation(minimumInterval: nil, paused: model.settled(at: model.now) && !model.looping)) { _ in
      let v = model.values(at: model.now)
      let n = { (p: String, d: Double) in v["\(name).\(p)"]?.number ?? d }
      let scale = n("scale", 1)
      content
        .frame(width: v["\(name).width"]?.number.map { CGFloat($0) }, height: v["\(name).height"]?.number.map { CGFloat($0) })
        .background(v["\(name).color"]?.color.map { Color(nudgHex: $0) } ?? Color.clear)
        .scaleEffect(x: CGFloat(scale * n("scaleX", 1)), y: CGFloat(scale * n("scaleY", 1)))
        .rotationEffect(.degrees(n("rotation", 0)))
        .offset(x: CGFloat(n("x", 0)), y: CGFloat(n("y", 0)))
        .opacity(n("opacity", 1))
    }
  }
}

/**
 * Press and drag for a target, by the same rules as the web: down, up and tap; for
 * targets the file drags, dragstart, drag.x / drag.y and dragend, with a 4-point slop.
 * For targets the file pinches (format 0.18), the system's magnify and rotate gestures
 * end the press and report pinchstart, pinch.scale, pinch.rotation and pinchend; SwiftUI
 * doesn't report the fingers' centre, so pinch.x and pinch.y stay 0.
 */
public struct NudgPress: ViewModifier {
  @ObservedObject var model: NudgModel
  let name: String
  @SwiftUI.State private var tracker: PointerTracker?
  @SwiftUI.State private var pinching = false

  public func body(content: Content) -> some View {
    let drag = DragGesture(minimumDistance: 0)
      .onChanged { g in
        guard !pinching else { return }
        if tracker == nil {
          let t = PointerTracker(target: name, draggable: model.runtime.program.draggableTargets.contains(name), send: { model.send($0) }, input: { model.input($0, $1) })
          t.down(0, 0)
          tracker = t
        }
        tracker?.move(Double(g.translation.width), Double(g.translation.height))
      }
      .onEnded { _ in
        tracker?.up()
        tracker = nil
      }
    if model.runtime.program.pinchableTargets.contains(name) {
      content.gesture(drag).simultaneousGesture(
        MagnifyGesture().simultaneously(with: RotateGesture())
          .onChanged { value in
            if !pinching {
              // The second finger ends the press: no tap, no drag (as PointerTracker does).
              tracker?.cancel()
              tracker = nil
              pinching = true
              model.send("\(name).pinchstart")
            }
            model.input("\(name).pinch.scale", Double(value.first?.magnification ?? 1))
            model.input("\(name).pinch.rotation", value.second?.rotation.degrees ?? 0)
          }
          .onEnded { _ in
            pinching = false
            model.send("\(name).pinchend")
          }
      )
    } else {
      content.gesture(drag)
    }
  }
}

/** Keys while the view has focus: `target.key.<name>` for the keys the file listens for. */
public struct NudgKeys: ViewModifier {
  @ObservedObject var model: NudgModel
  let name: String

  public func body(content: Content) -> some View {
    content.focusable().onKeyPress { press in
      let key: String
      switch press.key {
      case .leftArrow: key = "arrowleft"
      case .rightArrow: key = "arrowright"
      case .upArrow: key = "arrowup"
      case .downArrow: key = "arrowdown"
      case .escape: key = "escape"
      case .return: key = "enter"
      case .space: key = "space"
      case .tab: key = "tab"
      case .home: key = "home"
      case .end: key = "end"
      case .pageUp: key = "pageup"
      case .pageDown: key = "pagedown"
      case .delete: key = "backspace"
      case .deleteForward: key = "delete"
      default: key = nudgKeyName(press.characters)
      }
      let event = "\(name).key.\(key)"
      guard model.runtime.program.handledEvents.contains(event) else { return .ignored }
      model.send(event)
      return .handled
    }
  }
}

/** Reports the view's frame for `measure` (format 0.4), in the given coordinate space. */
public struct NudgLayout: ViewModifier {
  @ObservedObject var model: NudgModel
  let name: String
  let space: CoordinateSpace

  public func body(content: Content) -> some View {
    content.background(GeometryReader { geo in
      let f = geo.frame(in: space)
      Color.clear
        .onAppear { report(f) }
        .onChange(of: f) { report($0) }
    })
  }

  private func report(_ f: CGRect) {
    for (m, v) in [("x", f.minX), ("y", f.minY), ("width", f.width), ("height", f.height)] { model.input("\(name).layout.\(m)", Double(v)) }
  }
}

public extension View {
  func nudg(_ model: NudgModel, _ name: String) -> some View { modifier(NudgTarget(model: model, name: name)) }
  func nudgPress(_ model: NudgModel, _ name: String) -> some View { modifier(NudgPress(model: model, name: name)) }
  func nudgKeys(_ model: NudgModel, _ name: String) -> some View { modifier(NudgKeys(model: model, name: name)) }
  func nudgLayout(_ model: NudgModel, _ name: String, in space: CoordinateSpace = .global) -> some View { modifier(NudgLayout(model: model, name: name, space: space)) }
}

public extension Color {
  /** "#4ADE80" or "#4ADE80CC". */
  init(nudgHex hex: String) {
    let h = Array(hex.dropFirst())
    let byte = { (i: Int) in Double(Int(String(h[i...i + 1]), radix: 16) ?? 0) / 255 }
    self.init(.sRGB, red: byte(0), green: byte(2), blue: byte(4), opacity: h.count >= 8 ? byte(6) : 1)
  }
}
#endif
