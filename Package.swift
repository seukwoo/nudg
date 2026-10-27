// swift-tools-version:5.9
// nudg for Swift and SwiftUI, installable by this repository's URL:
//   .package(url: "https://github.com/seukwoo/nudg", from: "1.2.0")
// The runtime reads programs compiled with `npx @nudg/core compile file.nudg.json`.
// Sources live in swift/; the conformance runner and render check are in swift/Package.swift.
import PackageDescription

let package = Package(
  name: "Nudg",
  platforms: [.macOS(.v14), .iOS(.v17)],
  products: [
    .library(name: "Nudg", targets: ["Nudg"]),
    .library(name: "NudgSwiftUI", targets: ["NudgSwiftUI"]),
  ],
  targets: [
    .target(name: "Nudg", path: "swift/Sources/Nudg"),
    .target(name: "NudgSwiftUI", dependencies: ["Nudg"], path: "swift/Sources/NudgSwiftUI"),
  ]
)
