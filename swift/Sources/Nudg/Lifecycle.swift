// What a host hears about a player's life, by the same rules in every adapter: the active
// states when they change, when everything has come to rest (settle), and when the
// component has exited. Adapters call `changed` after an event, input or layout report
// and `frame` after applying a frame's values.

public final class Lifecycle {
  private let runtime: Runtime
  private let exits: Set<String>
  /** The active states, after an event or timer changes them. */
  public var onState: (([String]) -> Void)?
  /**
   * Every value has come to rest after something moved or the state changed. Once per
   * rest, with the active states; pending timers don't delay it, and values that follow
   * or are mapped from an input count as at rest.
   */
  public var onSettle: (([String]) -> Void)?
  /** The machine has entered an exit state from elsewhere and is settled. */
  public var onExit: (() -> Void)?
  /** False once the component has exited, until it leaves the exit state again. */
  public private(set) var present = true
  private var lastState: [String]
  // A settle is owed once something moved or the state changed, and paid at the next rest.
  private var owed = false
  // Only an exit entered from somewhere else counts; mounting in "hidden" hasn't exited anything.
  private var armed = false

  public init(_ runtime: Runtime, exit: [String] = []) {
    self.runtime = runtime
    self.exits = Set(exit)
    self.lastState = runtime.state()
    self.armed = !exits.isEmpty && !inExit()
  }

  /** After an event, input sample or layout report, at the runtime's current time. */
  public func changed() {
    syncState()
    // Read the time after onState: a host may send more from inside it.
    let t = runtime.time()
    if !((try? runtime.resting(t)) ?? true) { owed = true }
    // An exit with nothing left to move is complete at once; otherwise frames finish it.
    syncPresence(t)
  }

  /** After the values at `t` were applied. True while the host should keep sending frames. */
  @discardableResult
  public func frame(_ at: Double) -> Bool {
    syncState() // timers may have fired while time advanced
    let t = max(at, runtime.time())
    if !((try? runtime.resting(t)) ?? true) { owed = true }
    else if owed {
      owed = false
      onSettle?(runtime.state())
    }
    let settled = (try? runtime.settled(t)) ?? true
    if settled { syncPresence(t) }
    return !settled || owed
  }

  private func inExit() -> Bool {
    runtime.state().contains { exits.contains($0) || exits.contains(String($0.split(separator: "/").last ?? "")) }
  }

  private func syncState() {
    let s = runtime.state()
    if s == lastState { return }
    lastState = s
    owed = true
    onState?(s)
  }

  private func syncPresence(_ t: Double) {
    if exits.isEmpty { return }
    if !inExit() {
      armed = true
      present = true
      return
    }
    if armed && present && ((try? runtime.settled(t)) ?? true) {
      present = false
      armed = false
      onExit?()
    }
  }
}
