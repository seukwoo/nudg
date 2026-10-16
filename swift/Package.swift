// swift-tools-version:5.9
// nudg's runtime in Swift. It reads programs compiled by the reference tools
// (`nudg compile x.nudg.json`), and passes the same conformance suite as the
// TypeScript runtime: `swift run NudgConformance`.
import PackageDescription

let package = Package(
  name: "Nudg",
  platforms: [.macOS(.v14), .iOS(.v17)],
  products: [
    .library(name: "Nudg", targets: ["Nudg"]),
    .library(name: "NudgSwiftUI", targets: ["NudgSwiftUI"]),
  ],
  targets: [
    .target(name: "Nudg"),
    .target(name: "NudgSwiftUI", dependencies: ["Nudg"]),
    .executableTarget(name: "NudgConformance", dependencies: ["Nudg"]),
    .executableTarget(name: "NudgSwiftUICheck", dependencies: ["Nudg", "NudgSwiftUI"]),
  ]
)
