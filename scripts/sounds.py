"""Synthesizes the examples' sound effects, so they are the project's own: no samples from elsewhere.

Run: python3 scripts/sounds.py  (writes examples/sounds/*.wav)
"""
import math
import os
import random
import struct
import wave

RATE = 22050
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "examples", "sounds")


def write(name, samples):
    peak = max(1e-9, max(abs(s) for s in samples))
    with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(32000 * 0.8 * s / peak)) for s in samples))


def env(t, attack, decay):
    return min(1.0, t / attack) * math.exp(-t / decay) if attack > 0 else math.exp(-t / decay)


def pop():
    # A pitch that drops fast: a bubble popping.
    out, phase = [], 0.0
    for i in range(int(RATE * 0.12)):
        t = i / RATE
        f = 320 + 520 * math.exp(-t / 0.018)
        phase += 2 * math.pi * f / RATE
        out.append(math.sin(phase) * env(t, 0.002, 0.03))
    return out


def tick():
    # A short, bright click, like a switch.
    out = []
    for i in range(int(RATE * 0.05)):
        t = i / RATE
        out.append((math.sin(2 * math.pi * 1900 * t) * 0.7 + math.sin(2 * math.pi * 3700 * t) * 0.3) * env(t, 0.0005, 0.006))
    return out


def burst():
    # A soft noise puff, then a two-note sparkle.
    rnd = random.Random(7)
    out, low = [], 0.0
    for i in range(int(RATE * 0.55)):
        t = i / RATE
        low += (rnd.uniform(-1, 1) - low) * 0.25
        noise = low * env(t, 0.003, 0.05)
        sparkle = sum(math.sin(2 * math.pi * f * t) * env(max(0.0, t - d), 0.002, 0.12) * (t >= d) for f, d in ((1318.5, 0.04), (1760.0, 0.1), (2637.0, 0.16)))
        out.append(noise * 0.9 + sparkle * 0.35)
    return out


def heart():
    # A rounder pop with a soft octave above: a like.
    out, phase = [], 0.0
    for i in range(int(RATE * 0.25)):
        t = i / RATE
        f = 440 + 300 * math.exp(-t / 0.02)
        phase += 2 * math.pi * f / RATE
        out.append((math.sin(phase) + 0.3 * math.sin(2 * phase)) * env(t, 0.003, 0.06))
    return out


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, make in (("pop", pop), ("tick", tick), ("burst", burst), ("heart", heart)):
        write(name, make())
    print("wrote", ", ".join(sorted(os.listdir(OUT))))
