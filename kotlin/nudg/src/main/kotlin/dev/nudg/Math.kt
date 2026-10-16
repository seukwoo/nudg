package dev.nudg

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** The motion math, ported from the reference implementation. */
internal fun springAt(k: Double, c: Double, m: Double, x0: Double, v0: Double, t: Double): Pair<Double, Double> {
    val w0 = sqrt(k / m)
    val zeta = c / (2 * sqrt(k * m))
    if (abs(zeta - 1) < 1e-9) {
        val e = exp(-w0 * t)
        val b = v0 + w0 * x0
        return e * (x0 + b * t) to e * (b - w0 * (x0 + b * t))
    }
    if (zeta < 1) {
        val decay = zeta * w0
        val wd = w0 * sqrt(1 - zeta * zeta)
        val e = exp(-decay * t)
        val b = (v0 + decay * x0) / wd
        val cs = cos(wd * t)
        val sn = sin(wd * t)
        val x = e * (x0 * cs + b * sn)
        return x to -decay * x + e * wd * (b * cs - x0 * sn)
    }
    val root = sqrt(zeta * zeta - 1)
    val r1 = -w0 * (zeta - root)
    val r2 = -w0 * (zeta + root)
    val c2 = (v0 - r1 * x0) / (r2 - r1)
    val c1 = x0 - c2
    val e1 = exp(r1 * t)
    val e2 = exp(r2 * t)
    return c1 * e1 + c2 * e2 to c1 * r1 * e1 + c2 * r2 * e2
}

internal fun easeAt(ease: Ease, u: Double): Double {
    if (ease !is Ease.Bezier) return u
    if (u <= 0) return 0.0
    if (u >= 1) return 1.0
    return bezier(ease.y1, ease.y2, solveX(ease.x1, ease.x2, u))
}

internal fun easeSlope(ease: Ease, u: Double): Double {
    if (ease !is Ease.Bezier) return 1.0
    val s = solveX(ease.x1, ease.x2, min(1.0, max(0.0, u)))
    val dx = bezierSlope(ease.x1, ease.x2, s)
    if (abs(dx) > 1e-9) return bezierSlope(ease.y1, ease.y2, s) / dx
    val h = 1e-6
    val a = min(u, 1 - h)
    return (easeAt(ease, a + h) - easeAt(ease, a)) / h
}

private fun bezier(p1: Double, p2: Double, s: Double): Double {
    val r = 1 - s
    return 3 * r * r * s * p1 + 3 * r * s * s * p2 + s * s * s
}

private fun bezierSlope(p1: Double, p2: Double, s: Double): Double {
    val r = 1 - s
    return 3 * r * r * p1 + 6 * r * s * (p2 - p1) + 3 * s * s * (1 - p2)
}

private fun solveX(x1: Double, x2: Double, u: Double): Double {
    var s = u
    for (i in 0 until 8) {
        val err = bezier(x1, x2, s) - u
        if (abs(err) < 1e-12) return s
        val slope = bezierSlope(x1, x2, s)
        if (abs(slope) < 1e-9) break
        s -= err / slope
    }
    var lo = 0.0
    var hi = 1.0
    s = u
    for (i in 0 until 64) {
        val x = bezier(x1, x2, s)
        if (abs(x - u) < 1e-12) break
        if (x < u) lo = s else hi = s
        s = (lo + hi) / 2
    }
    return s
}

internal fun interpolate(map: PropertyMap, x: Double): List<Double> {
    val from = map.from
    val to = map.to
    val order = if (from.last() > from.first()) from.indices.toList() else from.indices.reversed().toList()
    val first = order.first()
    val last = order.last()
    if (x <= from[first]) return to[first]
    if (x >= from[last]) return to[last]
    for (k in 0 until order.size - 1) {
        val i = order[k]
        val j = order[k + 1]
        if (x <= from[j]) {
            val u = (x - from[i]) / (from[j] - from[i])
            return to[i].zip(to[j]) { a, b -> a + (b - a) * u }
        }
    }
    return to[last]
}

internal fun oklabToHex(c: List<Double>): String {
    val (L, a, b) = Triple(c[0], c[1], c[2])
    val alpha = if (c.size > 3) c[3] else 1.0
    val l = (L + 0.3963377774 * a + 0.2158037573 * b).pow(3)
    val m = (L - 0.1055613458 * a - 0.0638541728 * b).pow(3)
    val s = (L - 0.0894841775 * a - 1.291485548 * b).pow(3)
    val rgb = listOf(
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ).map { if (it <= 0.0031308) 12.92 * it else 1.055 * it.pow(1 / 2.4) - 0.055 }
    fun byte(v: Double) = (min(1.0, max(0.0, v)) * 255 + 0.5).let { kotlin.math.floor(it).toLong() }
    val alphaByte = byte(alpha)
    return "#" + rgb.joinToString("") { "%02x".format(byte(it)) } + if (alphaByte == 255L) "" else "%02x".format(alphaByte)
}

