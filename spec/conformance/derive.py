#!/usr/bin/env python3
"""Generates the conformance cases in this directory.

Expected values are computed independently of any nudg runtime: springs are
integrated numerically (RK4 with a tiny step) instead of using the closed form the
spec prescribes, so a runtime that passes agrees with physics, not with itself.

Run: python3 spec/conformance/derive.py
"""

import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DT = 1e-5

# --- motion math ------------------------------------------------------------


def spring(duration=None, bounce=0.0, stiffness=None, damping=None, mass=1.0):
    if duration is not None:
        k = (2 * math.pi / duration) ** 2
        return ("spring", k, 2 * (1 - bounce) * math.sqrt(k), 1.0)
    return ("spring", stiffness, damping, mass)


EASES = {
    "linear": None,
    "in-out": (0.42, 0, 0.58, 1),
    "out": (0, 0, 0.58, 1),
}


def bezier(p1, p2, s):
    return 3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s * s * p2 + s ** 3


def ease_at(ease, u):
    if ease is None:
        return u
    x1, y1, x2, y2 = ease
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if bezier(x1, x2, mid) < u:
            lo = mid
        else:
            hi = mid
    return bezier(y1, y2, (lo + hi) / 2)


def tween(duration, ease="in-out"):
    return ("tween", duration, EASES[ease] if isinstance(ease, str) else tuple(ease))


# --- colors -----------------------------------------------------------------


def to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def from_linear(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_to_oklab(h):
    r, g, b = (to_linear(int(h[i:i + 2], 16) / 255) for i in (1, 3, 5))
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
        1.0,
    ]


def oklab_to_hex(c):
    L, a, b, _ = c
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    rgb = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ]
    return "#" + "".join("%02x" % round(min(1, max(0, from_linear(v))) * 255) for v in rgb)


# --- a property moving over time -------------------------------------------


class Prop:
    def __init__(self, value):
        self.color = isinstance(value, str)
        self.pos = hex_to_oklab(value) if self.color else [float(value)]
        self.vel = [0.0] * len(self.pos)
        self.target = list(self.pos)
        self.motion = None
        self.t = 0.0
        self.tween_from = None
        self.tween_t0 = 0.0

    def advance(self, t):
        motion = self.motion
        if motion is None:
            self.pos = list(self.target)
        elif motion[0] == "tween":
            _, duration, ease = motion
            u = 1.0 if duration == 0 else min(1.0, (t - self.tween_t0) / duration)
            p = ease_at(ease, u)
            self.pos = [f + (to - f) * p for f, to in zip(self.tween_from, self.target)]
        else:
            _, k, c, m = motion
            steps = int(round((t - self.t) / DT))
            h = (t - self.t) / steps if steps else 0
            for i in range(len(self.pos)):
                x, v, target = self.pos[i], self.vel[i], self.target[i]
                acc = lambda x, v: (-k * (x - target) - c * v) / m
                for _ in range(steps):
                    k1x, k1v = v, acc(x, v)
                    k2x, k2v = v + h / 2 * k1v, acc(x + h / 2 * k1x, v + h / 2 * k1v)
                    k3x, k3v = v + h / 2 * k2v, acc(x + h / 2 * k2x, v + h / 2 * k2v)
                    k4x, k4v = v + h * k3v, acc(x + h * k3x, v + h * k3v)
                    x += h / 6 * (k1x + 2 * k2x + 2 * k3x + k4x)
                    v += h / 6 * (k1v + 2 * k2v + 2 * k3v + k4v)
                self.pos[i], self.vel[i] = x, v
        self.t = t

    def retarget(self, value, motion, t):
        self.advance(t)
        self.target = hex_to_oklab(value) if self.color else [float(value)]
        self.motion = motion
        if motion is not None and motion[0] == "tween":
            self.tween_from, self.tween_t0 = list(self.pos), t
            self.vel = [0.0] * len(self.pos)

    def handoff(self, pos, vel, value, motion, t):
        """Leaves a follow: start from an exact position and velocity."""
        self.t = t
        self.pos, self.vel = [float(pos)], [float(vel)]
        self.target = [float(value)]
        self.motion = motion

    def kick(self, dv, motion, t):
        self.advance(t)
        self.vel[0] += dv
        self.motion = motion

    def value(self, t):
        self.advance(t)
        return oklab_to_hex(self.pos) if self.color else round(self.pos[0], 9)


# --- case helpers -----------------------------------------------------------


def write(name, case):
    with open(os.path.join(HERE, name + ".json"), "w") as f:
        json.dump(case, f, indent=2)
        f.write("\n")


def spring_json(duration, bounce):
    return {"spring": {"duration": duration, "bounce": bounce}}


TOGGLE = {
    "nudg": "0.1",
    "targets": ["knob", "track"],
    "values": {"knob.x": 0, "track.color": "#D1D5DB"},
    "animate": {
        "knob.x": spring_json(0.35, 0.25),
        "track.color": {"tween": {"duration": 0.2, "ease": "out"}},
    },
    "initial": "off",
    "states": {
        "off": {"when": {"track.tap": "on"}},
        "on": {"set": {"knob.x": 20, "track.color": "#4ADE80"}, "when": {"track.tap": "off"}},
    },
}


def toggle_cases():
    knob, track = Prop(0), Prop("#D1D5DB")
    s, tw = spring(0.35, 0.25), tween(0.2, "out")
    steps = [{"t": 0, "expect": {"state": ["off"], "values": {"knob.x": 0, "track.color": "#d1d5db"}}}]
    steps.append({"t": 0.1, "send": "track.tap"})
    knob.retarget(20, s, 0.1)
    track.retarget("#4ADE80", tw, 0.1)
    for t in (0.1, 0.15, 0.2, 0.3, 0.45, 0.7):
        steps.append({"t": t, "expect": {"state": ["on"], "values": {"knob.x": knob.value(t), "track.color": track.value(t)}}})
    write("toggle-tap", {
        "conformance": "0.1",
        "name": "Toggle: a tap springs the knob to on and tweens the color",
        "doc": TOGGLE,
        "steps": steps,
    })

    # A second tap mid-flight: the spring retargets from where it is and keeps its velocity.
    knob, track = Prop(0), Prop("#D1D5DB")
    steps = [{"t": 0.1, "send": "track.tap"}]
    knob.retarget(20, s, 0.1)
    track.retarget("#4ADE80", tw, 0.1)
    steps.append({"t": 0.18, "expect": {"values": {"knob.x": knob.value(0.18), "track.color": track.value(0.18)}}})
    steps.append({"t": 0.18, "send": "track.tap"})
    knob.retarget(0, s, 0.18)
    track.retarget("#D1D5DB", tw, 0.18)
    for t in (0.2, 0.25, 0.3, 0.4, 0.6):
        steps.append({"t": t, "expect": {"state": ["off"], "values": {"knob.x": knob.value(t), "track.color": track.value(t)}}})
    write("toggle-interrupt", {
        "conformance": "0.1",
        "name": "Toggle: a tap mid-flight retargets, keeping the spring's velocity; the tween restarts from the current color",
        "doc": TOGGLE,
        "steps": steps,
    })


def spring_form_cases():
    duration, bounce = 0.4, 0.3
    k = (2 * math.pi / duration) ** 2
    ratio = 1 - bounce
    doc = {
        "nudg": "0.1",
        "targets": ["a", "b", "c", "d", "e"],
        "values": {f"{t}.x": 0 for t in "abcde"},
        "animate": {
            "a.x": {"spring": {"duration": duration, "bounce": bounce}},
            "b.x": {"spring": {"response": "400ms", "dampingFraction": ratio}},
            "c.x": {"spring": {"stiffness": k, "dampingRatio": ratio}},
            "d.x": {"spring": {"stiffness": k, "damping": 2 * ratio * math.sqrt(k)}},
            "e.x": {"spring": {"stiffness": 2 * k, "damping": 2 * ratio * math.sqrt(2 * k * 2), "mass": 2}},
        },
        "initial": "rest",
        "states": {
            "rest": {"when": {"a.tap": "moved"}},
            "moved": {"set": {f"{t}.x": 100 for t in "abcde"}},
        },
    }
    p = Prop(0)
    p.retarget(100, spring(duration, bounce), 0)
    steps = [{"t": 0, "send": "a.tap"}]
    for t in (0.05, 0.1, 0.2, 0.3, 0.5, 0.8):
        v = p.value(t)
        steps.append({"t": t, "expect": {"values": {f"{x}.x": v for x in "abcde"}}})
    write("spring-forms", {
        "conformance": "0.1",
        "name": "Spring: every parameter form describes the same physical spring",
        "doc": doc,
        "steps": steps,
    })

    # Critically damped (bounce 0) and overdamped (negative bounce).
    doc = {
        "nudg": "0.1",
        "targets": ["crit", "over"],
        "values": {"crit.x": 0, "over.x": 0},
        "animate": {"crit.x": spring_json(0.3, 0), "over.x": spring_json(0.3, -0.5)},
        "initial": "rest",
        "states": {"rest": {"when": {"crit.tap": "moved"}}, "moved": {"set": {"crit.x": 50, "over.x": 50}}},
    }
    crit, over = Prop(0), Prop(0)
    crit.retarget(50, spring(0.3, 0), 0)
    over.retarget(50, spring(0.3, -0.5), 0)
    steps = [{"t": 0, "send": "crit.tap"}]
    for t in (0.02, 0.05, 0.1, 0.2, 0.4):
        steps.append({"t": t, "expect": {"values": {"crit.x": crit.value(t), "over.x": over.value(t)}}})
    write("spring-damping", {
        "conformance": "0.1",
        "name": "Spring: critically damped and overdamped springs never overshoot",
        "doc": doc,
        "steps": steps,
    })


def kick_cases():
    library = {
        "nudg": "0.1",
        "motions": {
            "snappy": spring_json(0.3, 0.15),
            "pop": {"kick": 6, "spring": {"duration": 0.4, "bounce": 0.5}},
        },
    }
    doc = {
        "nudg": "0.1",
        "import": ["./motion/brand.nudg.json"],
        "targets": ["heart"],
        "values": {"heart.scale": 1, "heart.y": 0},
        "animate": {"heart.scale": "snappy", "heart.y": "snappy"},
        "initial": "idle",
        "states": {
            "idle": {"when": {"heart.tap": "liked"}},
            "liked": {"set": {"heart.y": -4}, "enter": {"heart.scale": "pop"}, "when": {"heart.tap": "idle"}},
        },
    }
    scale, y = Prop(1), Prop(0)
    steps = [{"t": 0, "expect": {"state": ["idle"], "values": {"heart.scale": 1, "heart.y": 0}}}]
    steps.append({"t": 0.1, "send": "heart.tap"})
    y.retarget(-4, spring(0.3, 0.15), 0.1)
    scale.kick(6, spring(0.4, 0.5), 0.1)
    for t in (0.12, 0.15, 0.2, 0.3, 0.5, 0.9):
        steps.append({"t": t, "expect": {"state": ["liked"], "values": {"heart.scale": scale.value(t), "heart.y": y.value(t)}}})
    steps.append({"t": 1.0, "send": "heart.tap"})
    # heart.scale's target is unchanged, so its kick keeps playing.
    y.retarget(0, spring(0.3, 0.15), 1.0)
    for t in (1.05, 1.2):
        steps.append({"t": t, "expect": {"state": ["idle"], "values": {"heart.scale": scale.value(t), "heart.y": y.value(t)}}})
    write("kick-pop", {
        "conformance": "0.1",
        "name": "Kick: entering a state adds velocity without changing the target; imported named motions",
        "doc": doc,
        "files": {"motion/brand.nudg.json": library},
        "steps": steps,
    })


