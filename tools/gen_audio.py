#!/usr/bin/env python3
"""Colony Sim — generate game audio (BGM + SFX) as WAV files.

Synthesizes everything with the Python standard library (wave/math/random).
Output goes to public/audio/. All clips are peak-normalized to stay below
-1 dBFS (with the master intended to sit well under though; individual SFX are
kept quieter so they sum without hard clipping in the game — see audio-design:
"leave headroom; mix in dB").

Run:  python tools/gen_audio.py
"""
import math
import random
import struct
import wave
import os

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "audio")

# session-scoped RNG so audio differs slightly run-to-run but stays stable
rng = random.Random(1337)

def midi(n):  # MIDI note -> frequency Hz
    return 440.0 * (2.0 ** ((n - 69) / 12.0))

# ---------------- low-level building blocks ----------------

def sine(f, t, ph=0.0):
    return math.sin(2 * math.pi * f * t + ph)

def square(f, t, ph=0.0):
    s = 2 * ((f * t + ph / (2 * math.pi)) % 1.0) - 1.0
    return 1.0 if s >= 0 else -1.0

def saw(f, t, ph=0.0):
    return 2 * ((f * t + ph / (2 * math.pi)) % 1.0) - 1.0

def tri(f, t, ph=0.0):
    s = 2 * ((f * t + ph / (2 * math.pi)) % 1.0) - 1.0
    return 2 * abs(s) - 1.0 if s >= 0 else 2 * abs(s) - 1.0  # approx, fine

def env_ar(t, start, dur, attack=0.005, release=None):
    """exponential-ish AD attack + linear/release; returns gain in [0,1]."""
    release = dur - attack if release is None else release
    rel_start = dur - release
    if t < start:
        return 0.0
    tt = t - start
    a = min(1.0, tt / max(attack, 1e-6))
    if tt < rel_start:
        return a
    r = 1.0 - (tt - rel_start) / max(release, 1e-6)
    return max(0.0, min(1.0, r)) * a

def noise_burst(dur, freq_from=2000.0, freq_to=200.0, q=1.0, curve='lp'):
    """One percussive noise hit with a sweeping resonant filter. Returns samples."""
    n = int(dur * SR)
    out = []
    for i in range(n):
        t = i / SR
        # white noise
        w = rng.random() * 2 - 1
        # swept center frequency (exp)
        fc = freq_to * (freq_from / freq_to) ** (t / dur) if dur > 0 else freq_from
        fc = max(30.0, fc)
        # very cheap single-pole/serial resonators -> band-ish
        # a simple resonant lowpass via two cascaded 1st-order with variable cutoff
        out.append(w)
    # cheap dc-ish high pass to reduce rumble below 60Hz
    return out

class Osc:
    def __init__(self, kind='sine', base=440.0, phase=0.0):
        self.kind = kind
        self.base = base
        self.phase = phase
        self.freq = base

def render_mix(voices, total):
    """voices: list of (sample, gain_db, pan_mono). total = length in samples."""
    buf = [0.0] * total
    for samples, gain_db in voices:
        g = 10 ** (gain_db / 20)
        for i in range(min(total, len(samples))):
            buf[i] += samples[i] * g
    return buf

def peak_norm(buf, target_db=-3.0):
    m = max((abs(x) for x in buf), default=0.0)
    if m <= 1e-9:
        return buf
    target = 10 ** (target_db / 20)
    k = target / m
    return [x * k for x in buf]

def write_wav(name, samples, sr=SR):
    """samples: list of floats in [-1,1]. 16-bit PCM mono."""
    path = os.path.join(OUT, name)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = bytearray()
        for x in samples:
            v = max(-1.0, min(1.0, x))
            frames += struct.pack('<h', int(v * 32767))
        w.writeframes(bytes(frames))
    print(" wrote %8.2fs  %s" % (len(samples) / sr, name))

def snd(*, dur, headroom_db=-6.0):
    """Decorator-free: assemble voices list into normalized samples."""
    pass

def make_sfx(dur, gb, build):
    """build(add: (samples, gain_db)) """
    N = int(dur * SR)
    return build, N, gb

