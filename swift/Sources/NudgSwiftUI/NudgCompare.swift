// Two versions of a component side by side, on the app's own views: the native side of
// `nudg compare`. The bundle (`nudg compare a b --bundle x.compare.json`) carries both
// versions, the events and the verdict; the view plays them in a loop, mirrors what you do
// on one side into the other, and slows down to ¼× or ⅒×.
//
//   #Preview {
//     NudgCompare(try! Comparison.decode(Data(contentsOf: Bundle.main.url(forResource: "toggle.compare", withExtension: "json")!))) { model in
//       ToggleView(model: model)
//     }
//   }

#if canImport(SwiftUI)
import Combine
import Foundation
import Nudg
import SwiftUI

/** Both players of a comparison, on one clock that can run slow. */
@MainActor
final class CompareSession: ObservableObject {
  let comparison: Comparison
  @Published private(set) var a: NudgModel
  @Published private(set) var b: NudgModel
  /** 1, 0.25 or 0.1: how fast the shared clock runs. */
  @Published var speed = 1.0 {
    didSet { anchor = (wall(), virtual(at: anchor, speed: oldValue)) }
  }
  private let wall: () -> Date
  private var anchor: (wall: Date, virtual: Double)
  private var runStart = 0.0
  private var next = 0
  private var mirroring = false
  /** How long a run lingers at rest before it starts over. */
  static let pause = 0.8

  init(_ comparison: Comparison, wall: @escaping () -> Date = Date.init) {
    self.comparison = comparison
    self.wall = wall
    anchor = (wall(), 0)
    let placeholder = { NudgModel(comparison.a, state: comparison.start, reducedMotion: comparison.reducedMotion) }
    a = placeholder()
    b = placeholder()
    replay()
  }

  private func virtual(at anchor: (wall: Date, virtual: Double), speed: Double) -> Double {
    anchor.virtual + wall().timeIntervalSince(anchor.wall) * speed
  }

  /** Seconds on the shared clock. */
  var now: Double { virtual(at: anchor, speed: speed) }

  /** Seconds into the current run, on the comparison's timeline. */
  var elapsed: Double { now - runStart }

  /** Starts both versions over from the beginning. */
  func replay() {
    runStart = now
    next = 0
    let clock = { [unowned self] in Date(timeIntervalSinceReferenceDate: self.now) }
    a = NudgModel(comparison.a, state: comparison.start, reducedMotion: comparison.reducedMotion, clock: clock)
    b = NudgModel(comparison.b, state: comparison.start, reducedMotion: comparison.reducedMotion, clock: clock)
    // What a person does on one side happens on the other too; layout stays each side's own.
    for (from, to) in [(a, b), (b, a)] {
      from.onSend = { [unowned self, unowned to] event in self.mirror { to.send(event) } }
      from.onInput = { [unowned self, unowned to] name, value in
        if !name.contains(".layout.") { self.mirror { to.input(name, value) } }
      }
    }
  }

  private func mirror(_ send: () -> Void) {
    guard !mirroring else { return }
    mirroring = true
    send()
    mirroring = false
  }

  /** Sends the steps that are due to both versions, and starts over once both have rested a moment. */
  func pump() {
    let t = elapsed
    while next < comparison.steps.count, comparison.steps[next].t <= t {
      let step = comparison.steps[next]
      mirror {
        for model in [a, b] {
          switch step {
          case let .event(_, name): model.send(name)
          case let .input(_, name, value): model.input(name, value)
          }
        }
      }
      next += 1
    }
    if next == comparison.steps.count, t > comparison.until + Self.pause { replay() }
  }
}

/**
 * Plays a comparison's two versions side by side, each through `content`, the app's own
 * view for one player: the headline first, then before and after, in a loop. A tap or drag
 * on either side happens on both. Replay starts over; the speeds slow both down.
 */
public struct NudgCompare<Content: View>: View {
  @StateObject private var session: CompareSession
  private let content: (NudgModel) -> Content
  private let ticks = Timer.publish(every: 1.0 / 60, on: .main, in: .common).autoconnect()

  public init(_ comparison: Comparison, @ViewBuilder content: @escaping (NudgModel) -> Content) {
    _session = StateObject(wrappedValue: CompareSession(comparison))
    self.content = content
  }

  init(session: CompareSession, @ViewBuilder content: @escaping (NudgModel) -> Content) {
    _session = StateObject(wrappedValue: session)
    self.content = content
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(session.comparison.headline).font(.callout)
      if let suggestion = session.comparison.suggestion {
        Text(suggestion).font(.footnote).foregroundStyle(.secondary)
      }
      HStack(alignment: .top, spacing: 16) {
        side(session.comparison.labels.0, "before", session.a)
        side(session.comparison.labels.1, "the change", session.b)
      }
      HStack(spacing: 12) {
        Button("Replay") { session.replay() }
        Spacer().frame(width: 8)
        Text("Speed").font(.caption).foregroundStyle(.secondary)
        ForEach([(1.0, "1×"), (0.25, "¼×"), (0.1, "⅒×")], id: \.0) { speed, label in
          Button(label) { session.speed = speed }
            .fontWeight(session.speed == speed ? .bold : .regular)
            .accessibilityAddTraits(session.speed == speed ? .isSelected : [])
        }
      }
    }
    .padding()
    .onReceive(ticks) { _ in session.pump() }
  }

  private func side(_ label: String, _ role: String, _ model: NudgModel) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      (Text(label).bold() + Text(" · \(role)").foregroundColor(.secondary)).font(.caption)
      // A new player on replay gets fresh views, so gesture state doesn't carry over.
      content(model).id(ObjectIdentifier(model))
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
#endif