# --- v0.8: entry keyframes --------------------------------------------------

def keyframes_at(start, target, frames, duration, t0, t):
    """Linear entry keyframes: current value at 0, state target at 1."""
    u = (t - t0) / duration
    if u >= 1:
        return float(target), 0.0
    points = [(0.0, float(start))] + [(float(at), float(value)) for at, value in frames] + [(1.0, float(target))]
    for (a0, v0), (a1, v1) in zip(points, points[1:]):
        if u <= a1:
            p = (u - a0) / (a1 - a0)
            return v0 + (v1 - v0) * p, (v1 - v0) / ((a1 - a0) * duration)
    return float(target), 0.0


def keyframe_cases():
    frames = [(0.2, -10), (0.45, 8), (0.7, -5)]
    doc = {
        "nudg": "0.8",
        "targets": ["field"],
        "values": {"field.x": 0},
        "animate": {"field.x": spring_json(0.3, 0)},
        "initial": "idle",
        "when": {"host.invalid": "invalid", "host.valid": "idle"},
        "states": {
            "idle": {},
            "invalid": {
                "enter": {
                    "field.x": {
                        "keyframes": [{"at": at, "value": value} for at, value in frames],
                        "duration": 0.4,
                        "ease": "linear",
                    }
                },
                "when": {"host.invalid": "invalid"},
            },
        },
    }

    steps = [{"t": 0.1, "send": "host.invalid"}]
    for t in (0.12, 0.17, 0.24):
        value, _ = keyframes_at(0, 0, frames, 0.4, 0.1, t)
        steps.append({"t": t, "expect": {"state": ["invalid"], "values": {"field.x": round(value, 9)}}})

    # Re-enter while the first sequence is running: position is continuous and the
    # authored sequence restarts from that exact current value.
    restart = 0.25
    start, _ = keyframes_at(0, 0, frames, 0.4, 0.1, restart)
    steps.append({"t": restart, "send": "host.invalid"})
    for t in (0.27, 0.34):
        value, _ = keyframes_at(start, 0, frames, 0.4, restart, t)
        steps.append({"t": t, "expect": {"state": ["invalid"], "values": {"field.x": round(value, 9)}}})

    # Leaving hands the keyframe's current velocity to the ordinary spring.
    leave = 0.38
    pos, vel = keyframes_at(start, 0, frames, 0.4, restart, leave)
    steps.append({"t": leave, "send": "host.valid"})
    x = Prop(0)
    x.handoff(pos, vel, 0, spring(0.3, 0), leave)
    for t in (0.4, 0.5, 0.8):
        steps.append({"t": t, "expect": {"state": ["idle"], "values": {"field.x": x.value(t)}}})

    write("keyframes-enter", {
        "conformance": "0.8",
        "name": "Keyframes: entry starts from the current value, re-entry restarts, interruption hands velocity to the next spring",
        "doc": doc,
        "steps": steps,
    })

    write("keyframes-reduced", {
        "conformance": "0.8",
        "name": "Keyframes: reduced motion skips transient entry frames and keeps the state target",
        "doc": doc,
        "reducedMotion": True,
        "steps": [
            {"t": 0.1, "send": "host.invalid"},
            {"t": 0.2, "expect": {"state": ["invalid"], "values": {"field.x": 0}}},
            {"t": 0.6, "expect": {"state": ["invalid"], "values": {"field.x": 0}}},
        ],
    })


def validation_v08_cases():
    def doc():
        return {
            "nudg": "0.8",
            "targets": ["field"],
            "values": {"field.x": 0},
            "initial": "idle",
            "states": {
                "idle": {"when": {"host.invalid": "invalid"}},
                "invalid": {"enter": {"field.x": {"keyframes": [{"at": 0.5, "value": 8}], "duration": 0.3}}},
            },
        }

    out = []
    d = doc(); d["nudg"] = "0.7"
    out.append(("needs-version", d, [("needs-version", "/states/invalid/enter/field.x/keyframes")]))
    d = doc(); d["states"]["invalid"]["enter"]["field.x"]["keyframes"] = []
    out.append(("empty", d, [("invalid-keyframes", "/states/invalid/enter/field.x/keyframes")]))
    d = doc(); d["states"]["invalid"]["enter"]["field.x"]["keyframes"][0]["at"] = 1
    out.append(("endpoint", d, [("invalid-keyframe-time", "/states/invalid/enter/field.x/keyframes/0/at")]))
    d = doc(); d["states"]["invalid"]["enter"]["field.x"]["keyframes"] = [{"at": 0.7, "value": 8}, {"at": 0.4, "value": -4}]
    out.append(("unordered", d, [("invalid-keyframe-time", "/states/invalid/enter/field.x/keyframes/1/at")]))
    d = doc(); del d["states"]["invalid"]["enter"]["field.x"]["keyframes"][0]["value"]
    out.append(("missing-value", d, [("invalid-keyframes", "/states/invalid/enter/field.x/keyframes/0/value")]))
    d = doc(); d["states"]["invalid"]["enter"]["field.x"]["keyframes"][0]["value"] = "far"
    out.append(("bad-value", d, [("invalid-value", "/states/invalid/enter/field.x/keyframes/0/value")]))
    d = doc(); d["states"]["invalid"]["enter"]["field.x"]["duration"] = 0
    out.append(("duration", d, [("invalid-value", "/states/invalid/enter/field.x/duration")]))
    d = doc(); d["states"]["invalid"]["enter"]["field.x"]["kick"] = 20; d["states"]["invalid"]["enter"]["field.x"]["spring"] = {"duration": 0.3}
    out.append(("mixed-effect", d, [("enter-effect-conflict", "/states/invalid/enter/field.x")]))
    write("validation-0.8", {
        "conformance": "0.8",
        "name": "Validator (0.8): entry keyframes",
        "documents": [{"name": n, "doc": dd, "errors": [{"code": c, "path": pp} for c, pp in e]} for n, dd, e in out],
    })


# --- v0.9: measured follow/map endpoints -----------------------------------

MEASURED_ENDPOINTS = {
    "nudg": "0.9",
    "targets": ["row", "content", "action"],
    "values": {
        "content.x": 0,
        "action.opacity": {
            "map": "content.x",
            "from": [0, {"measure": "action.width", "times": -1}],
            "to": [0, 1],
        },
    },
    "initial": "closed",
    "states": {
        "closed": {"when": {"content.dragstart": "dragging"}},
        "dragging": {
            "follow": {
                "content.x": {
                    "input": "content.drag.x",
                    "range": [{"measure": "action.width", "times": -1}, 0],
                    "overdrag": 0.25,
                }
            },
            "when": {"content.dragend": "closed"},
        },
    },
}


def measured_endpoint_cases():
    steps = [
        {"t": 0, "expect": {"state": ["closed"], "values": {"content.x": 0, "action.opacity": 0}}},
        {"t": 0.1, "send": "content.dragstart"},
        {"t": 0.1, "input": "content.drag.x", "value": -120},
        # Before layout arrives, the follow is unconstrained and the map holds its base.
        {"t": 0.1, "expect": {"state": ["dragging"], "values": {"content.x": -120, "action.opacity": 0}}},
        # The first report activates both measured endpoints immediately.
        {"t": 0.2, "input": "action.layout.width", "value": 80},
        {"t": 0.2, "expect": {"values": {"content.x": -90, "action.opacity": 1}}},
        {"t": 0.3, "input": "content.drag.x", "value": -40},
        {"t": 0.3, "expect": {"values": {"content.x": -40, "action.opacity": 0.5}}},
        # Relayout changes the range and map domain without restarting the follow.
        {"t": 0.4, "input": "action.layout.width", "value": 100},
        {"t": 0.4, "expect": {"values": {"content.x": -40, "action.opacity": 0.4}}},
        {"t": 0.5, "input": "content.drag.x", "value": -140},
        {"t": 0.5, "expect": {"values": {"content.x": -110, "action.opacity": 1}}},
    ]
    write("measured-endpoints", {
        "conformance": "0.9",
        "name": "Measured endpoints: follow.range and map.from activate on first layout and track relayout",
        "doc": MEASURED_ENDPOINTS,
        "steps": steps,
    })


def validation_v09_cases():
    def doc():
        return json.loads(json.dumps(MEASURED_ENDPOINTS))

    out = []
    d = doc(); d["nudg"] = "0.8"
    out.append(("needs-version", d, [
        ("needs-version", "/values/action.opacity/from/1"),
        ("needs-version", "/states/dragging/follow/content.x/range/0"),
    ]))
    d = doc(); d["values"]["action.opacity"]["from"][1] = "wide"
    out.append(("invalid-map-endpoint", d, [("invalid-map", "/values/action.opacity/from/1")]))
    d = doc(); d["states"]["dragging"]["follow"]["content.x"]["range"][0] = {"measure": "action.y"}
    out.append(("follow-axis-mismatch", d, [("invalid-measure", "/states/dragging/follow/content.x/range/0/measure")]))
    d = doc(); d["values"]["action.opacity"]["from"][1] = {"measure": "missing.width"}
    out.append(("unknown-target", d, [("unknown-target", "/values/action.opacity/from/1/measure")]))
    d = doc(); d["values"]["action.opacity"]["map"] = "host.progress"; d["values"]["action.opacity"]["from"][1] = {"measure": "action.x"}
    out.append(("input-position", d, [("invalid-measure", "/values/action.opacity/from/1/measure")]))
    write("validation-0.9", {
        "conformance": "0.9",
        "name": "Validator (0.9): measured follow and map endpoints",
        "documents": [{"name": n, "doc": dd, "errors": [{"code": c, "path": pp} for c, pp in e]} for n, dd, e in out],
    })