# =================== SFX builders ===================

def chop():
    N = int(0.24 * SR)
    r = rng.uniform(0.94, 1.06)
    buf = [0.0] * N
    # resonant noise knock (band-ish) via filtered noise
    for i in range(N):
        t = i / SR
        w = rng.random() * 2 - 1
        fc = 300 + 700 * math.exp(-t / 0.05)   # fast drop 1000->300
        # single-pole lowpass then subtract lowpass to approx band
        acc = 0.0
        # approximate bandpass: difference of two lowpasses
        alpha = 1.0 - math.exp(-2 * math.pi * fc / SR)
        prev = 0.0
        # simple 2-pole-ish
    buf = [0.0] * N
    lp1 = 0.0
    lp2 = 0.0
    for i in range(N):
        t = i / SR
        w = rng.random() * 2 - 1
        fc = 900 * math.exp(-t / 0.05) + 120
        alpha = 1.0 - math.exp(-2 * math.pi * fc / SR)
        lp1 += alpha * (w - lp1)
        lp2 += alpha * (lp1 - lp2)   # lowpass->lowpass ~ second order
        # band-ish: difference of lp2 and a higher one
        hp = w - lp2
        buf[i] = hp * math.exp(-t / 0.06)
    # woody body: damped low triangle thock
    for i in range(N):
        t = i / SR
        f = 140 * math.exp(-t / 0.12) + 60
        buf[i] += sine(f, t) * math.exp(-t / 0.08) * 0.6
    return peak_norm(buf, -8.0)

def mine():
    N = int(0.26 * SR)
    buf = [0.0] * N
    lp1 = 0.0
    lp2 = 0.0
    for i in range(N):
        t = i / SR
        w = rng.random() * 2 - 1
        fc = 2000 * math.exp(-t / 0.04) + 200
        alpha = 1.0 - math.exp(-2 * math.pi * fc / SR)
        lp1 += alpha * (w - lp1)
        lp2 += alpha * (lp1 - lp2)
        buf[i] = lp2 * math.exp(-t / 0.05) * 1.2
    # metallic-ish resonant thunk
    for i in range(N):
        t = i / SR
        f = 90 + 40 * math.exp(-t / 0.1)
        buf[i] += saw(f, t) * math.exp(-t / 0.07) * 0.4
        buf[i] += sine(f * 2.4, t) * math.exp(-t / 0.05) * 0.3
    return peak_norm(buf, -8.0)

def forage():
    N = int(0.22 * SR)
    buf = [0.0] * N
    lp1 = 0.0
    for i in range(N):
        t = i / SR
        w = rng.random() * 2 - 1
        fc = 3000 * math.exp(-t / 0.05) + 500
        alpha = 1.0 - math.exp(-2 * math.pi * fc / SR)
        lp1 += alpha * (w - lp1)
        buf[i] = lp1 * math.exp(-t / 0.08) * 0.7
    # bright little pluck
    for i in range(N):
        t = i / SR
        f = midi(79)  # G5
        buf[i] += sine(f, t) * math.exp(-t / 0.09) * 0.5
        buf[i] += sine(midi(84), t) * math.exp(-t / 0.08) * 0.4
    return peak_norm(buf, -9.0)

def hammer():
    N = int(0.18 * SR)
    buf = [0.0] * N
    lp1 = 0.0
    for i in range(N):
        t = i / SR
        w = rng.random() * 2 - 1
        fc = 1500 * math.exp(-t / 0.03) + 300
        alpha = 1.0 - math.exp(-2 * math.pi * fc / SR)
        lp1 += alpha * (w - lp1)
        buf[i] = (w - lp1) * math.exp(-t / 0.05)  # highpass-ish snap
    for i in range(N):
        t = i / SR
        buf[i] += tri(200, t) * math.exp(-t / 0.04) * 0.6
        buf[i] += sine(150, t) * math.exp(-t / 0.05) * 0.5
    return peak_norm(buf, -8.0)

