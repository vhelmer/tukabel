"""Deterministic, quiet original PCM soundscapes; Python standard library only."""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
ROOT = Path(__file__).resolve().parents[1] / 'src/assets/ambience'
ROOT.mkdir(parents=True, exist_ok=True)


def render(name, duration, seed, wind=0, birds=(), knocks=(), drops=(), notes=()):
    rng = random.Random(seed)
    samples = []
    low = 0.0
    total = round(duration * RATE)
    for i in range(total):
        t = i / RATE
        low = 0.985 * low + 0.015 * rng.uniform(-1, 1)
        value = wind * low * (0.65 + 0.35 * math.sin(2 * math.pi * t / duration) ** 2)
        for start, length, freq in birds:
            d = t - start
            if 0 <= d < length:
                value += 0.022 * math.sin(math.pi * d / length) ** 2 * math.sin(2 * math.pi * (freq * d + 500 * d * d)) * (0.6 + 0.4 * math.sin(2 * math.pi * 16 * d))
        for start, freq in knocks:
            d = t - start
            if 0 <= d < 0.4:
                value += 0.045 * math.exp(-d * 24) * (math.sin(2 * math.pi * freq * d) + 0.3 * rng.uniform(-1, 1))
        for start in drops:
            d = t - start
            if 0 <= d < 1.0:
                value += 0.028 * math.exp(-d * 8) * math.sin(2 * math.pi * (980 * d - 180 * d * d))
                value += 0.012 * math.exp(-d * 6) * math.sin(2 * math.pi * 1470 * d)
        for start, freq, length in notes:
            d = t - start
            if 0 <= d < length:
                value += 0.05 * (1 - math.exp(-d * 30)) * math.exp(-d * 2.8) * math.sin(math.pi * d / length) * (math.sin(2 * math.pi * freq * d) + 0.2 * math.sin(4 * math.pi * freq * d))
        # Silence at the seam prevents a click when the HTMLAudio loop wraps.
        fade = min(1, t / 0.12, (duration - t) / 0.12)
        samples.append(struct.pack('<h', round(max(-1, min(1, value * fade)) * 32767)))
    with wave.open(str(ROOT / (name + '.wav')), 'wb') as output:
        output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        output.writeframes(b''.join(samples))


render('village', 14, 1, wind=0.15, birds=[(2.2, .33, 2100), (2.7, .22, 2400), (8.6, .4, 1900), (10.1, .25, 2600)])
render('tavern', 14, 2, wind=0.025, knocks=[(2.4, 220), (2.65, 310), (7.8, 160), (11.6, 260)])
render('graveyard', 14, 3, wind=0.20, birds=[(4.2, .8, 390), (5.3, .6, 350)])
render('barn', 14, 4, wind=0.08, knocks=[(3.5, 125), (9.2, 150)], birds=[(6.4, .2, 3200), (6.9, .2, 3200)])
render('crypt', 14, 5, wind=0.035, drops=[2.4, 5.7, 6.3, 11.1])
render('ending', 14, 6, notes=[(1, 261.63, 2), (2, 329.63, 2), (3, 392, 2.5), (5, 523.25, 3), (8, 392, 2), (9, 329.63, 2), (10, 261.63, 3)])
render('pickup', .5, 7, notes=[(.01, 659.25, .35)])
render('combine', .65, 8, knocks=[(.02, 350), (.16, 440)], notes=[(.20, 523.25, .4)])
render('travel', .65, 9, wind=.2, knocks=[(.04, 110), (.25, 130), (.43, 100)])
