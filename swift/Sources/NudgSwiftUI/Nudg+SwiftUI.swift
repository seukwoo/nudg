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
  private let start: Date
  private let clock: () -> Date
  private var lastTime = 0.0

  public init(_ program: Program, state: [String] = [], reducedMotion: Bool? = nil, clock: @escaping () -> Date = Date.init) {
    #if os(iOS)
    let reduce = reducedMotion ?? UIAccessibility.isReduceMotionEnabled
    #else
    let reduce = reducedMotion ?? false
    #endif
    self.runtime = try! Runtime(program, state: state, reducedMotion: reduce)
    self.clock = clock
    self.start = clock()
    self.state = runtime.state()
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
    let s = runtime.state()
    if s != state { state = s }
    objectWillChange.send()
    return handled
  }

  /** A layout report or an input sample, now. */
  @discardableResult
  public func input(_ name: String, _ value: Double) -> Bool {
    let used = (try? runtime.input(name, value, at: time(at: clock()))) ?? false
    objectWillChange.send()
    return used
  }

  public func values(at date: Date) -> [String: Value] {
    let t = time(at: date)
    let v = (try? runtime.sample(t)) ?? [:]
    let s = runtime.state()
    if s != state { DispatchQueue.main.async { self.state = s } } // a timer fired
    return v
  }

  public func settled(at date: Date) -> Bool { (try? runtime.settled(time(at: date))) ?? true }

  /** The model's own clock: the real time in an app, a fixed one in tests and previews. */
  public var now: Date { clock() }
}

/** Applies a target's values to a view: offset, rotation, scale, opacity, size, background color. */
public struct NudgTarget: ViewModifier {
  @ObservedObject var model: NudgModel
  let name: String

  public func body(content: Content) -> some View {
    // The timeline only says when to redraw; the time comes from the model's clock.
    TimelineView(.animation(minimumInterval: nil, paused: model.settled(at: model.now))) { _ in
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

/** Sends down, up and tap for a target, the way the DOM adapter does. */
public struct NudgPress: ViewModifier {
  @ObservedObject var model: NudgModel
  let name: String
  @SwiftUI.State private var pressed = false

  public func body(content: Content) -> some View {
    content.gesture(
      DragGesture(minimumDistance: 0)
        .onChanged { _ in if !pressed { pressed = true; model.send("\(name).down") } }
        .onEnded { _ in pressed = false; model.send("\(name).up"); model.send("\(name).tap") }
    )
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