def build_done():
    dur = 0.8
    N = int(dur * SR)
    buf = [0.0] * N
    # warm major arpeggio C5 E5 G5 (builder's 'done!')
    notes = [60, 64, 67, 72]
    t0 = 0.0
    for k, n in enumerate(notes):
        start = t0 + k * 0.09
        f = midi(n)
        for i in range(N):
            t = i / SR
            if t < start:
                continue
            e = env_ar(t, start, 0.5, attack=0.01, release=0.4)
            buf[i] += tri(f, t - start) * e * 0.5
            buf[i] += sine(f * 2, t - start) * e * 0.2
    return peak_norm(buf, -5.0)

def cook_sizzle():
    dur = 0.5
    N = int(dur * SR)
    buf = [0.0] * N
    # several sharp high-frequency crackle puffs
    for _ in range(14):
        start = rng.uniform(0, dur - 0.05)
        plen = rng.uniform(0.008, 0.025)
        base = int(start * SR)
        for j in range(int(plen * SR)):
            idx = base + j
            if 0 <= idx < N:
                buf[idx] += (rng.random() * 2 - 1) * (1 - j / (plen * SR)) * 0.7
    # gentle hiss bed shaped by HP
    lp1 = 0.0
    for i in range(N):
        t = i / SR
        w = rng.random() * 2 - 1
        fc = 4000
        alpha = 1.0 - math.exp(-2 * math.pi * fc / SR)
        lp1 += alpha * (w - lp1)
        buf[i] += (w - lp1) * math.exp(-t / (dur * 0.5)) * 0.25
    return peak_norm(buf, -9.0)

def meal_ready():
    dur = 0.7
    N = int(dur * SR)
    buf = [0.0] * N
    # friendly rising two-note + octave confirmation
    for k, n in enumerate([67, 72, 76]):
        start = k * 0.11
        f = midi(n)
        for i in range(N):
            t = i / SR
            if t < start:
                continue
            e = env_ar(t, start, 0.6, 0.01, 0.5)
            buf[i] += sine(f, t - start) * e * 0.55
            buf[i] += sine(f * 2, t - start) * e * 0.25
    return peak_norm(buf, -6.0)

def eat():
    dur = 0.3
    N = int(dur * SR)
    buf = [0.0] * N
    # two short muffled 'nom'
    for bite in range(2):
        start = bite * 0.13
        base = int(start * SR)
        blen = int(0.06 * SR)
        for j in range(blen):
            idx = base + j
            if 0 <= idx < N:
                envv = env_ar(j / SR, 0, 0.06, 0.008, 0.05)
                buf[idx] += (rng.random() * 2 - 1) * envv * 0.5
    # damp, low body
    for i in range(N):
        t = i / SR
        buf[i] += sine(120 + rng.uniform(-15, 15), t) * math.exp(-t / 0.05) * 0.3
    return peak_norm(buf, -8.0)

def pickup():
    dur = 0.16
    N = int(dur * SR)
    buf = [0.0] * N
    # bright upward sweeps
    for i in range(N):
        t = i / SR
        f = midi(72) * (1 + 0.4 * (1 - math.exp(-t / 0.05)))
        buf[i] += sine(f, t) * env_ar(t, 0, dur, 0.005, 0.12) * 0.6
        buf[i] += sine(f * 2, t) * env_ar(t, 0, dur, 0.005, 0.1) * 0.25
    return peak_norm(buf, -8.0)

def drop():
    dur = 0.2
    N = int(dur * SR)
    buf = [0.0] * N
    lp1 = 0.0
    for i in range(N):
        t = i / SR
        w = rng.random() * 2 - 1
        fc = 800 * math.exp(-t / 0.04) + 200
        alpha = 1.0 - math.exp(-2 * math.pi * fc / SR)
        lp1 += alpha * (w - lp1)
        buf[i] = lp1 * math.exp(-t / 0.06) * 0.8
    for i in range(N):
        t = i / SR
        buf[i] += sine(150, t) * math.exp(-t / 0.05) * 0.5
    return peak_norm(buf, -8.0)