def machine_cases():
    doc = {
        "nudg": "0.1",
        "targets": ["knob", "track"],
        "values": {"knob.x": 0, "knob.scale": 1},
        "animate": {"knob.scale": spring_json(0.2, 0)},
        "regions": {
            "checked": {
                "initial": "off",
                "states": {
                    "off": {"when": {"track.tap": "on"}},
                    "on": {
                        "set": {"knob.x": 20},
                        "when": {"track.tap": {"to": "off", "animate": {"knob.x": spring_json(0.3, 0)}}},
                    },
                },
            },
            "press": {
                "initial": "up",
                "states": {
                    "up": {"when": {"track.down": "down"}},
                    "down": {"set": {"knob.scale": 0.9}, "when": {"track.up": "up", "track.cancel": "up"}},
                },
            },
        },
    }
    x, scale = Prop(0), Prop(1)
    steps = [{"t": 0, "expect": {"state": ["checked/off", "press/up"]}}]
    steps.append({"t": 0.0, "send": "track.down"})
    scale.retarget(0.9, spring(0.2, 0), 0.0)
    steps.append({"t": 0.05, "expect": {"state": ["checked/off", "press/down"], "values": {"knob.scale": scale.value(0.05), "knob.x": 0}}})
    steps.append({"t": 0.08, "send": "track.up"})
    scale.retarget(1, spring(0.2, 0), 0.08)
    steps.append({"t": 0.08, "send": "track.tap"})
    x.retarget(20, None, 0.08)  # knob.x has no animate entry: it jumps
    steps.append({"t": 0.1, "expect": {"state": ["checked/on", "press/up"], "values": {"knob.scale": scale.value(0.1), "knob.x": 20}}})
    steps.append({"t": 0.2, "send": "track.tap"})
    x.retarget(0, spring(0.3, 0), 0.2)
    for t in (0.25, 0.35):
        steps.append({"t": t, "expect": {"state": ["checked/off", "press/up"], "values": {"knob.scale": scale.value(t), "knob.x": x.value(t)}}})
    steps.append({"t": 0.4, "send": "track.cancel", "handled": False})
    write("parallel-regions", {
        "conformance": "0.1",
        "name": "Machine: parallel regions, instant properties, per-transition animate, unhandled events",
        "doc": doc,
        "steps": steps,
    })

    doc = {
        "nudg": "0.1",
        "targets": ["panel"],
        "values": {"panel.opacity": 0, "panel.y": 0},
        "initial": "closed",
        "states": {
            "closed": {"when": {"panel.tap": "open"}},
            "open": {
                "set": {"panel.opacity": 1, "panel.y": 10},
                "enter": {"panel.y": {"kick": 50, "spring": {"duration": 0.3, "bounce": 0.3}}},
                "when": {"panel.tap": "closed"},
                "initial": "idle",
                "states": {
                    "idle": {"when": {"panel.down": "pressed"}},
                    "pressed": {"set": {"panel.y": 12}, "when": {"panel.up": "idle"}},
                },
            },
        },
    }
    y = Prop(0)
    steps = [
        {"t": 0, "expect": {"state": ["closed"], "values": {"panel.opacity": 0, "panel.y": 0}}},
        {"t": 0.1, "send": "panel.tap"},
    ]
    y.retarget(10, None, 0.1)
    y.kick(50, spring(0.3, 0.3), 0.1)
    steps.append({"t": 0.15, "expect": {"state": ["open/idle"], "values": {"panel.opacity": 1, "panel.y": y.value(0.15)}}})
    steps.append({"t": 0.2, "send": "panel.down"})
    steps.append({"t": 0.2, "expect": {"state": ["open/pressed"], "values": {"panel.y": 12}}})
    steps.append({"t": 0.3, "send": "panel.tap"})
    steps.append({"t": 0.3, "expect": {"state": ["closed"], "values": {"panel.opacity": 0, "panel.y": 0}}})
    write("nested-states", {
        "conformance": "0.1",
        "name": "Machine: nested states override their parent; a kick on an instant property; leaving exits children",
        "doc": doc,
        "steps": steps,
    })


def tween_cases():
    doc = {
        "nudg": "0.1",
        "targets": ["a", "b"],
        "values": {"a.opacity": 0, "b.x": 0},
        "animate": {
            "a.opacity": {"tween": {"duration": "200ms", "ease": "linear"}},
            "b.x": {"tween": {"duration": 0.4, "ease": [0.2, 0.8, 0.4, 1.2]}},
        },
        "initial": "hidden",
        "states": {
            "hidden": {"when": {"a.tap": "shown"}},
            "shown": {"set": {"a.opacity": 1, "b.x": 100}, "when": {"a.tap": "hidden"}},
        },
    }
    a, b = Prop(0), Prop(0)
    steps = [{"t": 0, "send": "a.tap"}]
    a.retarget(1, tween(0.2, "linear"), 0)
    b.retarget(100, tween(0.4, [0.2, 0.8, 0.4, 1.2]), 0)
    for t in (0.05, 0.1, 0.2, 0.3):
        steps.append({"t": t, "expect": {"values": {"a.opacity": a.value(t), "b.x": b.value(t)}}})
    steps.append({"t": 0.3, "send": "a.tap"})
    a.retarget(0, tween(0.2, "linear"), 0.3)
    b.retarget(0, tween(0.4, [0.2, 0.8, 0.4, 1.2]), 0.3)
    for t in (0.35, 0.5, 0.8):
        steps.append({"t": t, "expect": {"values": {"a.opacity": a.value(t), "b.x": b.value(t)}}})
    write("tween", {
        "conformance": "0.1",
        "name": "Tween: linear and cubic Bézier (with overshoot); a retarget restarts from the current value",
        "doc": doc,
        "steps": steps,
    })


def validation_cases():
    cases = [
        ("unknown-key", {"states": {"off": {"sett": {}}}}, [("unknown-key", "/states/off/sett")]),
        ("unknown-property", {"values": {"knob.translateX": 0}}, [("unknown-property", "/values/knob.translateX")]),
        ("unknown-event", {"states": {"off": {"when": {"track.click": "off"}}}}, [("unknown-event", "/states/off/when/track.click")]),
        ("unknown-state", {"states": {"off": {"when": {"track.tap": "onn"}}}}, [("unknown-state", "/states/off/when/track.tap")]),
        ("missing-base-value", {"states": {"off": {"set": {"knob.y": 3}}}}, [("missing-base-value", "/states/off/set/knob.y")]),
        ("spring-mixed-forms", {"animate": {"knob.x": {"spring": {"duration": 0.3, "dampingRatio": 0.5}}}}, [("spring-mixed-forms", "/animate/knob.x/spring")]),
        ("kick-outside-enter", {"animate": {"knob.x": {"kick": 5, "spring": {"duration": 0.3}}}}, [("kick-outside-enter", "/animate/knob.x")]),
        ("enter-without-kick", {"states": {"off": {"enter": {"knob.x": {"spring": {"duration": 0.3}}}}}}, [("enter-without-kick", "/states/off/enter/knob.x")]),
        ("unknown-motion", {"animate": {"knob.x": "snapy"}}, [("unknown-motion", "/animate/knob.x")]),
        ("unsupported-version", {"nudg": 0.1}, [("unsupported-version", "/nudg")]),
    ]
    base = {
        "nudg": "0.1",
        "targets": ["knob", "track"],
        "values": {"knob.x": 0},
        "initial": "off",
        "states": {"off": {"when": {"track.tap": "off"}}},
    }
    out = []
    for name, patch, expected in cases:
        doc = json.loads(json.dumps(base))
        for key, value in patch.items():
            if isinstance(value, dict) and isinstance(doc.get(key), dict) and key != "states":
                doc[key].update(value)
            elif key == "states":
                for state, body in value.items():
                    doc["states"][state].update(body)
            else:
                doc[key] = value
        out.append({"name": name, "doc": doc, "errors": [{"code": c, "path": p} for c, p in expected]})

    region_doc = {
        "nudg": "0.1",
        "targets": ["knob"],
        "values": {"knob.x": 0},
        "regions": {
            "a": {"initial": "s", "states": {"s": {"set": {"knob.x": 1}}}},
            "b": {"initial": "s", "states": {"s": {"set": {"knob.x": 2}}}},
        },
    }
    out.append({"name": "region-conflict", "doc": region_doc, "errors": [{"code": "region-conflict", "path": "/regions/b"}]})
    write("validation", {
        "conformance": "0.1",
        "name": "Validator: each document produces exactly these errors (code and JSON pointer)",
        "documents": out,
    })


# --- v0.2: drag, follow, nearest, map ----------------------------------------

WINDOW = 0.1


def ls_velocity(samples, t):
    """Least-squares slope of (time, value) samples in [t - 0.1, t]; 0 with fewer than two."""
    pts = [(ti, vi) for ti, vi in samples if t - WINDOW - 1e-9 <= ti <= t + 1e-9]
    if len(pts) < 2:
        return 0.0
    mt = sum(p[0] for p in pts) / len(pts)
    mv = sum(p[1] for p in pts) / len(pts)
    den = sum((p[0] - mt) ** 2 for p in pts)
    return 0.0 if den == 0 else sum((p[0] - mt) * (p[1] - mv) for p in pts) / den


def constrain(raw, lo, hi, overdrag):
    if raw < lo:
        return lo - (lo - raw) * overdrag, overdrag
    if raw > hi:
        return hi + (raw - hi) * overdrag, overdrag
    return raw, 1.0


def lerp_map(x, xs, ys):
    """Piecewise-linear map, holding the end values outside."""
    pts = sorted(zip(xs, ys))
    norm = lambda y: y.lower() if isinstance(y, str) else y
    if x <= pts[0][0]:
        return norm(pts[0][1])
    if x >= pts[-1][0]:
        return norm(pts[-1][1])
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            u = (x - x0) / (x1 - x0)
            if isinstance(y0, str):
                a, b = hex_to_oklab(y0), hex_to_oklab(y1)
                return oklab_to_hex([p + (q - p) * u for p, q in zip(a, b)])
            return y0 + (y1 - y0) * u


DRAG_TOGGLE = {
    "nudg": "0.2",
    "targets": ["knob", "track"],
    "values": {
        "knob.x": 0,
        "track.color": {"map": "knob.x", "from": [0, 20], "to": ["#D1D5DB", "#4ADE80"]},
    },
    "animate": {"knob.x": spring_json(0.35, 0.25)},
    "initial": "off",
    "states": {
        "off": {"when": {"track.tap": "on", "track.dragstart": "dragging"}},
        "on": {"set": {"knob.x": 20}, "when": {"track.tap": "off", "track.dragstart": "dragging"}},
        "dragging": {
            "follow": {"knob.x": {"input": "track.drag.x", "range": [0, 20], "overdrag": 0.3}},
            "when": {"track.dragend": {"nearest": ["off", "on"], "by": "knob.x"}},
        },
    },
}
COLOR_MAP = ([0, 20], ["#D1D5DB", "#4ADE80"])


def drag_case(name, title, samples, release, follow_range=(0, 20), overdrag=0.3):
    """Drag from `off` (knob at 0) starting at 0.1 s; `samples` are (t, drag.x)."""
    s = spring(0.35, 0.25)
    steps = [{"t": 0, "expect": {"state": ["off"], "values": {"knob.x": 0, "track.color": "#d1d5db"}}}]
    steps.append({"t": 0.1, "send": "track.dragstart"})
    history = [(0.1, 0.0)]  # dragstart resets the input to 0

    def followed(t):
        raw = 0 + max((h for h in history if h[0] <= t + 1e-12), key=lambda h: h[0])[1]
        return constrain(raw, *follow_range, overdrag)

    probes = sorted({round(t + 0.01, 6) for t, _ in samples[::2]} | {release})
    queue = sorted([(t, "input", v) for t, v in samples] + [(t, "probe", None) for t in probes if t < release])
    for t, kind, v in queue:
        if kind == "input":
            history.append((t, v))
            steps.append({"t": t, "input": "track.drag.x", "value": v})
        else:
            x, _ = followed(t)
            steps.append({"t": t, "expect": {"state": ["dragging"], "values": {"knob.x": round(x, 9), "track.color": lerp_map(x, *COLOR_MAP)}}})

    x, factor = followed(release)
    v = ls_velocity(history, release) * factor
    projected = x + v * 0.5
    target_state = "off" if abs(projected - 0) <= abs(projected - 20) else "on"
    target = 0 if target_state == "off" else 20
    steps.append({"t": release, "send": "track.dragend"})
    knob = Prop(0)
    knob.handoff(x, v, target, s, release)
    for dt in (0.0, 0.04, 0.1, 0.2, 0.4):
        t = round(release + dt, 6)
        kx = knob.value(t)
        steps.append({"t": t, "expect": {"state": [target_state], "values": {"knob.x": kx, "track.color": lerp_map(kx, *COLOR_MAP)}}})
    write(name, {"conformance": "0.2", "name": title, "doc": DRAG_TOGGLE, "steps": steps})


