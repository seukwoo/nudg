// The Swift runtime and SwiftUI adapter, checked where apps run them: on an iOS simulator
// (xcodebuild test) as well as on the Mac (swift test). The conformance suite is the same
// one NudgConformance runs; the render check draws a real SwiftUI view and reads its pixels.

import Foundation
import Nudg
import NudgConformanceSuite
@testable import NudgSwiftUI
import SwiftUI
import XCTest

/**
 * The repository's spec/conformance, found from this file. On a simulator the Mac's protected
 * folders (Documents, Desktop) can't be read without a permission prompt nobody can answer,
 * so test-ios.sh copies the suite elsewhere and passes it as NUDG_CONFORMANCE.
 */
private let conformance = ProcessInfo.processInfo.environment["NUDG_CONFORMANCE"].map { URL(fileURLWithPath: $0) }
  ?? URL(fileURLWithPath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .appendingPathComponent("spec/conformance")

final class ConformanceTests: XCTestCase {
  func testTheWholeSuitePasses() throws {
    var lines: [String] = []
    let (passed, failures) = try runConformanceSuite(at: conformance, log: { lines.append($0) })
    XCTAssertGreaterThan(passed, 40)
    XCTAssertEqual(failures, [], lines.filter { $0.hasPrefix("FAIL") }.joined(separator: "\n"))
  }
}

@MainActor
final class SwiftUITests: XCTestCase {
  private struct Toggle: View {
    @ObservedObject var model: NudgModel
    var body: some View {
      ZStack(alignment: .leading) {
        Capsule().fill(Color.clear).frame(width: 52, height: 32).nudg(model, "track")
        Circle().fill(Color.white).frame(width: 24, height: 24).padding(4).nudg(model, "knob")
      }
      .clipShape(Capsule())
      .padding(8)
      .background(Color.black)
    }
  }

  private func program(_ name: String) throws -> Program {
    try Program.decode(Data(contentsOf: conformance.appendingPathComponent("programs/\(name).program.json")))
  }

  /** The rendered toggle's pixel at (x, y) points, as 0–255 RGB. */
  private func pixel(_ model: NudgModel, x: Double, y: Double) throws -> [Int] {
    let renderer = ImageRenderer(content: Toggle(model: model))
    renderer.scale = 2
    let image = try XCTUnwrap(renderer.cgImage)
    var rgba = [UInt8](repeating: 0, count: 4)
    let context = try XCTUnwrap(CGContext(data: &rgba, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    // Draw the image so the wanted pixel lands on the context's only one (y grows up in Core Graphics).
    context.draw(image, in: CGRect(x: -x * 2, y: -(Double(image.height) - y * 2), width: Double(image.width), height: Double(image.height)))
    return rgba.prefix(3).map(Int.init)
  }

  func testTheToggleRendersWhereTheRuntimeSays() throws {
    var now = Date(timeIntervalSince1970: 0)
    let model = NudgModel(try program("toggle-tap"), reducedMotion: false, clock: { now })
    // The knob's centre is 8 + 4 + 12 = 24 pt from the left when off, and 20 pt further when on.
    let off = try pixel(model, x: 24, y: 24), track = try pixel(model, x: 44, y: 24)
    XCTAssertEqual(off, [255, 255, 255], "the knob is on the left")
    XCTAssertNotEqual(track, [255, 255, 255], "the track shows on the right")

    now = Date(timeIntervalSince1970: 0.1)
    model.send("track.tap")
    now = Date(timeIntervalSince1970: 2)
    XCTAssertEqual(model.values(at: now)["knob.x"]?.number ?? .nan, 20, accuracy: 0.01)
    XCTAssertEqual(try pixel(model, x: 44, y: 24), [255, 255, 255], "the knob moved right")
    XCTAssertNotEqual(try pixel(model, x: 24, y: 24), [255, 255, 255], "and the track shows where it was")
    XCTAssertEqual(model.state, ["on"])
  }

  func testOneSettlePerRestAndExitOnceSettled() throws {
    var now = Date(timeIntervalSince1970: 0)
    var settles: [[String]] = []
    var exits = 0
    let model = NudgModel(try program("toggle-tap"), reducedMotion: false, exit: ["off"], onSettle: { settles.append($0) }, onExit: { exits += 1 }, clock: { now })
    func frames(until seconds: Double) {
      while now.timeIntervalSince1970 < seconds {
        now = now.addingTimeInterval(1.0 / 60)
        _ = model.values(at: now)
      }
      RunLoop.main.run(until: Date().addingTimeInterval(0.05)) // what frames report is published after them
    }
    model.send("track.tap")
    frames(until: 0.05)
    model.send("track.tap") // interrupted: only the rest after it is reported
    frames(until: 0.1)
    model.send("track.tap")
    frames(until: 2)
    XCTAssertEqual(settles, [["on"]])
    XCTAssertEqual(exits, 0)
    model.send("track.tap")
    frames(until: 4)
    XCTAssertEqual(settles, [["on"], ["off"]])
    XCTAssertEqual(exits, 1)
    XCTAssertFalse(model.present)
  }

  #if os(iOS)
  /** Every accessibility element under `object`, depth first, each once. */
  private func elements(_ object: NSObject, _ seen: inout Set<ObjectIdentifier>) -> [NSObject] {
    guard seen.insert(ObjectIdentifier(object)).inserted, seen.count < 500 else { return [] }
    let count = object.accessibilityElementCount()
    let children = (object.accessibilityElements as? [NSObject] ?? []) + (count > 0 && count != NSNotFound ? (0..<count).compactMap { object.accessibilityElement(at: $0) as? NSObject } : [])
    return [object] + (children + ((object as? UIView)?.subviews ?? [])).flatMap { elements($0, &seen) }
  }

  func testAnAccessibilityActivationIsATap() throws {
    // SwiftUI builds its accessibility tree only while assistive technology runs; turn the
    // app's accessibility on in this process (test-only; the setting persists in the simulator).
    let ax = try XCTUnwrap(dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW))
    let enable = try XCTUnwrap(dlsym(ax, "_AXSApplicationAccessibilitySetEnabled"))
    unsafeBitCast(enable, to: (@convention(c) (Bool) -> Void).self)(true)
    let model = NudgModel(try program("toggle-tap"), reducedMotion: false)
    let host = UIHostingController(rootView: Capsule().fill(Color.gray).frame(width: 52, height: 32).nudg(model, "track").nudgPress(model, "track").accessibilityLabel("Wi-Fi"))
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 200, height: 200))
    window.rootViewController = host
    window.makeKeyAndVisible()
    host.view.layoutIfNeeded()
    RunLoop.main.run(until: Date().addingTimeInterval(1))
    // What VoiceOver's double tap does: activate the element, no touch at all.
    var seen = Set<ObjectIdentifier>()
    let all = elements(host.view, &seen)
    let track = try XCTUnwrap(all.first { $0.accessibilityLabel == "Wi-Fi" }, "the track is an accessibility element")
    XCTAssertTrue(track.accessibilityActivate())
    XCTAssertEqual(model.state, ["on"])
  }
  #endif
}