def footstep():
    dur = 0.07
    N = int(dur * SR)
    buf = [0.0] * N
    lp1 = 0.0
    for i in range(N):
        t = i / SR
        w = rng.random() * 2 - 1
        fc = 500 * math.exp(-t / 0.01) + 80
        alpha = 1.0 - math.exp(-2 * math.pi * fc / SR)
        lp1 += alpha * (w - lp1)
        buf[i] = lp1 * math.exp(-t / 0.03) * 1.2
    return peak_norm(buf, -14.0)  # quiet

def ui_click():
    dur = 0.05
    N = int(dur * SR)
    buf = [0.0] * N
    for i in range(N):
        t = i / SR
        buf[i] += square(900, t) * env_ar(t, 0, dur, 0.002, 0.045) * 0.35
    return peak_norm(buf, -9.0)

def ui_error():
    dur = 0.22
    N = int(dur * SR)
    buf = [0.0] * N
    for i in range(N):
        t = i / SR
        f = 220 * (0.6 + 0.4 * math.exp(-t / 0.1))
        buf[i] += square(f, t) * env_ar(t, 0, dur, 0.004, 0.18) * 0.4
    return peak_norm(buf, -6.0)

def buy():
    dur = 0.25
    N = int(dur * SR)
    buf = [0.0] * N
    for k, n in enumerate([72, 79, 84]):
        start = k * 0.05
        f = midi(n)
        for i in range(N):
            t = i / SR
            if t < start:
                continue
            e = env_ar(t, start, 0.25, 0.005, 0.2)
            buf[i] += sine(f, t - start) * e * 0.5
            buf[i] += square(f, t - start) * e * 0.18
    return peak_norm(buf, -6.0)

def threat():
    dur = 1.1
    N = int(dur * SR)
    buf = [0.0] * N
    # deep impact on downbeat
    lp1 = 0.0
    for i in range(N):
        t = i / SR
        w = rng.random() * 2 - 1
        fc = 1500 * math.exp(-t / 0.03) + 150
        alpha = 1.0 - math.exp(-2 * math.pi * fc / SR)
        lp1 += alpha * (w - lp1)
        buf[i] = lp1 * math.exp(-t / 0.15) * 1.4
    # descending tense saw ladder
    for k in range(4):
        start = k * 0.16
        base = k * 100 + 260
        for i in range(N):
            t = i / SR
            if t < start:
                continue
            e = env_ar(t, start, 0.3, 0.03, 0.26)
            f = base * (1 - 0.35 * (t - start) / 0.3)
            buf[i] += saw(f, t - start) * e * 0.4
            buf[i] += square(f * 0.5, t - start) * e * 0.3
    return peak_norm(buf, -4.0)

def command_fx():
    dur = 0.3
    N = int(dur * SR)
    buf = [0.0] * N
    for k, n in enumerate([72, 76]):
        start = k * 0.05
        f = midi(n)
        for i in range(N):
            t = i / SR
            if t < start:
                continue
            e = env_ar(t, start, 0.3, 0.005, 0.28)
            buf[i] += sine(f, t - start) * e * 0.55
            buf[i] += sine(f * 2, t - start) * e * 0.2
    return peak_norm(buf, -5.0)

def daybreak():
    dur = 1.4
    N = int(dur * SR)
    buf = [0.0] * N
    # gentle rising warm triad (C major add9 feel)
    notes = [48, 52, 55, 59, 64, 67]
    for k, n in enumerate(notes):
        start = k * 0.12
        f = midi(n)
        fade = math.exp(-k * 0.08)
        for i in range(N):
            t = i / SR
            if t < start:
                continue
            e = env_ar(t, start, 1.4, 0.3, 1.3)
            buf[i] += sine(f, t - start) * e * 0.45 * (0.4 + 0.6 * fade)
            buf[i] += tri(f * 2, t - start) * e * 0.18
    return peak_norm(buf, -8.0)