def drag_cases():
    # Slow, then a quick flick, released at 8: short of the midpoint (10), but heading
    # far past it. Position alone would go back off; the projection lands on. The slow
    # start sits partly outside the 0.1 s velocity window, so the window size matters.
    flick = [(round(0.1 + 0.02 * i, 6), round(5 * 0.02 * i, 6)) for i in range(1, 13)]
    flick += [(0.36, 3.2), (0.38, 5.6), (0.4, 8.0)]
    drag_case("drag-flick", "Drag: a flick released short of the midpoint projects past it and springs on with the finger's velocity", flick, 0.41)
    # Past the top of the range with overdrag, then held still: no velocity, settles on from 23.
    over = [(round(0.1 + 0.02 * i, 6), round(150 * 0.02 * i, 6)) for i in range(1, 11)]
    drag_case("drag-overdrag", "Drag: past the range the value moves at the overdrag ratio; a held release has no velocity", over, 0.5)
    # Below the range and released while still moving: the handoff velocity is scaled by overdrag too.
    below = [(round(0.1 + 0.02 * i, 6), round(-50 * 0.02 * i, 6)) for i in range(1, 11)]
    drag_case("drag-overdrag-below", "Drag: below the range, released while moving; the spring starts with the input's velocity times overdrag", below, 0.31)
    # Held exactly at the midpoint: a tie goes to the first listed state.
    tie = [(round(0.1 + 0.02 * i, 6), round(50 * 0.02 * i, 6)) for i in range(1, 11)]
    drag_case("drag-tie", "Drag: released exactly halfway with no velocity, a tie goes to the first listed state", tie, 0.5)
    # A slow drag to 8 and a pause: nearest by position alone goes back off.
    slow = [(round(0.1 + 0.02 * i, 6), round(40 * 0.02 * i, 6)) for i in range(1, 11)]
    drag_case("drag-release-slow", "Drag: released after a pause, nearest uses position only and springs back off", slow, 0.45)


def tabs_cases():
    doc = {
        "nudg": "0.2",
        "targets": ["tab1", "tab2", "tab3", "indicator"],
        "values": {
            "indicator.x": 0,
            "indicator.opacity": {"map": "indicator.x", "from": [0, 50, 100], "to": [1, 0.5, 1]},
        },
        "animate": {"indicator.x": {"tween": {"duration": 0.2, "ease": "linear"}}},
        "initial": "first",
        "when": {"tab1.tap": "first", "tab2.tap": "second", "tab3.tap": "third", "host.reset": "first"},
        "states": {
            "first": {},
            "second": {"set": {"indicator.x": 50}},
            "third": {"set": {"indicator.x": 100}, "when": {"tab3.tap": "first"}},
        },
    }
    xs, ys = [0, 50, 100], [1, 0.5, 1]
    x = Prop(100)
    steps = [{"t": 0, "expect": {"state": ["third"], "values": {"indicator.x": 100, "indicator.opacity": 1}}}]
    # Inside `third`, its own transition wins over the machine's.
    steps.append({"t": 0.1, "send": "tab3.tap"})
    x.retarget(0, tween(0.2, "linear"), 0.1)
    for t in (0.15, 0.2):
        v = x.value(t)
        steps.append({"t": t, "expect": {"state": ["first"], "values": {"indicator.x": v, "indicator.opacity": round(lerp_map(v, xs, ys), 9)}}})
    steps.append({"t": 0.2, "send": "tab2.tap"})
    x.retarget(50, tween(0.2, "linear"), 0.2)
    for t in (0.3, 0.4):
        v = x.value(t)
        steps.append({"t": t, "expect": {"state": ["second"], "values": {"indicator.x": v, "indicator.opacity": round(lerp_map(v, xs, ys), 9)}}})
    steps.append({"t": 0.5, "send": "host.reset"})
    x.retarget(0, tween(0.2, "linear"), 0.5)
    steps.append({"t": 0.6, "expect": {"state": ["first"], "values": {"indicator.x": x.value(0.6)}}})
    steps.append({"t": 0.7, "send": "tab1.hoverstart", "handled": False})
    write("any-state-transitions", {
        "conformance": "0.2",
        "name": "Machine: transitions from any state, a state's own transition first, host events, a starting state, multi-point map",
        "doc": doc,
        "start": ["third"],
        "steps": steps,
    })


def validation_v02_cases():
    def doc(version="0.2", **patch):
        d = json.loads(json.dumps(DRAG_TOGGLE))
        d["nudg"] = version
        for k, v in patch.items():
            d[k] = v
        return d

    out = []
    d = doc("0.1")
    d["values"]["track.color"] = "#D1D5DB"
    out.append(("needs-version", d, [
        ("needs-version", "/states/off/when/track.dragstart"),
        ("needs-version", "/states/on/when/track.dragstart"),
        ("needs-version", "/states/dragging/follow"),
        ("needs-version", "/states/dragging/when/track.dragend"),
    ]))
    d = doc()
    d["states"]["dragging"]["set"] = {"knob.x": 5}
    out.append(("follow-conflict", d, [("follow-conflict", "/states/dragging/follow/knob.x")]))
    d = doc()
    d["states"]["dragging"]["follow"] = {"knob.x": "track.drag.z"}
    out.append(("unknown-input", d, [("unknown-input", "/states/dragging/follow/knob.x")]))
    d = doc()
    d["states"]["dragging"]["when"]["track.dragend"] = {"nearest": ["off", "onn"], "by": "knob.x"}
    out.append(("nearest-unknown-state", d, [("unknown-state", "/states/dragging/when/track.dragend/nearest/1")]))
    d = doc()
    d["states"]["dragging"]["when"]["track.dragend"] = {"nearest": ["off", "on"], "by": "track.color"}
    out.append(("nearest-by", d, [("invalid-by", "/states/dragging/when/track.dragend/by")]))
    d = doc()
    d["targets"].append("dot")
    d["values"]["dot.opacity"] = {"map": "track.color", "from": [0, 1], "to": [0, 1]}
    out.append(("map-source", d, [("invalid-map-source", "/values/dot.opacity/map")]))
    d = doc()
    d["states"]["on"]["set"]["track.color"] = "#000000"
    out.append(("mapped-property", d, [("mapped-property", "/states/on/set/track.color")]))
    d = doc()
    d["values"]["track.color"] = {"map": "knob.x", "from": [0, 0], "to": ["#D1D5DB", "#4ADE80"]}
    out.append(("map-points", d, [("invalid-map", "/values/track.color/from")]))
    d = doc()
    d["targets"] = ["knob", "track", "host"]
    out.append(("reserved-name", d, [("reserved-name", "/targets/2")]))
    write("validation-0.2", {
        "conformance": "0.2",
        "name": "Validator (0.2): each document produces exactly these errors (code and JSON pointer)",
        "documents": [{"name": n, "doc": dd, "errors": [{"code": c, "path": pp} for c, pp in e]} for n, dd, e in out],
    })


# --- v0.3: timers, keyboard, step/commit, bounds, reduced motion ---------------


def timer_cases():
    doc = {
        "nudg": "0.3",
        "targets": ["toast"],
        "values": {"toast.y": 12, "toast.opacity": 0},
        "animate": {"toast.y": spring_json(0.4, 0.2), "toast.opacity": {"tween": {"duration": 0.2, "ease": "linear"}}},
        "initial": "hidden",
        "when": {"host.show": "shown", "host.hide": "hidden"},
        "states": {
            "hidden": {},
            "shown": {"set": {"toast.y": 0, "toast.opacity": 1}, "when": {"after:500ms": "hidden", "toast.tap": "hidden"}},
        },
    }
    # Shown at 0.1, so the timer fires at exactly 0.6 even though the host only looks at 0.65.
    y, op = Prop(12), Prop(0)
    steps = [{"t": 0.1, "send": "host.show"}]
    y.retarget(0, spring(0.4, 0.2), 0.1)
    op.retarget(1, tween(0.2, "linear"), 0.1)
    steps.append({"t": 0.55, "expect": {"state": ["shown"], "values": {"toast.y": y.value(0.55), "toast.opacity": op.value(0.55)}}})
    y.retarget(12, spring(0.4, 0.2), 0.6)
    op.retarget(0, tween(0.2, "linear"), 0.6)
    for t in (0.65, 0.8, 1.2):
        steps.append({"t": t, "expect": {"state": ["hidden"], "values": {"toast.y": y.value(t), "toast.opacity": op.value(t)}}})
    write("timer-fires", {
        "conformance": "0.3",
        "name": "Timer: after:500ms fires at exactly 0.6 s, even when the host only asks for a later time; values move from the due time",
        "doc": doc,
        "steps": steps,
    })

    # Re-entering the state (shown -> shown) restarts the timer: 0.1 + 0.3 -> fires at 0.8, not 0.6.
    y, op = Prop(12), Prop(0)
    steps = [{"t": 0.1, "send": "host.show"}]
    y.retarget(0, spring(0.4, 0.2), 0.1)
    op.retarget(1, tween(0.2, "linear"), 0.1)
    steps.append({"t": 0.3, "send": "host.show"})
    steps.append({"t": 0.7, "expect": {"state": ["shown"], "values": {"toast.y": y.value(0.7), "toast.opacity": op.value(0.7)}}})
    y.retarget(12, spring(0.4, 0.2), 0.8)
    op.retarget(0, tween(0.2, "linear"), 0.8)
    steps.append({"t": 0.9, "expect": {"state": ["hidden"], "values": {"toast.y": y.value(0.9), "toast.opacity": op.value(0.9)}}})
    write("timer-restart", {
        "conformance": "0.3",
        "name": "Timer: a transition to the same state restarts it",
        "doc": doc,
        "steps": steps,
    })

    # Leaving the state cancels the timer; a timer and an event due at the same time: the timer first.
    y, op = Prop(12), Prop(0)
    steps = [{"t": 0.1, "send": "host.show"}, {"t": 0.3, "send": "toast.tap"}]
    y.retarget(0, spring(0.4, 0.2), 0.1)
    op.retarget(1, tween(0.2, "linear"), 0.1)
    y.retarget(12, spring(0.4, 0.2), 0.3)
    op.retarget(0, tween(0.2, "linear"), 0.3)
    steps.append({"t": 0.7, "expect": {"state": ["hidden"], "values": {"toast.y": y.value(0.7)}}})
    steps.append({"t": 1.0, "send": "host.show"})
    y.retarget(0, spring(0.4, 0.2), 1.0)
    op.retarget(1, tween(0.2, "linear"), 1.0)
    # At 1.5 the timer (due 1.5) hides it, then host.show at 1.5 shows it again from where it is.
    y.retarget(12, spring(0.4, 0.2), 1.5)
    op.retarget(0, tween(0.2, "linear"), 1.5)
    y.retarget(0, spring(0.4, 0.2), 1.5)
    op.retarget(1, tween(0.2, "linear"), 1.5)
    steps.append({"t": 1.5, "send": "host.show"})
    steps.append({"t": 1.6, "expect": {"state": ["shown"], "values": {"toast.y": y.value(1.6), "toast.opacity": op.value(1.6)}}})
    steps.append({"t": 2.1, "expect": {"state": ["hidden"]}})
    write("timer-cancel-and-order", {
        "conformance": "0.3",
        "name": "Timer: leaving the state cancels it; a timer due when an event arrives fires first, then the event",
        "doc": doc,
        "steps": steps,
    })


