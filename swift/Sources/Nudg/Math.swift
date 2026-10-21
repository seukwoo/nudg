// The motion math, ported from the reference implementation: closed-form springs,
// cubic Bézier easing, OKLab colors, piecewise-linear maps.

import Foundation

/** Displacement and velocity `t` seconds after start, from displacement `x0` and velocity `v0`. */
func springAt(stiffness k: Double, damping c: Double, mass m: Double, x0: Double, v0: Double, t: Double) -> (Double, Double) {
  let w0 = (k / m).squareRoot()
  let zeta = c / (2 * (k * m).squareRoot())
  if abs(zeta - 1) < 1e-9 {
    let e = exp(-w0 * t)
    let b = v0 + w0 * x0
    return (e * (x0 + b * t), e * (b - w0 * (x0 + b * t)))
  }
  if zeta < 1 {
    let decay = zeta * w0
    let wd = w0 * (1 - zeta * zeta).squareRoot()
    let e = exp(-decay * t)
    let b = (v0 + decay * x0) / wd
    let cs = cos(wd * t), sn = sin(wd * t)
    let x = e * (x0 * cs + b * sn)
    return (x, -decay * x + e * wd * (b * cs - x0 * sn))
  }
  let root = (zeta * zeta - 1).squareRoot()
  let r1 = -w0 * (zeta - root), r2 = -w0 * (zeta + root)
  let c2 = (v0 - r1 * x0) / (r2 - r1)
  let c1 = x0 - c2
  let e1 = exp(r1 * t), e2 = exp(r2 * t)
  return (c1 * e1 + c2 * e2, c1 * r1 * e1 + c2 * r2 * e2)
}

func easeAt(_ ease: Ease, _ u: Double) -> Double {
  guard case let .bezier(x1, y1, x2, y2) = ease else { return u }
  if u <= 0 { return 0 }
  if u >= 1 { return 1 }
  return bezier(y1, y2, solveX(x1, x2, u))
}

func easeSlope(_ ease: Ease, _ u: Double) -> Double {
  guard case let .bezier(x1, y1, x2, y2) = ease else { return 1 }
  let s = solveX(x1, x2, min(1, max(0, u)))
  let dx = bezierSlope(x1, x2, s)
  if abs(dx) > 1e-9 { return bezierSlope(y1, y2, s) / dx }
  let h = 1e-6, a = min(u, 1 - h)
  return (easeAt(ease, a + h) - easeAt(ease, a)) / h
}

private func bezier(_ p1: Double, _ p2: Double, _ s: Double) -> Double {
  let r = 1 - s
  return 3 * r * r * s * p1 + 3 * r * s * s * p2 + s * s * s
}

private func bezierSlope(_ p1: Double, _ p2: Double, _ s: Double) -> Double {
  let r = 1 - s
  return 3 * r * r * p1 + 6 * r * s * (p2 - p1) + 3 * s * s * (1 - p2)
}

private func solveX(_ x1: Double, _ x2: Double, _ u: Double) -> Double {
  var s = u
  for _ in 0..<8 {
    let err = bezier(x1, x2, s) - u
    if abs(err) < 1e-12 { return s }
    let slope = bezierSlope(x1, x2, s)
    if abs(slope) < 1e-9 { break }
    s -= err / slope
  }
  var lo = 0.0, hi = 1.0
  s = u
  for _ in 0..<64 {
    let x = bezier(x1, x2, s)
    if abs(x - u) < 1e-12 { break }
    if x < u { lo = s } else { hi = s }
    s = (lo + hi) / 2
  }
  return s
}

func interpolate(_ from: [Double], _ to: [[Double]], _ x: Double) -> [Double] {
  let order = from.indices.sorted { from[$0] < from[$1] }
  let first = order[0], last = order[order.count - 1]
  if x <= from[first] { return to[first] }
  if x >= from[last] { return to[last] }
  for k in 0..<(order.count - 1) {
    let i = order[k], j = order[k + 1]
    if x <= from[j] {
      let u = (x - from[i]) / (from[j] - from[i])
      return zip(to[i], to[j]).map { $0 + ($1 - $0) * u }
    }
  }
  return to[last]
}

func oklabToHex(_ c: [Double]) -> String {
  let (L, a, b, alpha) = (c[0], c[1], c[2], c.count > 3 ? c[3] : 1)
  let l = pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
  let m = pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
  let s = pow(L - 0.0894841775 * a - 1.291485548 * b, 3)
  let rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map { $0 <= 0.0031308 ? 12.92 * $0 : 1.055 * pow($0, 1 / 2.4) - 0.055 }
  func byte(_ v: Double) -> String { String(format: "%02x", Int((min(1, max(0, v)) * 255).rounded(.toNearestOrAwayFromZero))) }
  let alphaByte = Int((min(1, max(0, alpha)) * 255).rounded(.toNearestOrAwayFromZero))
  return "#" + rgb.map(byte).joined() + (alphaByte == 255 ? "" : byte(alpha))
}