def nightfall():
    dur = 1.6
    N = int(dur * SR)
    buf = [0.0] * N
    # low ambient drone + a few crickets
    for i in range(N):
        t = i / SR
        buf[i] += sine(midi(33), t) * env_ar(t, 0, dur, 1.0, 1.6 - 1.0) * 0.5
        buf[i] += sine(midi(28), t) * env_ar(t, 0, dur, 1.2, 1.6 - 1.2) * 0.35
    # crickets: crisp bright square ticks
    for _ in range(6):
        start = rng.uniform(0.6, 1.3)
        for i in range(N):
            t = i / SR
            if start <= t <= start + 0.05:
                f = midi(rng.choice([84, 85, 89]))
                buf[i] += square(f, t - start) * 0.16
    return peak_norm(buf, -8.0)

# =================== BGM ===================

SRB = 22050                 # BGM render rate (enough for warm timbres, half CPU)

# ---------------------------------------------------------------------------
#  Organic / "little village slowly running" instrument voices:
#  wooden guitar, warm piano, soft bass, hand-drum & small percussion, soft pad.
#  Everything renders at SRB=22050 to keep generation fast.
# ---------------------------------------------------------------------------

def piano_note(buf, start, mid, dur, gain=0.9):
    """Warm upright piano: slight detuned string pairs, overtone stack + bell.
    Fast attack, natural long-ish decay. Renders into buf at start (samples)."""
    f = midi(mid)
    N = len(buf)
    base = int(start * SRB)
    nn = int(dur * SRB)
    pie = 2 * math.pi
    for j in range(min(nn, max(0, N - base))):
        t = j / SRB
        idx = base + j
        if idx >= N:
            break
        a = min(1.0, t / 0.002)
        dec = math.exp(-t / (dur * 0.35 if dur > 0 else 1.0))
        e = a * dec if dec > 1e-4 else 0.0
        f1 = f * (1 + 0.0012)
        f2 = f * (1 - 0.0008)
        v = 0.0
        v += 0.55 * math.sin(pie * f1 * t)
        v += 0.5 * math.sin(pie * f2 * t) * math.exp(-t / (dur*0.15))
        v += 0.18 * math.sin(pie * f * 2 * t) * math.exp(-t / (dur*0.10))
        v += 0.09 * math.sin(pie * f * 3 * t) * math.exp(-t / (dur*0.07))
        v += 0.04 * math.sin(pie * f * 4 * t) * math.exp(-t / (dur*0.05))
        buf[idx] += v * e * gain

def guitar_note(buf, start, mid, dur=0.5, gain=0.9, bright=1.0):
    """Acoustic (nylon/wood) guitar: plucky attack, fast decay + overtone shimmer."""
    f = midi(mid)
    N = len(buf)
    base = int(start * SRB)
    nn = int(dur * SRB)
    pie = 2 * math.pi
    for j in range(min(nn, max(0, N - base))):
        t = j / SRB
        idx = base + j
        if idx >= N:
            break
        a = min(1.0, t / 0.0015)
        dec = math.exp(-t / (dur * 0.28))
        e = a * dec if dec > 1e-4 else 0.0
        v = 0.6 * math.sin(pie * f * t)
        v += 0.22 * math.sin(pie * f * 2 * t) * math.exp(-t / (dur*0.12))
        v += 0.10 * math.sin(pie * f * 3 * t) * math.exp(-t / (dur*0.08))
        v += 0.05 * math.sin(pie * f * 5.1 * t) * math.exp(-t / (dur*0.06))
        if t < 0.008 and j % 2 == 0:
            v += (rng.random()-0.5) * 0.08 * (1 - t/0.008)  # pick noise
        buf[idx] += v * e * gain * bright

def soft_bass(buf, start, mid, dur, gain=0.85):
    """Gentle fretless-style bass: sine + soft 2nd harmonic, slow attack."""
    f = midi(mid)
    N = len(buf)
    base = int(start * SRB)
    nn = int(dur * SRB)
    pie = 2 * math.pi
    for j in range(min(nn, max(0, N - base))):
        t = j / SRB
        idx = base + j
        if idx >= N:
            break
        a = min(1.0, t / 0.035)
        dec = math.exp(-t / (dur * 0.7))
        e = a * dec if dec > 1e-4 else 0.0
        v = math.sin(pie * f * t) + 0.16 * math.sin(pie * f * 2 * t) * math.exp(-t / (dur*0.3))
        buf[idx] += v * e * gain

