// Renders a nudg toggle with SwiftUI's ImageRenderer at chosen moments, without a
// window or a simulator, and checks the knob is where the runtime says. Usage:
// swift run NudgSwiftUICheck path/to/toggle.program.json [out-dir]

#if os(macOS)
import AppKit
import Foundation
import Nudg
import NudgSwiftUI
import SwiftUI

@MainActor
func main() throws {
  let args = CommandLine.arguments
  let program = try Program.decode(Data(contentsOf: URL(fileURLWithPath: args[1])))
  let out = URL(fileURLWithPath: args.count > 2 ? args[2] : ".")
  var now = Date(timeIntervalSince1970: 0)
  let model = NudgModel(program, reducedMotion: false, clock: { now })

  struct Toggle: View {
    @ObservedObject var model: NudgModel
    var body: some View {
      ZStack(alignment: .leading) {
        Capsule().fill(Color.clear).frame(width: 52, height: 32).nudg(model, "track")
        Circle().fill(Color.white).frame(width: 24, height: 24).padding(4).nudg(model, "knob")
      }
      .clipShape(Capsule())
      .padding(8)
      .background(Color(white: 0.98))
    }
  }

  var failures = 0
  func snapshot(_ label: String, at seconds: Double, expectX: Double) throws {
    now = Date(timeIntervalSince1970: seconds)
    let x = model.values(at: now)["knob.x"]?.number ?? .nan
    let renderer = ImageRenderer(content: Toggle(model: model))
    renderer.scale = 2
    guard let image = renderer.nsImage, let tiff = image.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { throw NSError(domain: "render", code: 1) }
    try png.write(to: out.appendingPathComponent("swiftui-\(label).png"))
    let ok = abs(x - expectX) < 0.5
    if !ok { failures += 1 }
    print("\(ok ? "ok  " : "FAIL") \(label): knob.x = \(String(format: "%.2f", x)) (expected about \(expectX)), \(Int(image.size.width))x\(Int(image.size.height)) pt")
  }

  try snapshot("0-off", at: 0, expectX: 0)
  now = Date(timeIntervalSince1970: 0.1)
  model.send("track.tap")
  try snapshot("1-moving", at: 0.25, expectX: model.values(at: Date(timeIntervalSince1970: 0.25))["knob.x"]!.number!)
  try snapshot("2-on", at: 2, expectX: 20)
  print(model.state == ["on"] ? "ok   state is on" : "FAIL state \(model.state)")
  if model.state != ["on"] { failures += 1 }
  exit(failures == 0 ? 0 : 1)
}

MainActor.assumeIsolated { try! main() }
#else
print("NudgSwiftUICheck renders with SwiftUI on macOS only.")
#endif