@MainActor
final class CompareTests: XCTestCase {
  private var wall = Date(timeIntervalSinceReferenceDate: 1000)

  private func session() throws -> CompareSession {
    let comparison = try Comparison.decode(Data(contentsOf: conformance.appendingPathComponent("programs/toggle-bouncier.compare.json")))
    return CompareSession(comparison, wall: { [unowned self] in self.wall })
  }

  private func at(_ s: CompareSession, _ seconds: Double) {
    wall = wall.addingTimeInterval(seconds - s.elapsed)
    s.pump()
  }

  private func x(_ model: NudgModel) -> Double { model.values(at: model.now)["knob.x"]?.number ?? .nan }

  func testTheBundleFromTheCliDecodes() throws {
    let c = try session().comparison
    XCTAssertEqual(c.labels.0, "now")
    XCTAssertEqual(c.labels.1, "bouncier")
    XCTAssertTrue(c.headline.hasPrefix("A clear change: knob.x"))
    XCTAssertEqual(c.steps.count, 1)
    XCTAssertEqual(c.steps[0].t, 0.1)
    XCTAssertEqual(c.a.targets, ["knob", "track"])
  }

  func testBothPlayTheEventsOnOneTimelineAndDifferAsTheVerdictSays() throws {
    let s = try session()
    at(s, 0.05)
    XCTAssertEqual(s.a.state, ["off"])
    at(s, 0.1)
    XCTAssertEqual(s.a.state, ["on"])
    XCTAssertEqual(s.b.state, ["on"])
    // The verdict: "differs by up to 5.92 units at 0.26s".
    at(s, 0.26)
    XCTAssertEqual(x(s.b) - x(s.a), 5.92, accuracy: 0.05)
    at(s, 1.52)
    XCTAssertEqual(x(s.a), 20, accuracy: 0.01)
    XCTAssertEqual(x(s.b), 20, accuracy: 0.05)
  }