def soft_pad(buf, start, mid, dur, gain=0.7):
    """Warm analog pad: detuned layers, slow swell, dreamy."""
    f = midi(mid)
    N = len(buf)
    base = int(start * SRB)
    nn = int(dur * SRB)
    pie = 2 * math.pi
    lay = [(1, 1.000, 0.5), (1, 1.004, 0.4), (0.5, 1.995, 0.22), (2, 2.0, 0.18)]
    for j in range(min(nn, max(0, N - base))):
        t = j / SRB
        idx = base + j
        if idx >= N:
            break
        a = min(1.0, max(0.0, (t - 0.02) / 0.25))
        r = min(1.0, max(0.0, (dur - t) / 0.3))
        e = a * r
        if e < 1e-4:
            e = 0.0
        v = 0.0
        for mult, det, amp in lay:
            v += amp * math.sin(pie * f * mult * det * t)
            v += amp * 0.35 * _tri_soft(f * mult * det * 0.5, t, pie)
        buf[idx] += v * e * gain * 0.5

def _tri_soft(f, t, pie):
    s = (f * t) % 1.0
    return abs(4 * s - 2.0) - 1.0

def handdrum(buf, start, gain=1.0):
    """Conga/djembe-ish hand drum: pitch-drop resonant body + skin slap."""
    N = len(buf)
    base = int(start * SRB)
    pie = 2 * math.pi
    nn = int(0.18 * SRB)
    for j in range(min(nn, max(0, N - base))):
        t = j / SRB
        idx = base + j
        if idx >= N:
            break
        f1 = 95 + 140 * math.exp(-t / 0.015)
        f2 = 190 + 160 * math.exp(-t / 0.02)
        v = math.sin(pie * f1 * t) + 0.4 * math.sin(pie * f2 * t)
        v += (rng.random()-0.5) * 0.4 * math.exp(-t / 0.006)  # skin slap noise
        e = math.exp(-t / 0.09) * min(1.0, t/0.001)
        buf[idx] += v * e * gain * 0.9

def shaker(buf, start, gain=0.9, dur=0.09):
    """Soft shaker: quiet high noise patch, decays quickly."""
    N = len(buf)
    base = int(start * SRB)
    nn = int(dur * SRB)
    lp = 0.0
    for j in range(min(nn, max(0, N - base))):
        t = j / SRB
        idx = base + j
        if idx >= N:
            break
        w = rng.random() * 2 - 1
        alpha = 1.0 - math.exp(-2 * math.pi * 3000 / SRB)
        lp += alpha * (w - lp)
        v = (w - lp)
        e = math.exp(-t / (dur*0.4)) * min(1.0, t/0.002)
        buf[idx] += v * e * gain * 0.5

def bell(buf, start, mid, dur=0.5, gain=0.7):
    """Tiny music-box / celeste note for gentle high sparkle."""
    f = midi(mid)
    N = len(buf)
    base = int(start * SRB)
    nn = int(dur * SRB)
    pie = 2 * math.pi
    for j in range(min(nn, max(0, N - base))):
        t = j / SRB
        idx = base + j
        if idx >= N:
            break
        e = math.exp(-t / (dur*0.3)) * min(1.0, t/0.002)
        v = math.sin(pie * f * t)
        v += 0.35 * math.sin(pie * f * 2.0 * t) * math.exp(-t/(dur*0.2))
        v += 0.12 * math.sin(pie * f * 4.35 * t) * math.exp(-t/(dur*0.08))
        buf[idx] += v * e * gain * 0.6