SLIDER = {
    "nudg": "0.3",
    "targets": ["thumb"],
    "values": {"thumb.x": {"base": 0, "min": 0, "max": 100}},
    "animate": {"thumb.x": spring_json(0.3, 0)},
    "initial": "idle",
    "states": {
        "idle": {
            "when": {
                "thumb.key.arrowright": {"step": {"thumb.x": 10}},
                "thumb.key.arrowleft": {"step": {"thumb.x": -10}},
                "thumb.key.end": {"step": {"thumb.x": 1000}},
                "thumb.dragstart": "dragging",
            }
        },
        "dragging": {
            "follow": {"thumb.x": "thumb.drag.x"},
            "when": {"thumb.dragend": {"to": "idle", "commit": ["thumb.x"]}},
        },
    },
}


def step_commit_cases():
    s = spring(0.3, 0)
    # Keys step the base; a held key (repeats) keeps stepping; end clamps to max; left from max steps down.
    x = Prop(0)
    steps = [{"t": 0.1, "send": "thumb.key.arrowright"}]
    x.retarget(10, s, 0.1)
    steps.append({"t": 0.2, "expect": {"state": ["idle"], "values": {"thumb.x": x.value(0.2)}}})
    steps.append({"t": 0.2, "send": "thumb.key.arrowright"})
    x.retarget(20, s, 0.2)
    steps.append({"t": 0.25, "send": "thumb.key.arrowright"})
    x.retarget(30, s, 0.25)
    steps.append({"t": 0.4, "expect": {"values": {"thumb.x": x.value(0.4)}}})
    steps.append({"t": 1.0, "send": "thumb.key.end"})
    x.retarget(100, s, 1.0)
    steps.append({"t": 1.3, "expect": {"values": {"thumb.x": x.value(1.3)}}})
    steps.append({"t": 2.0, "send": "thumb.key.arrowleft"})
    x.retarget(90, s, 2.0)
    steps.append({"t": 2.2, "expect": {"values": {"thumb.x": x.value(2.2)}}})
    steps.append({"t": 2.2, "send": "thumb.key.space", "handled": False})
    write("step-keys", {
        "conformance": "0.3",
        "name": "step: keys add to the base value, clamped to max; unhandled keys are reported",
        "doc": SLIDER,
        "steps": steps,
    })

    # Drag to 37 (follow bounded by min/max), release: commit keeps it there, at rest, with no motion.
    x = Prop(0)
    steps = [{"t": 0.1, "send": "thumb.dragstart"}]
    history = [(0.1, 0.0)]
    for i in range(1, 6):
        t = round(0.1 + 0.05 * i, 6)
        v = round(37 * i / 5, 6)
        history.append((t, v))
        steps.append({"t": t, "input": "thumb.drag.x", "value": v})
    steps.append({"t": 0.4, "expect": {"state": ["dragging"], "values": {"thumb.x": 37.0}}})
    # Past max: clamped by the property's bounds (the follow's default range, hard stop).
    steps.append({"t": 0.5, "input": "thumb.drag.x", "value": 130})
    steps.append({"t": 0.5, "expect": {"values": {"thumb.x": 100.0}}})
    steps.append({"t": 0.6, "input": "thumb.drag.x", "value": 37})
    steps.append({"t": 0.8, "send": "thumb.dragend"})
    for t in (0.8, 0.9, 1.5):
        steps.append({"t": t, "expect": {"state": ["idle"], "values": {"thumb.x": 37.0}}})
    # Then a key steps from the committed base.
    steps.append({"t": 1.5, "send": "thumb.key.arrowright"})
    x.handoff(37.0, 0.0, 47, s, 1.5)
    steps.append({"t": 1.6, "expect": {"values": {"thumb.x": x.value(1.6)}}})
    write("commit-drag", {
        "conformance": "0.3",
        "name": "commit: a released drag keeps its value as the new base, with no motion; bounds limit the follow",
        "doc": SLIDER,
        "steps": steps,
    })


def commit_moving_case():
    # Released while still moving: the value stays put (no velocity carried over), even past the bounds.
    steps = [{"t": 0.1, "send": "thumb.dragstart"}]
    for i in range(1, 6):
        steps.append({"t": round(0.1 + 0.04 * i, 6), "input": "thumb.drag.x", "value": round(6 * i, 6)})
    steps.append({"t": 0.3, "send": "thumb.dragend"})
    for t in (0.3, 0.35, 0.5, 1.0):
        steps.append({"t": t, "expect": {"state": ["idle"], "values": {"thumb.x": 30.0}}})
    write("commit-moving", {
        "conformance": "0.3",
        "name": "commit: a value released while moving stays exactly where it was, with no velocity carried over",
        "doc": SLIDER,
        "steps": steps,
    })


def reduced_motion_cases():
    # With reducedMotion, springs and tweens become 0.15 s linear tweens and kicks are ignored.
    doc = {
        "nudg": "0.3",
        "targets": ["knob", "heart"],
        "values": {"knob.x": 0, "heart.scale": 1},
        "animate": {"knob.x": spring_json(0.35, 0.25)},
        "initial": "off",
        "states": {
            "off": {"when": {"knob.tap": "on"}},
            "on": {"set": {"knob.x": 20}, "enter": {"heart.scale": {"kick": 6, "spring": {"duration": 0.4, "bounce": 0.5}}}, "when": {"knob.tap": "off"}},
        },
    }
    steps = [{"t": 0.1, "send": "knob.tap"}]
    for t, v in ((0.1, 0.0), (0.175, 10.0), (0.25, 20.0), (0.5, 20.0)):
        steps.append({"t": t, "expect": {"state": ["on"], "values": {"knob.x": v, "heart.scale": 1.0}}})
    write("reduced-motion", {
        "conformance": "0.3",
        "name": "Reduced motion: every motion is a 0.15 s linear tween and kicks do nothing",
        "doc": doc,
        "reducedMotion": True,
        "steps": steps,
    })


def validation_v03_cases():
    def doc(**patch):
        d = json.loads(json.dumps(SLIDER))
        for k, v in patch.items():
            d[k] = v
        return d

    out = []
    d = doc()
    d["nudg"] = "0.2"
    out.append(("needs-version", d, [
        ("needs-version", "/values/thumb.x"),
        ("needs-version", "/states/idle/when/thumb.key.arrowright"),
        ("needs-version", "/states/idle/when/thumb.key.arrowright/step"),
        ("needs-version", "/states/idle/when/thumb.key.arrowleft"),
        ("needs-version", "/states/idle/when/thumb.key.arrowleft/step"),
        ("needs-version", "/states/idle/when/thumb.key.end"),
        ("needs-version", "/states/idle/when/thumb.key.end/step"),
        ("needs-version", "/states/dragging/when/thumb.dragend/commit"),
    ]))
    d = doc()
    d["when"] = {"after:1s": "idle"}
    out.append(("after-on-machine", d, [("after-on-machine", "/when/after:1s")]))
    d = doc()
    d["states"]["idle"]["when"]["after:soon"] = "dragging"
    out.append(("invalid-after", d, [("invalid-after", "/states/idle/when/after:soon")]))
    d = doc()
    d["states"]["idle"]["when"]["thumb.key.arrowright"] = {"step": {"thumb.y": 10}}
    out.append(("step-unknown-property", d, [("missing-base-value", "/states/idle/when/thumb.key.arrowright/step/thumb.y")]))
    d = doc()
    d["targets"].append("track")
    d["values"]["track.color"] = "#000000"
    d["states"]["idle"]["when"]["thumb.key.arrowright"] = {"step": {"track.color": 1}}
    out.append(("step-on-color", d, [("invalid-step", "/states/idle/when/thumb.key.arrowright/step/track.color")]))
    d = doc()
    d["states"]["dragging"]["when"]["thumb.dragend"] = {"to": "idle", "commit": ["thumb.z"]}
    out.append(("commit-unknown", d, [("unknown-property", "/states/dragging/when/thumb.dragend/commit/0")]))
    d = doc()
    d["states"]["idle"]["set"] = {"thumb.x": 150}
    out.append(("out-of-range", d, [("out-of-range", "/states/idle/set/thumb.x")]))
    d = doc()
    d["values"]["thumb.x"] = {"base": 50, "min": 100, "max": 0}
    out.append(("invalid-bounds", d, [("invalid-bounds", "/values/thumb.x")]))
    d = doc()
    d["values"]["thumb.x"] = {"min": 0, "max": 100}
    out.append(("missing-base", d, [("missing-base", "/values/thumb.x")]))
    d = doc()
    d["states"]["idle"]["when"]["thumb.key.Shift+A"] = "dragging"
    out.append(("invalid-key-name", d, [("invalid-event", "/states/idle/when/thumb.key.Shift+A")]))
    write("validation-0.3", {
        "conformance": "0.3",
        "name": "Validator (0.3): each document produces exactly these errors (code and JSON pointer)",
        "documents": [{"name": n, "doc": dd, "errors": [{"code": c, "path": pp} for c, pp in e]} for n, dd, e in out],
    })


# --- v0.4: layout as input -----------------------------------------------------


MEASURED_TABS = {
    "nudg": "0.4",
    "targets": ["seg1", "seg2", "seg3", "indicator"],
    "values": {"indicator.x": 0, "indicator.width": {"measure": "seg1.width"}},
    "animate": {
        "indicator.x": spring_json(0.3, 0.1),
        "indicator.width": spring_json(0.3, 0.1),
    },
    "initial": "first",
    "when": {"seg1.tap": "first", "seg2.tap": "second", "seg3.tap": "third"},
    "states": {
        "first": {"set": {"indicator.x": {"measure": "seg1.x"}}},
        "second": {"set": {"indicator.x": {"measure": "seg2.x"}, "indicator.width": {"measure": "seg2.width"}}},
        "third": {"set": {"indicator.x": {"measure": "seg3.x"}, "indicator.width": {"measure": "seg3.width"}}},
    },
}