  func testATapOnOneSideHappensOnTheOther() throws {
    let s = try session()
    at(s, 0.2)
    s.b.send("track.tap")
    XCTAssertEqual(s.a.state, ["off"])
    XCTAssertEqual(s.b.state, ["off"])
  }

  func testSlowMotionSlowsTheSharedClock() throws {
    let s = try session()
    s.speed = 0.25
    let before = s.elapsed
    wall = wall.addingTimeInterval(0.4)
    XCTAssertEqual(s.elapsed - before, 0.1, accuracy: 1e-9)
  }

  func testItStartsOverOnceBothHaveRested() throws {
    let s = try session()
    at(s, 0.5)
    let first = s.a
    at(s, s.comparison.until + CompareSession.pause + 0.01)
    XCTAssertFalse(first === s.a)
    XCTAssertEqual(s.a.state, ["off"])
    XCTAssertEqual(s.elapsed, 0, accuracy: 1e-9)
  }

  /** The test toggle's knob.x on each half of an image: its left edge from the track's, less the 4 pt padding. */
  private func knobs(in image: CGImage, scale: Double) throws -> (Double?, Double?) {
    let w = image.width, h = image.height
    var px = [UInt8](repeating: 0, count: w * h * 4)
    let context = try XCTUnwrap(CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    func knob(in xs: Range<Int>) -> Double? {
      // The track's middle row (the knob's centre); on it, the first white after the track begins.
      let green = { (x: Int, y: Int) in let i = (y * w + x) * 4; return px[i + 1] > 150 && px[i] < 150 && px[i + 2] < 160 }
      let white = { (x: Int, y: Int) in let i = (y * w + x) * 4; return px[i] > 240 && px[i + 1] > 240 && px[i + 2] > 240 }
      let rows = (0..<h).filter { y in xs.contains { green($0, y) } }
      guard let top = rows.first, let bottom = rows.last else { return nil }
      let y = (top + bottom) / 2
      guard let left = xs.first(where: { green($0, y) }) else { return nil }
      guard let first = xs.first(where: { $0 > left && white($0, y) }) else { return nil }
      return Double(first - left) / scale - 4
    }
    return (knob(in: 0..<w / 2), knob(in: w / 2..<w))
  }

  /** The whole view, drawn at the moment the two differ most, for a person (or an agent) to look at. */
  func testTheViewRendersBothSides() throws {
    let s = try session()
    at(s, 0.1)
    at(s, 0.26)
    let view = NudgCompare(session: s) { model in
      ZStack(alignment: .leading) {
        Capsule().fill(Color.gray.opacity(0.3)).frame(width: 52, height: 32).nudg(model, "track").nudgPress(model, "track")
        Circle().fill(Color.white).frame(width: 24, height: 24).padding(4).nudg(model, "knob")
      }
    }
    .frame(width: 390)
    let renderer = ImageRenderer(content: view)
    renderer.scale = 2
    let image = try XCTUnwrap(renderer.cgImage)
    XCTAssertGreaterThan(image.width, 600)
    // Each side's knob, measured from its own track: the right one overshoots ~5.9 pt further.
    let (a, b) = try knobs(in: image, scale: 2)
    XCTAssertEqual(try XCTUnwrap(b) - XCTUnwrap(a), x(s.b) - x(s.a), accuracy: 1.5, "the drawn knobs differ as the runtime says")
    if let out = ProcessInfo.processInfo.environment["NUDG_RENDER_OUT"] {
      let dest = try XCTUnwrap(CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, "public.png" as CFString, 1, nil))
      CGImageDestinationAddImage(dest, image, nil)
      XCTAssertTrue(CGImageDestinationFinalize(dest))
    }
  }

