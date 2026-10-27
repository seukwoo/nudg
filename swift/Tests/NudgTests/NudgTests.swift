// The Swift runtime and SwiftUI adapter, checked where apps run them: on an iOS simulator
// (xcodebuild test) as well as on the Mac (swift test). The conformance suite is the same
// one NudgConformance runs; the render check draws a real SwiftUI view and reads its pixels.

import Foundation
import Nudg
import NudgConformanceSuite
import NudgSwiftUI
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