def layout_cases():
    s = spring(0.3, 0.1)
    # The host's report: the indicator's own box starts at 10; segments of different widths.
    layout = [("indicator.layout.x", 10), ("seg1.layout.x", 10), ("seg1.layout.width", 60), ("seg2.layout.x", 70), ("seg2.layout.width", 90), ("seg3.layout.x", 160), ("seg3.layout.width", 50)]
    x, w = Prop(0), Prop(0)
    steps = [{"t": 0, "expect": {"state": ["first"], "values": {"indicator.x": 0, "indicator.width": 0}}}]
    # Before any report a measured value is its base; the first report places values without motion.
    for name, v in layout:
        steps.append({"t": 0, "input": name, "value": v})
    x.retarget(0, None, 0)  # seg1.x - indicator.x = 0
    w.retarget(60, None, 0)
    steps.append({"t": 0, "expect": {"values": {"indicator.x": x.value(0), "indicator.width": w.value(0)}}})
    # A tap: position aligns (seg2.x - indicator.x), size is the size.
    steps.append({"t": 0.1, "send": "seg2.tap"})
    x.retarget(60, s, 0.1)
    w.retarget(90, s, 0.1)
    for t in (0.15, 0.2, 0.3):
        steps.append({"t": t, "expect": {"state": ["second"], "values": {"indicator.x": x.value(t), "indicator.width": w.value(t)}}})
    # A relayout while moving (a font loaded): seg2 grows and shifts; the values retarget, keeping velocity.
    steps.append({"t": 0.3, "input": "seg2.layout.x", "value": 74})
    x.retarget(64, s, 0.3)
    steps.append({"t": 0.3, "input": "seg2.layout.width", "value": 96})
    w.retarget(96, s, 0.3)
    for t in (0.35, 0.45, 0.7):
        steps.append({"t": t, "expect": {"state": ["second"], "values": {"indicator.x": x.value(t), "indicator.width": w.value(t)}}})
    # A relayout of a segment the active state doesn't measure moves nothing.
    steps.append({"t": 0.7, "input": "seg3.layout.x", "value": 170})
    steps.append({"t": 0.8, "expect": {"values": {"indicator.x": x.value(0.8), "indicator.width": w.value(0.8)}}})
    write("layout-tabs", {
        "conformance": "0.4",
        "name": "Layout: measured positions align, measured sizes size, the first report places, a relayout retargets with velocity",
        "doc": MEASURED_TABS,
        "steps": steps,
    })

    # Not yet measured: a measured set falls back to the property's base value (5 here, not 0).
    unmeasured_doc = json.loads(json.dumps(MEASURED_TABS))
    unmeasured_doc["values"]["indicator.x"] = 5
    steps = [{"t": 0.1, "send": "seg3.tap"}]
    steps.append({"t": 0.2, "expect": {"state": ["third"], "values": {"indicator.x": 5, "indicator.width": 0}}})
    # The first report of seg3 now places the indicator, no motion.
    for name, v in (("indicator.layout.x", 10), ("seg3.layout.x", 160)):
        steps.append({"t": 0.3, "input": name, "value": v})
    steps.append({"t": 0.3, "expect": {"values": {"indicator.x": 150}}})
    write("layout-unmeasured", {
        "conformance": "0.4",
        "name": "Layout: before the host reports, a measured value is its base; the first report places it",
        "doc": unmeasured_doc,
        "steps": steps,
    })

    # An accordion that opens to its natural height, and follows the content when it grows.
    doc = {
        "nudg": "0.4",
        "targets": ["header", "content"],
        "values": {"content.height": 0},
        "animate": {"content.height": spring_json(0.4, 0)},
        "initial": "closed",
        "states": {
            "closed": {"when": {"header.tap": "open"}},
            "open": {"set": {"content.height": {"measure": "content.naturalHeight"}}, "when": {"header.tap": "closed"}},
        },
    }
    s = spring(0.4, 0)
    h = Prop(0)
    steps = [{"t": 0, "input": "content.layout.naturalHeight", "value": 120}]
    steps.append({"t": 0, "expect": {"state": ["closed"], "values": {"content.height": 0}}})
    steps.append({"t": 0.1, "send": "header.tap"})
    h.retarget(120, s, 0.1)
    for t in (0.2, 0.35):
        steps.append({"t": t, "expect": {"state": ["open"], "values": {"content.height": h.value(t)}}})
    steps.append({"t": 0.35, "input": "content.layout.naturalHeight", "value": 150})
    h.retarget(150, s, 0.35)
    for t in (0.45, 0.8):
        steps.append({"t": t, "expect": {"state": ["open"], "values": {"content.height": h.value(t)}}})
    steps.append({"t": 0.8, "send": "header.tap"})
    h.retarget(0, s, 0.8)
    steps.append({"t": 1.0, "expect": {"state": ["closed"], "values": {"content.height": h.value(1.0)}}})
    write("layout-accordion", {
        "conformance": "0.4",
        "name": "Layout: a natural height to open to, followed when the content grows",
        "doc": doc,
        "steps": steps,
    })


def validation_v04_cases():
    def doc():
        return json.loads(json.dumps(MEASURED_TABS))

    out = []
    d = doc()
    d["nudg"] = "0.3"
    out.append(("needs-version", d, [
        ("needs-version", "/values/indicator.width"),
        ("needs-version", "/states/first/set/indicator.x"),
        ("needs-version", "/states/second/set/indicator.x"),
        ("needs-version", "/states/second/set/indicator.width"),
        ("needs-version", "/states/third/set/indicator.x"),
        ("needs-version", "/states/third/set/indicator.width"),
    ]))
    d = doc()
    d["states"]["second"]["set"]["indicator.x"] = {"measure": "seg2.left"}
    out.append(("unknown-measurement", d, [("invalid-measure", "/states/second/set/indicator.x/measure")]))
    d = doc()
    d["states"]["second"]["set"]["indicator.x"] = {"measure": "tab9.x"}
    out.append(("unknown-target", d, [("unknown-target", "/states/second/set/indicator.x/measure")]))
    d = doc()
    d["states"]["second"]["set"]["indicator.width"] = {"measure": "seg2.x"}
    out.append(("position-into-size", d, [("invalid-measure", "/states/second/set/indicator.width/measure")]))
    d = doc()
    d["states"]["second"]["set"]["indicator.x"] = {"measure": "seg2.y"}
    out.append(("axis-mismatch", d, [("invalid-measure", "/states/second/set/indicator.x/measure")]))
    d = doc()
    d["targets"].append("track")
    d["values"]["track.color"] = {"measure": "seg1.width"}
    out.append(("measure-color", d, [("invalid-measure", "/values/track.color")]))
    d = doc()
    d["states"]["second"]["set"]["indicator.x"] = {"measure": "seg2.x", "plus": 4}
    out.append(("arithmetic-needs-version", d, [("needs-version", "/states/second/set/indicator.x/plus")]))
    write("validation-0.4", {
        "conformance": "0.4",
        "name": "Validator (0.4): each document produces exactly these errors (code and JSON pointer)",
        "documents": [{"name": n, "doc": dd, "errors": [{"code": c, "path": pp} for c, pp in e]} for n, dd, e in out],
    })


# --- v0.5: continuous app and scroll inputs ----------------------------------

CONTINUOUS_INPUTS = {
    "nudg": "0.5",
    "targets": ["ring", "card", "scroller", "header"],
    "values": {
        "ring.scale": {"map": "host.volume", "from": [0, 1], "to": [1, 1.6]},
        "card.rotation": 0,
        "header.height": {"map": "scroller.scroll.y", "from": [0, 100], "to": [64, 40]},
    },
    "initial": "active",
    "states": {
        "active": {
            "follow": {"card.rotation": {"input": "host.tilt", "range": [-8, 8]}},
        },
    },
}


def continuous_input_cases():
    steps = [
        {"t": 0, "expect": {"state": ["active"], "values": {"ring.scale": 1, "card.rotation": 0, "header.height": 64}}},
        {"t": 0.1, "input": "host.volume", "value": 0.5},
        {"t": 0.1, "expect": {"values": {"ring.scale": 1.3}}},
        {"t": 0.2, "input": "scroller.scroll.y", "value": 25},
        {"t": 0.2, "expect": {"values": {"header.height": 58}}},
        {"t": 0.3, "input": "host.tilt", "value": 5},
        {"t": 0.3, "expect": {"values": {"card.rotation": 5}}},
        {"t": 0.4, "input": "host.tilt", "value": 10},
        {"t": 0.4, "expect": {"values": {"card.rotation": 8}}},
    ]
    write("continuous-inputs", {
        "conformance": "0.5",
        "name": "Continuous inputs: map app and scroll values; follow an app value with bounds",
        "doc": CONTINUOUS_INPUTS,
        "steps": steps,
    })


def validation_v05_cases():
    def doc():
        return json.loads(json.dumps(CONTINUOUS_INPUTS))

    out = []
    d = doc()
    d["nudg"] = "0.4"
    out.append(("needs-version", d, [
        ("needs-version", "/values/ring.scale/map"),
        ("needs-version", "/values/header.height/map"),
        ("needs-version", "/states/active/follow/card.rotation/input"),
    ]))
    d = doc()
    d["values"]["ring.scale"]["map"] = "host.audio.level"
    out.append(("invalid-host-input", d, [("unknown-input", "/values/ring.scale/map")]))
    d = doc()
    d["values"]["header.height"]["map"] = "scroller.scroll.z"
    out.append(("invalid-scroll-axis", d, [("unknown-input", "/values/header.height/map")]))
    d = doc()
    d["values"]["header.height"]["map"] = "missing.scroll.y"
    out.append(("unknown-scroll-target", d, [("unknown-target", "/values/header.height/map")]))
    write("validation-0.5", {
        "conformance": "0.5",
        "name": "Validator (0.5): continuous app and scroll inputs",
        "documents": [{"name": n, "doc": dd, "errors": [{"code": c, "path": pp} for c, pp in e]} for n, dd, e in out],
    })


# --- v0.6: arithmetic on layout measurements -------------------------------

MEASURE_ARITHMETIC = {
    "nudg": "0.6",
    "targets": ["sheet", "indicator", "seg2"],
    "values": {
        "sheet.y": {"measure": "sheet.height", "times": 1, "plus": 12},
        "indicator.x": 0,
    },
    "animate": {
        "sheet.y": spring_json(0.3, 0.1),
        "indicator.x": spring_json(0.3, 0.1),
    },
    "initial": "closed",
    "states": {
        "closed": {"when": {"sheet.tap": "half"}},
        "half": {
            "set": {
                "sheet.y": {"measure": "sheet.height", "times": 0.5, "plus": -8},
                "indicator.x": {"measure": "seg2.x", "times": 0.5, "plus": 4},
            },
        },
    },
}


def layout_arithmetic_cases():
    steps = [
        {"t": 0, "expect": {"state": ["closed"], "values": {"sheet.y": 0, "indicator.x": 0}}},
        {"t": 0, "input": "sheet.layout.height", "value": 200},
        {"t": 0, "expect": {"values": {"sheet.y": 212}}},
        {"t": 0, "input": "indicator.layout.x", "value": 20},
        {"t": 0, "input": "seg2.layout.x", "value": 140},
        {"t": 0.1, "send": "sheet.tap"},
        {"t": 0.1, "expect": {"state": ["half"]}},
    ]
    sheet, indicator = Prop(212), Prop(0)
    motion = spring(0.3, 0.1)
    sheet.retarget(92, motion, 0.1)  # 200 * 0.5 - 8
    indicator.retarget(64, motion, 0.1)  # (140 - 20) * 0.5 + 4
    for t in (0.15, 0.25, 0.5):
        steps.append({"t": t, "expect": {"values": {"sheet.y": sheet.value(t), "indicator.x": indicator.value(t)}}})
    steps.append({"t": 0.5, "input": "sheet.layout.height", "value": 240})
    sheet.retarget(112, motion, 0.5)
    for t in (0.6, 0.9):
        steps.append({"t": t, "expect": {"values": {"sheet.y": sheet.value(t), "indicator.x": indicator.value(t)}}})
    write("layout-arithmetic", {
        "conformance": "0.6",
        "name": "Layout arithmetic: measured sizes and aligned positions are scaled and offset, including on relayout",
        "doc": MEASURE_ARITHMETIC,
        "steps": steps,
    })


def validation_v06_cases():
    def doc():
        return json.loads(json.dumps(MEASURE_ARITHMETIC))

    out = []
    d = doc()
    d["nudg"] = "0.5"
    out.append(("needs-version", d, [
        ("needs-version", "/values/sheet.y/times"),
        ("needs-version", "/values/sheet.y/plus"),
        ("needs-version", "/states/half/set/sheet.y/times"),
        ("needs-version", "/states/half/set/sheet.y/plus"),
        ("needs-version", "/states/half/set/indicator.x/times"),
        ("needs-version", "/states/half/set/indicator.x/plus"),
    ]))
    d = doc()
    d["states"]["half"]["set"]["sheet.y"]["times"] = "half"
    out.append(("times-not-number", d, [("invalid-measure-arithmetic", "/states/half/set/sheet.y/times")]))
    d = doc()
    d["states"]["half"]["set"]["sheet.y"]["plus"] = None
    out.append(("plus-not-number", d, [("invalid-measure-arithmetic", "/states/half/set/sheet.y/plus")]))
    write("validation-0.6", {
        "conformance": "0.6",
        "name": "Validator (0.6): layout measurement arithmetic",
        "documents": [{"name": n, "doc": dd, "errors": [{"code": c, "path": pp} for c, pp in e]} for n, dd, e in out],
    })