def lead_voice(buf, start, mid, dur=0.28, gain=0.7, bright=1.0):
    """Bright, slightly rounded lead (Terraria-style melody): a square blended
    with a sine for body, soft attack, quick decay. Cuts through the mix as the
    hummable main tune."""
    f = midi(mid)
    N = len(buf)
    base = int(start * SRB)
    nn = int(dur * SRB)
    pie = 2 * math.pi
    for j in range(min(nn, max(0, N - base))):
        t = j / SRB
        idx = base + j
        if idx >= N:
            break
        a = min(1.0, t / 0.004)
        dec = math.exp(-t / (dur * 0.5))
        e = a * dec if dec > 1e-4 else 0.0
        v = 0.55 * square(f, t)
        v += 0.4 * math.sin(pie * f * t)
        v += 0.7 * _tri_soft(f, t, pie)          # warmth
        v += 0.15 * math.sin(pie * f * 2 * t) * math.exp(-t / (dur*0.2))
        buf[idx] += v * e * gain * bright * 0.9

def kick(buf, start, gain=1.0):
    """Soft, round kick for the groove (Terraria daytime beat)."""
    N = len(buf)
    base = int(start * SRB)
    pie = 2 * math.pi
    nn = int(0.16 * SRB)
    for j in range(min(nn, max(0, N - base))):
        t = j / SRB
        idx = base + j
        if idx >= N:
            break
        f = 150 * math.exp(-t / 0.02) + 50
        v = math.sin(pie * f * t)
        v += (rng.random() - 0.5) * 0.3 * math.exp(-t / 0.004)
        e = math.exp(-t / 0.08) * min(1.0, t / 0.002)
        buf[idx] += v * e * gain

def strum(buf, start, chord_midis, dur=0.5, gain=0.5):
    """Full acoustic-guitar strum of a chord: all strings bloom together."""
    for i, f0 in enumerate(chord_midis):
        # stagger each string a tiny bit for a strum feel
        guitar_note(buf, start + i * 0.004, f0, dur=dur, gain=gain * 0.7)

def village_bgm(name, bpm, chords, target_db=-5.0, night=False, lead=None):
    """Compose a Terraria-inspired, melody-first BGM:
      - a clear, hummable **lead melody** (bright square+sine) on 8th grid,
      - a moving **bass** root that walks per beat,
      - strummed guitar chords + warm pad for harmonic body,
      - a lively kick + hand-drum + shaker groove,
      - sparse bells at night.

    chords: list of (root_midi, [scale_degrees(semitones above root)], [chord_tone_ints], beats_each)
    lead:   a list of (relative_midi_from_MIDI_60, dur_in_8ths or 0=rest) per 8th-step,
            defined once for the whole phrase (repeats over the chord cycle).
    Loops cleanly on the phrase/bar boundary (tapered tail).
    """
    spb = 60.0 / bpm
    eighth = spb / 2.0
    total_beats = sum(bp for (_, _, _, bp) in chords)
    dur = total_beats * spb + 0.6
    N = int(dur * SRB)
    buf = [0.0] * N

    # ---- precompute the full-8th-step timeline ----
    t = 0.0
    events = []              # (time, kind, payload)
    lead_index = 0           # global 8th counter, wraps over lead phrase
    lead_len = len(lead) if lead else 0
    for (rootm, steps, chord_tones, beats) in chords:
        ch_int = chord_tones if chord_tones else ([0, steps[0] if steps else 4, steps[-1] if steps else 7])
        chord_midi = [rootm + 12 + iv for iv in ch_int]

        # strings: strum the chord at each beat (full strum, open voicing)
        for b in range(beats):
            strum(buf, t + b * spb, chord_midi, dur=0.5, gain=0.55)

        # warm pad under everything
        soft_pad(buf, t, rootm, beats * spb, gain=0.5)
        if steps:
            soft_pad(buf, t + spb * 0.5, rootm + steps[0], beats * spb, gain=0.18)

        # bass: root every beat, moving to fifth on beats 0&2 of each half
        fifth = steps[-1] if steps else 7
        for b in range(beats):
            nn_ = rootm - 12 if b % 2 == 0 else rootm + fifth - 12
            soft_bass(buf, t + b * spb, nn_, spb * 0.95, gain=1.0)

        # kick on beats, handdrum on beat 3 offbeat, shaker 8ths
        for b in range(beats):
            kick(buf, t + b * spb, gain=0.8 if b % 2 == 0 else 0.5)
        for e in range(beats * 2):
            shaker(buf, t + e * eighth + eighth * 0.5, gain=0.45 if e % 2 == 0 else 0.28)
        handdrum(buf, t + spb * 2.5, gain=0.6)

        # night: dreaming bells, keep them gentle
        if night:
            bell(buf, t + spb * 1.2, rootm + 36, 1.2, gain=0.5)
            bell(buf, t + spb * 2.2, rootm + 38, 1.2, gain=0.4)

        # lead melody: step through 8ths within this chord
        n8 = beats * 2
        for k in range(n8):
            if lead and lead_len:
                rel, d8 = lead[lead_index % lead_len]
                lead_index += 1
                if d8 > 0:
                    st = t + k * eighth
                    ms = 60 + rel
                    lead_voice(buf, st, ms, dur=eighth * d8 * 1.2, gain=0.8 if night else 1.0)

        t += beats * spb

    # taper the very end so the loop has no click
    fade = int(0.3 * SRB)
    for i in range(fade):
        if N - fade + i < N:
            buf[N - fade + i] *= (i / fade) ** 0.7
    return peak_norm(buf, target_db)


