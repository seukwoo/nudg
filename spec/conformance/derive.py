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


if __name__ == "__main__":
    toggle_cases()
    spring_form_cases()
    kick_cases()
    machine_cases()
    tween_cases()
    validation_cases()
    print("wrote", ", ".join(sorted(f for f in os.listdir(HERE) if f.endswith(".json"))))