# --- v0.7: pausable timers --------------------------------------------------

PAUSABLE_TIMER = {
    "nudg": "0.7",
    "targets": ["toast"],
    "values": {"toast.opacity": 0},
    "initial": "hidden",
    "when": {"host.show": "shown"},
    "states": {
        "hidden": {},
        "shown": {
            "set": {"toast.opacity": 1},
            "when": {
                "after:1s": {
                    "to": "hidden",
                    "pause": [
                        {"on": "toast.hoverstart", "off": "toast.hoverend"},
                        {"on": "toast.focus", "off": "toast.blur"},
                        {"on": "host.suspend", "off": "host.resume"},
                    ],
                },
            },
        },
    },
}


def pausable_timer_cases():
    steps = [
        {"t": 0, "send": "host.show"},
        {"t": 0.4, "send": "toast.hoverstart"},
        {"t": 0.8, "send": "toast.focus"},
        {"t": 1.0, "send": "toast.hoverend"},
        {"t": 2.0, "expect": {"state": ["shown"], "values": {"toast.opacity": 1}}},
        {"t": 2.2, "send": "toast.blur"},
        {"t": 2.79, "expect": {"state": ["shown"]}},
        {"t": 2.8, "expect": {"state": ["hidden"], "values": {"toast.opacity": 0}}},
        # Re-entering the state resets both remaining time and pause blockers.
        {"t": 3.0, "send": "host.show"},
        {"t": 3.2, "send": "host.suspend"},
        {"t": 3.5, "send": "host.show"},
        {"t": 4.49, "expect": {"state": ["shown"]}},
        {"t": 4.5, "expect": {"state": ["hidden"]}},
        # A timer due at the same instant fires before the incoming pause event.
        {"t": 5.0, "send": "host.show"},
        {"t": 6.0, "send": "toast.hoverstart", "handled": False},
        {"t": 6.0, "expect": {"state": ["hidden"]}},
    ]
    write("timer-pause", {
        "conformance": "0.7",
        "name": "Timer pause: overlapping reasons preserve remaining time; re-entry resets; a due timer wins a tie",
        "doc": PAUSABLE_TIMER,
        "steps": steps,
    })


def validation_v07_cases():
    def doc():
        return json.loads(json.dumps(PAUSABLE_TIMER))

    out = []
    d = doc()
    d["nudg"] = "0.6"
    out.append(("needs-version", d, [("needs-version", "/states/shown/when/after:1s/pause")]))
    d = doc()
    d["states"]["shown"]["when"]["after:1s"]["pause"] = "hover"
    out.append(("pause-not-array", d, [("invalid-timer-pause", "/states/shown/when/after:1s/pause")]))
    d = doc()
    del d["states"]["shown"]["when"]["after:1s"]["pause"][0]["off"]
    out.append(("missing-off", d, [("invalid-timer-pause", "/states/shown/when/after:1s/pause/0/off")]))
    d = doc()
    d["states"]["shown"]["when"]["after:1s"]["pause"][0]["on"] = "toast.over"
    out.append(("invalid-event", d, [("unknown-event", "/states/shown/when/after:1s/pause/0/on")]))
    d = doc()
    d["states"]["shown"]["when"]["after:1s"]["pause"][0]["off"] = "toast.hoverstart"
    out.append(("same-events", d, [("invalid-timer-pause", "/states/shown/when/after:1s/pause/0/off")]))
    d = doc()
    d["states"]["shown"]["when"]["toast.tap"] = {"to": "hidden", "pause": [{"on": "toast.hoverstart", "off": "toast.hoverend"}]}
    out.append(("pause-on-event-transition", d, [("unknown-key", "/states/shown/when/toast.tap/pause")]))
    write("validation-0.7", {
        "conformance": "0.7",
        "name": "Validator (0.7): pausable timers",
        "documents": [{"name": n, "doc": dd, "errors": [{"code": c, "path": pp} for c, pp in e]} for n, dd, e in out],
    })


# --- rest: when nothing moves (lifecycle) -----------------------------------

REST_NUMBER = 1e-3


# --- v0.10: loops while a state is active -----------------------------------


def loop_offset(points, duration, delay, t0, t, ease=None):
    """A loop's offset: 0 at the start of each cycle, through the points, to the last at 1."""
    local = t - t0 - delay
    if local < 0:
        return 0.0, 0.0
    u = (local - duration * math.floor(local / duration)) / duration
    pts = [(0.0, 0.0)] + [(float(a), float(v)) for a, v in points]
    for (a0, v0), (a1, v1) in zip(pts, pts[1:]):
        if u <= a1:
            p = (u - a0) / (a1 - a0)
            h = 1e-7
            slope = (ease_at(ease, min(1, p + h)) - ease_at(ease, max(0, p - h))) / (min(1, p + h) - max(0, p - h))
            return v0 + (v1 - v0) * ease_at(ease, p), (v1 - v0) * slope / ((a1 - a0) * duration)
    return pts[-1][1], 0.0


def wrapped(offset, period):
    """The equivalent offset in (-period/2, period/2]."""
    return offset - period * math.ceil(offset / period - 0.5)


SPINNER = {
    "nudg": "0.10",
    "targets": ["spinner"],
    "values": {"spinner.rotation": 0, "spinner.opacity": 0},
    "animate": {"spinner.rotation": spring_json(0.3, 0), "spinner.opacity": {"tween": {"duration": 0.2, "ease": "linear"}}},
    "initial": "idle",
    "states": {
        "idle": {"when": {"host.start": "busy"}},
        "busy": {
            "set": {"spinner.opacity": 1},
            "loop": {"spinner.rotation": {"to": 360, "duration": 1, "wrap": 360}},
            "when": {"host.done": "idle"},
        },
    },
}

TYPING = {
    "nudg": "0.10",
    "targets": ["dot", "halo"],
    "values": {
        "dot.y": 0,
        "halo.opacity": {"map": "dot.y", "from": [0, -6], "to": [0, 1]},
    },
    "animate": {"dot.y": spring_json(0.25, 0)},
    "initial": "idle",
    "states": {
        "idle": {"when": {"host.typing": "typing"}},
        "typing": {
            "loop": {"dot.y": {"keyframes": [{"at": 0.25, "value": -6}, {"at": 0.5, "value": 0}], "duration": 1.2, "delay": 0.2}},
            "when": {"host.typing": "typing", "host.sent": "sent"},
        },
        "sent": {"set": {"dot.y": -10}},
    },
}

SHIMMER = {
    "nudg": "0.10",
    "targets": ["track", "highlight"],
    "values": {"highlight.x": 0},
    "initial": "loading",
    "states": {
        "loading": {
            "loop": {"highlight.x": {"to": {"measure": "track.width"}, "duration": 1, "ease": "in-out"}},
            "when": {"host.loaded": "loaded"},
        },
        "loaded": {},
    },
}


def loop_cases():
    turn = [(1.0, 360)]
    steps = [
        {"t": 0, "expect": {"state": ["idle"], "values": {"spinner.rotation": 0}, "looping": False, "resting": True}},
        {"t": 0.1, "send": "host.start"},
        # The offset starts at 0 on entry and turns at a constant rate; the property's own
        # motion is at rest, so the runtime rests once the opacity tween is done.
        {"t": 0.1, "expect": {"state": ["busy"], "values": {"spinner.rotation": 0}, "looping": True}},
        {"t": 0.35, "expect": {"values": {"spinner.rotation": 90}, "resting": True, "looping": True}},
        {"t": 1.25, "expect": {"values": {"spinner.rotation": round(loop_offset(turn, 1, 0, 0.1, 1.25)[0], 9)}}},
    ]
    leave = 1.65
    offset, rate = loop_offset(turn, 1, 0, 0.1, leave)
    steps.append({"t": leave, "send": "host.done"})
    # Leaving: 198 degrees wraps to -162 and keeps turning forward into the spring.
    r = Prop(0)
    r.handoff(wrapped(offset, 360), rate, 0, spring(0.3, 0), leave)
    for t in (1.7, 1.8, 2.2):
        steps.append({"t": t, "expect": {"state": ["idle"], "values": {"spinner.rotation": r.value(t)}, "looping": False}})
    steps[-3]["expect"]["resting"] = False
    write("loop-spinner", {
        "conformance": "0.10",
        "name": "Loop: a sawtooth offset from 0 on entry; at rest while looping; leaving wraps the offset and hands its velocity to the spring",
        "doc": SPINNER,
        "steps": steps,
    })

    write("loop-reduced", {
        "conformance": "0.10",
        "name": "Loop: reduced motion holds the offset at 0 and nothing loops",
        "doc": SPINNER,
        "reducedMotion": True,
        "steps": [
            {"t": 0.1, "send": "host.start"},
            {"t": 0.5, "expect": {"state": ["busy"], "values": {"spinner.rotation": 0}, "looping": False}},
        ],
    })

    pulse = [(0.25, -6), (0.5, 0), (1.0, 0)]
    enter = 0.1

    def typing_at(t, t0=enter):
        return round(loop_offset(pulse, 1.2, 0.2, t0, t)[0], 9)

    steps = [
        {"t": enter, "send": "host.typing"},
        # Before the delay the offset holds at 0; then the cycle runs from its start.
        {"t": 0.2, "expect": {"state": ["typing"], "values": {"dot.y": 0, "halo.opacity": 0}, "looping": True}},
        {"t": 0.35, "expect": {"values": {"dot.y": typing_at(0.35)}}},
        {"t": 0.6, "expect": {"values": {"dot.y": -6, "halo.opacity": 1}}},
        {"t": 0.75, "expect": {"values": {"dot.y": -3, "halo.opacity": 0.5}}},
        {"t": 1.65, "expect": {"values": {"dot.y": typing_at(1.65)}}},
    ]
    # Re-entering folds the running offset into the motion and starts the loop again from 0.
    again = 1.7
    offset, rate = loop_offset(pulse, 1.2, 0.2, enter, again)
    steps.append({"t": again, "send": "host.typing"})
    y = Prop(0)
    y.handoff(offset, rate, 0, spring(0.25, 0), again)
    for t in (1.75, 1.85, 2.0):
        steps.append({"t": t, "expect": {"values": {"dot.y": round(y.value(t) + loop_offset(pulse, 1.2, 0.2, again, t)[0], 9)}}})
    # Leaving for a state that sets a new target: the displayed value and velocity carry over.
    sent = 2.1
    y.advance(sent)
    offset, rate = loop_offset(pulse, 1.2, 0.2, again, sent)
    steps.append({"t": sent, "send": "host.sent"})
    z = Prop(0)
    z.handoff(y.pos[0] + offset, y.vel[0] + rate, -10, spring(0.25, 0), sent)
    for t in (2.15, 2.3, 2.6):
        steps.append({"t": t, "expect": {"state": ["sent"], "values": {"dot.y": z.value(t)}, "looping": False}})
    write("loop-keyframes", {
        "conformance": "0.10",
        "name": "Loop: keyframes with a delay, a map reading the looping value, re-entry restarts from 0, leaving hands off to a new target",
        "doc": TYPING,
        "steps": steps,
    })

    sweep = lambda width, t: round(loop_offset([(1.0, width)], 1, 0, 0, t, EASES["in-out"])[0], 9)
    write("loop-measured", {
        "conformance": "0.10",
        "name": "Loop: a starting state loops from time 0; a measured end holds the offset at 0 until layout, then follows relayout",
        "doc": SHIMMER,
        "steps": [
            {"t": 0, "expect": {"state": ["loading"], "values": {"highlight.x": 0}, "looping": True, "resting": True}},
            {"t": 0.1, "expect": {"values": {"highlight.x": 0}}},
            {"t": 0.2, "input": "track.layout.width", "value": 200},
            {"t": 0.3, "expect": {"values": {"highlight.x": sweep(200, 0.3)}}},
            {"t": 0.5, "input": "track.layout.width", "value": 100},
            {"t": 0.55, "expect": {"values": {"highlight.x": sweep(100, 0.55)}}},
            {"t": 1.3, "expect": {"values": {"highlight.x": sweep(100, 1.3)}}},
            {"t": 1.4, "send": "host.loaded"},
            {"t": 1.4, "expect": {"state": ["loaded"], "looping": False}},
        ],
    })