def root_factor(root_midi):
    return midi(root_midi - 60)

def make_bgm_day():
    # Terraria-inspired daytime: bouncy, hummable lead over C G Am F.
    return village_bgm("bgm_day.wav", bpm=86,
        chords=[
            (48, [4, 7, 11], [0, 4, 7, 12], 4),   # C
            (43, [3, 7, 10], [0, 3, 7, 10], 4),   # G
            (45, [3, 7, 10], [0, 3, 7, 10], 4),   # Am
            (41, [4, 7, 11], [0, 4, 7, 12], 4),   # F
        ], target_db=-4.0, night=False,
        lead=[
            (4, 1), (0, 1), (4, 1), (7, 1), (7, 1), (4, 1), (0, 1), (2, 1),
            (2, 1), (-1, 1), (2, 1), (7, 1), (7, 1), (9, 1), (7, 1), (2, 1),
            (0, 1), (-3, 1), (0, 1), (4, 1), (4, 1), (5, 1), (4, 1), (0, 1),
            (-3, 1), (-7, 1), (-3, 1), (0, 1), (0, 1), (2, 1), (0, 1), (-3, 1),
        ])

def make_bgm_night():
    # Dreamier, sparser night: airy lead over Am F C G, soft bells + groove.
    return village_bgm("bgm_night.wav", bpm=66,
        chords=[
            (45, [3, 7, 10], [0, 3, 7, 12], 4),   # Am7
            (41, [4, 7, 11], [0, 4, 7, 12], 4),   # F maj7
            (48, [4, 7, 11], [0, 4, 7, 12], 4),   # Cmaj7
            (43, [3, 7, 10], [0, 3, 7, 10], 4),   # G6
        ], target_db=-5.5, night=True,
        lead=[
            (-3, 2), (0, 2), (4, 2), (7, 2),
            (-3, 2), (0, 2), (5, 2), (4, 2),
            (4, 2), (0, 2), (2, 2), (0, 2),
            (2, 2), (-1, 2), (-5, 2), (-3, 2),
        ])

def main():
    os.makedirs(OUT, exist_ok=True)
    sfx = {
        "chop.wav": chop, "mine.wav": mine, "forage.wav": forage,
        "hammer.wav": hammer, "build_done.wav": build_done,
        "cook_sizzle.wav": cook_sizzle, "meal_ready.wav": meal_ready,
        "eat.wav": eat, "pickup.wav": pickup, "drop.wav": drop,
        "footstep.wav": footstep, "ui_click.wav": ui_click,
        "ui_error.wav": ui_error, "buy.wav": buy, "threat.wav": threat,
        "command_fx.wav": command_fx, "daybreak.wav": daybreak,
        "nightfall.wav": nightfall,
    }
    for name, fn in sfx.items():
        write_wav(name, fn())
    print("== generating BGM ==")
    write_wav("bgm_day.wav", make_bgm_day(), sr=SRB)
    write_wav("bgm_night.wav", make_bgm_night(), sr=SRB)
    print("done. files in", os.path.abspath(OUT))

if __name__ == "__main__":
    main()