  #if os(iOS)
  /** In a real window on the device, on real time: the timer pumps, both play, the loop comes round. */
  func testItPlaysLiveInAWindow() throws {
    let comparison = try Comparison.decode(Data(contentsOf: conformance.appendingPathComponent("programs/toggle-bouncier.compare.json")))
    // On: the track turns green, which is what the measurement finds.
    let view = NudgCompare(comparison) { model in
      ZStack(alignment: .leading) {
        Capsule().fill(Color.gray.opacity(0.3)).frame(width: 52, height: 32).nudg(model, "track").nudgPress(model, "track")
        Circle().fill(Color.white).frame(width: 24, height: 24).padding(4).nudg(model, "knob")
      }
    }
    let host = UIHostingController(rootView: view)
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 400))
    window.rootViewController = host
    window.makeKeyAndVisible()
    // Capture now, measure later, so measuring doesn't slow the run it watches.
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(bounds: host.view.bounds, format: format)
    let start = Date()
    var frames: [(t: Double, image: UIImage)] = []
    while Date().timeIntervalSince(start) < 5 {
      RunLoop.main.run(until: Date().addingTimeInterval(0.03))
      host.view.layoutIfNeeded()
      frames.append((Date().timeIntervalSince(start), renderer.image { c in host.view.layer.render(in: c.cgContext) }))
    }
    if let out = ProcessInfo.processInfo.environment["NUDG_RENDER_OUT"], let png = frames[frames.count / 4].image.pngData() { try png.write(to: URL(fileURLWithPath: out)) }
    let samples = try frames.map { f -> (t: Double, a: Double?, b: Double?) in
      let (a, b) = try knobs(in: try XCTUnwrap(f.image.cgImage), scale: 1)
      return (f.t, a, b)
    }
    let on = samples.filter { $0.a != nil && $0.b != nil }
    XCTAssertFalse(on.isEmpty, "the tap played: both tracks turned on")
    // The change overshoots further: its knob goes past where the other one ever goes.
    let maxA = on.compactMap(\.a).max() ?? 0, maxB = on.compactMap(\.b).max() ?? 0
    XCTAssertGreaterThan(maxB - maxA, 2.5, "B overshoots further (A max \(maxA), B max \(maxB))")
    // The loop: after a run (1.5 s to rest + 0.8 s) both start over, off, and turn on again. How
    // long a run lasts is checked on a fixed clock (testItStartsOverOnceBothHaveRested); on a loaded
    // CI machine frames come too unevenly to time it here, so this checks that it comes round.
    let restart = try XCTUnwrap(samples.drop { $0.a == nil }.first { $0.a == nil }, "it started over").t
    XCTAssertTrue(samples.contains { $0.t > restart && $0.a != nil }, "and plays again")
    // Before starting over, both rested at the runtime's 20.
    let rested = try XCTUnwrap(on.last { $0.t < restart })
    XCTAssertEqual(try XCTUnwrap(rested.a), 20, accuracy: 1)
    XCTAssertEqual(try XCTUnwrap(rested.b), 20, accuracy: 1)
  }
  #endif
}