def validation_v10_cases():
    def doc():
        return json.loads(json.dumps(SPINNER))

    loop = "/states/busy/loop/spinner.rotation"
    out = []
    d = doc(); d["nudg"] = "0.9"
    out.append(("needs-version", d, [("needs-version", "/states/busy/loop")]))
    d = doc(); del d["states"]["busy"]["loop"]["spinner.rotation"]["to"]
    out.append(("no-motion", d, [("invalid-loop", loop)]))
    d = doc(); del d["states"]["busy"]["loop"]["spinner.rotation"]["duration"]
    out.append(("missing-duration", d, [("missing-duration", loop)]))
    d = doc(); d["states"]["busy"]["loop"]["spinner.rotation"]["duration"] = 0
    out.append(("duration", d, [("invalid-value", loop + "/duration")]))
    d = doc(); d["states"]["busy"]["loop"]["spinner.rotation"]["delay"] = -1
    out.append(("delay", d, [("invalid-value", loop + "/delay")]))
    d = doc(); d["states"]["busy"]["loop"]["spinner.rotation"]["wrap"] = 0
    out.append(("wrap", d, [("invalid-value", loop + "/wrap")]))
    d = doc(); d["states"]["busy"]["loop"]["spinner.rotation"]["keyframes"] = [{"at": 1, "value": 10}]
    out.append(("keyframe-time", d, [("invalid-keyframe-time", loop + "/keyframes/0/at")]))
    d = doc(); d["values"]["spinner.color"] = "#000000"; d["states"]["busy"]["loop"]["spinner.color"] = {"to": 1, "duration": 1}
    out.append(("color", d, [("loop-not-numeric", "/states/busy/loop/spinner.color")]))
    d = doc(); d["states"]["busy"]["follow"] = {"spinner.rotation": "host.angle"}
    out.append(("follow-conflict", d, [("loop-conflict", loop)]))
    d = doc(); d["values"]["spinner.scale"] = {"map": "spinner.rotation", "from": [0, 360], "to": [1, 2]}; d["states"]["busy"]["loop"]["spinner.scale"] = {"to": 1, "duration": 1}
    out.append(("mapped", d, [("mapped-property", "/states/busy/loop/spinner.scale")]))
    d = {
        "nudg": "0.10",
        "targets": ["dot"],
        "values": {"dot.y": 0},
        "regions": {
            "a": {"initial": "on", "states": {"on": {"loop": {"dot.y": {"to": 4, "duration": 1}}}}},
            "b": {"initial": "on", "states": {"on": {"loop": {"dot.y": {"to": -4, "duration": 1}}}}},
        },
    }
    out.append(("region-conflict", d, [("region-conflict", "/regions/b")]))
    write("validation-0.10", {
        "conformance": "0.10",
        "name": "Validator (0.10): loops",
        "documents": [{"name": n, "doc": dd, "errors": [{"code": c, "path": pp} for c, pp in e]} for n, dd, e in out],
    })


# --- v0.11: measured map values --------------------------------------------

STACK = {
    "nudg": "0.11",
    "targets": ["screen", "previous"],
    "values": {
        "screen.x": {"measure": "screen.width"},
        "previous.x": {
            "map": "screen.x",
            "from": [0, {"measure": "screen.width"}],
            "to": [{"measure": "screen.width", "times": -0.3}, 0],
        },
    },
    "animate": {"screen.x": spring_json(0.35, 0)},
    "initial": "pushed",
    "states": {
        "pushed": {"set": {"screen.x": 0}, "when": {"screen.dragstart": "dragging"}},
        "popped": {},
        "dragging": {
            "follow": {"screen.x": {"input": "screen.drag.x", "range": [0, {"measure": "screen.width"}]}},
            "when": {"screen.dragend": {"nearest": ["pushed", "popped"], "by": "screen.x"}},
        },
    },
}


def measured_map_value_cases():
    x = Prop(150)
    x.handoff(150, 0, 200, spring(0.35, 0), 0.4)
    parallax = lambda sx: round(-60 + 60 * sx / 200, 9)
    steps = [
        # Before layout the map holds its compiled base: the first numeric value, 0.
        {"t": 0, "expect": {"state": ["pushed"], "values": {"screen.x": 0, "previous.x": 0}}},
        {"t": 0.1, "input": "screen.layout.width", "value": 300},
        {"t": 0.1, "expect": {"values": {"screen.x": 0, "previous.x": -90}}},
        {"t": 0.2, "send": "screen.dragstart"},
        {"t": 0.25, "input": "screen.drag.x", "value": 150},
        {"t": 0.25, "expect": {"state": ["dragging"], "values": {"screen.x": 150, "previous.x": -45}}},
        # Relayout moves the measured value without restarting the drag.
        {"t": 0.3, "input": "screen.layout.width", "value": 200},
        {"t": 0.3, "expect": {"values": {"screen.x": 150, "previous.x": -15}}},
        {"t": 0.4, "send": "screen.dragend"},
    ]
    for t in (0.5, 0.7, 1.5):
        sx = x.value(t)
        steps.append({"t": t, "expect": {"state": ["popped"], "values": {"screen.x": sx, "previous.x": parallax(sx)}}})
    write("measured-map-values", {
        "conformance": "0.11",
        "name": "Measured map values: to resolves in the mapped property's coordinates, holds the compiled base until layout, and tracks relayout",
        "doc": STACK,
        "steps": steps,
    })


def validation_v11_cases():
    def doc():
        return json.loads(json.dumps(STACK))

    out = []
    d = doc(); d["nudg"] = "0.10"
    out.append(("needs-version", d, [("needs-version", "/values/previous.x/to/0")]))
    d = doc(); d["values"]["previous.x"]["to"][0] = {"measure": "missing.width"}
    out.append(("unknown-target", d, [("unknown-target", "/values/previous.x/to/0/measure")]))
    d = doc(); d["values"]["previous.color"] = {"map": "screen.x", "from": [0, 100], "to": [{"measure": "screen.width"}, "#000000"]}
    out.append(("color", d, [("invalid-measure", "/values/previous.color/to/0")]))
    write("validation-0.11", {
        "conformance": "0.11",
        "name": "Validator (0.11): measured map values",
        "documents": [{"name": n, "doc": dd, "errors": [{"code": c, "path": pp} for c, pp in e]} for n, dd, e in out],
    })


def rest_time(prop, motion, start, limit=5.0, step=1e-3):
    """When a spring comes to rest: its remaining amplitude, position and velocity
    together (sqrt(x^2 + v^2 m/k)), drops below the rest threshold. Energy never grows."""
    _, k, _, m = motion
    t = start
    while t < limit:
        t += step
        prop.advance(t)
        if math.hypot(prop.pos[0] - prop.target[0], prop.vel[0] * math.sqrt(m / k)) < REST_NUMBER:
            return t
    raise ValueError("never rests")


def rest_cases():
    doc = {
        "nudg": "0.7",
        "targets": ["toast"],
        "values": {"toast.y": 12, "toast.opacity": 0, "toast.scale": {"map": "host.level", "from": [0, 1], "to": [1, 1.2]}},
        "animate": {"toast.y": spring_json(0.4, 0.2), "toast.opacity": {"tween": {"duration": 0.2, "ease": "linear"}}},
        "initial": "hidden",
        "when": {"host.show": "shown"},
        "states": {
            "hidden": {},
            "shown": {
                "set": {"toast.y": 0, "toast.opacity": 1},
                "when": {"after:2s": {"to": "hidden", "pause": [{"on": "toast.hoverstart", "off": "toast.hoverend"}]}},
            },
        },
    }
    s = spring(0.4, 0.2)
    y = Prop(12)
    y.retarget(0, s, 0.1)
    shown = rest_time(y, s, 0.1)
    assert shown + 0.05 < 1.05, shown
    # Hover pauses the timer from 1.1 to 1.3, so it fires at 0.1 + 2 + 0.2 = 2.3.
    y = Prop(0)
    y.retarget(12, s, 2.3)
    hidden = rest_time(y, s, 2.3)
    ms = lambda t: round(t, 3)
    steps = [
        {"t": 0, "expect": {"resting": True, "settled": True}},
        {"t": 0.1, "send": "host.show"},
        {"t": 0.2, "expect": {"state": ["shown"], "resting": False, "settled": False}},
        # A tween rests exactly at its duration; the spring is still moving.
        {"t": 0.31, "expect": {"values": {"toast.opacity": 1}, "resting": False}},
        {"t": ms(shown - 0.05), "expect": {"resting": False}},
        # At rest while the dismiss timer runs: resting, but not settled.
        {"t": ms(shown + 0.05), "expect": {"resting": True, "settled": False}},
        # A value mapped from an app input jumps with it; that is never motion.
        {"t": 1.05, "input": "host.level", "value": 1},
        {"t": 1.05, "expect": {"values": {"toast.scale": 1.2}, "resting": True}},
        # A paused timer doesn't keep the runtime awake.
        {"t": 1.1, "send": "toast.hoverstart"},
        {"t": 1.2, "expect": {"resting": True, "settled": True}},
        {"t": 1.3, "send": "toast.hoverend"},
        {"t": 1.4, "expect": {"resting": True, "settled": False}},
        {"t": 2.35, "expect": {"state": ["hidden"], "resting": False, "settled": False}},
        {"t": ms(hidden - 0.05), "expect": {"resting": False}},
        {"t": ms(hidden + 0.05), "expect": {"resting": True, "settled": True}},
    ]
    write("rest", {
        "conformance": "0.7",
        "name": "Rest: springs rest when their remaining amplitude is below 0.001, tweens at their duration; inputs never move; resting ignores timers, settled waits for unpaused ones",
        "doc": doc,
        "steps": steps,
    })


if __name__ == "__main__":
    toggle_cases()
    spring_form_cases()
    kick_cases()
    machine_cases()
    tween_cases()
    validation_cases()
    drag_cases()
    tabs_cases()
    validation_v02_cases()
    timer_cases()
    step_commit_cases()
    commit_moving_case()
    reduced_motion_cases()
    validation_v03_cases()
    layout_cases()
    validation_v04_cases()
    continuous_input_cases()
    validation_v05_cases()
    layout_arithmetic_cases()
    validation_v06_cases()
    pausable_timer_cases()
    validation_v07_cases()
    keyframe_cases()
    validation_v08_cases()
    measured_endpoint_cases()
    validation_v09_cases()
    loop_cases()
    validation_v10_cases()
    measured_map_value_cases()
    validation_v11_cases()
    rest_cases()
    print("wrote", ", ".join(sorted(f for f in os.listdir(HERE) if f.endswith(".json"))))
