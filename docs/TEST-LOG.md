# Test log

Every test that changed the build, in the order it happened. Numbers come from
`npm run accuracy` (synthetic hums, see [ACCURACY.md](ACCURACY.md)) or the browser
tests in `scripts/`. No real voices are used: every hum is synthesised, so the
true pitch of every sample is known.

Terms used below:
- **Wrong note**: a frame where the pitch that steers the plane is more than 50 cents
  (half a semitone) away from the note being hummed.
- **Octave error**: off by about 12 semitones (or 19, an octave and a fifth).
- **Heard**: share of humming frames the game treats as humming (the rest glide).
- **Latency**: time from a note change to a stable reading of the new note, on the
  60-per-second frame clock the game uses.

---

## 2026-11-10 · Test 1: is plain autocorrelation good enough?

**Setup.** Version 0 picked the highest autocorrelation peak in each 2048-sample
buffer. Tested on 25 pure tones (70-800 Hz) and on synthetic hums from four voices
(deep, warm, light, high), every note in each range.

**Result.** Pure tones were fine in the middle but the worst tone was off by 41
semitones. On hums, **21% of clean frames were octave errors**. A hum is a nasal
murmur with a resonance near 250-330 Hz, so for a low voice the 2nd or 3rd harmonic
is louder than the fundamental, and the autocorrelation peak lands on it.

**Change.** Replaced it with YIN (cumulative mean normalised difference, first dip
under 0.15, parabolic interpolation). Clean hums: **0.0% octave errors**, median
error 3.3 cents against the true pitch. Pure tones: worst error 0.2 cents.
Version 0 stays in `src/pitch/acf.ts` only so this comparison can be re-run.

## 2026-11-10 · Test 2: my metric was wrong, and so was my test voice

**Setup.** Added a median-of-5 filter (version 2) so the plane would not wobble,
and scored it against the true pitch.

**Result.** The median looked *worse* (median error 3 → 20 cents). Two causes,
both in the test, not the game:
1. The true pitch includes vibrato (±25 cents). Smoothing removes vibrato, which is
   exactly what the plane needs, but it was scored as error. **Changed the metric**:
   the steering signal is now scored against the note the singer *means*
   (no vibrato, no drift). Raw detector accuracy is still scored against the true pitch.
2. The synthetic voice slid into each note from the previous one, even after a
   silence. A bug in the synth's glide reset. **Fixed** (a note after a breath now
   starts on pitch). Clean wrong-note frames for plain YIN fell from 7.8% to 0.2%.

## 2026-11-10 · Test 3: the jump guard locked onto the wrong octave

**Setup.** Version 3 added a jump guard (a leap of more than 7 semitones must repeat
for 3 frames before it is believed) and a 3-frame hangover for short dropouts.

**Result.** Good in heavy noise (SNR 5 dB wrong-note frames 15% → 10%), but at
SNR 10 dB the 95th-percentile error jumped from 37 to **322 cents**. Frame traces
showed why: breathy note onsets sometimes read an octave low for 2 frames, the
guard then treated the *correct* pitch as the suspicious leap, and held the wrong
octave for about 100 ms.

**Change.** Version 4: a reading that is clearly more periodic (clarity at least
0.04 higher than anything in the window) replaces the window at once.
95th percentile back to 39 cents.

## 2026-11-10 · Test 4: the old note dragged the next one

**Setup.** Ablation of each tracker stage on clean hums.

**Result.** Version 4 had 2.1% wrong-note frames on clean hums, against 0.8% for the
plain median. All of them were the first frames of a new note: when the gap
between notes was shorter than the hangover, the previous note stayed in the
median window.

**Change.** Version 5: when the voice comes back after any dropout on a different
note, the window starts fresh. Then version 6 (shipped) shortened the median from
5 to 3 frames: clean wrong-note frames **0.5%** (after Test 5), latency **76 ms median, 93 ms worst**
(was 93 / 109 ms), at the cost of about 2 cents more wobble, which is invisible at
the plane's scale.

## 2026-11-10 · Test 5: the noise gate took two seconds to learn a room

**Setup.** Unit test: 2 seconds of quiet fan-like noise, then a hum.

**Result.** The noise-floor estimate had only moved 45% of the way after 2 seconds,
so in a noisy room the plane could twitch on noise right after the game starts.
My first fix (learn about 4 times faster) **broke hearing**: at SNR 10 dB only 40% of
humming frames were heard, because the estimate learned from the quiet, still
periodic tail of each hum and raised the gate above the voice.

**Change.** The floor now rises only on frames that are clearly not a voice
(clarity under 0.6) and falls fast on any quieter frame. SNR 10 dB: 91.9% of humming
frames heard, 0.6% wrong-note frames, and the test passes. The price: in a very loud
room (SNR 5 dB) the stricter gate hears 9% of frames instead of 24%. I kept it,
because at that noise level about 11% of what *is* heard is an octave off anyway.

## Known limits (measured, not fixed)

- **Very loud rooms.** At SNR 5 dB (noise only 5 dB below the hum) the game hears
  about 1 humming frame in 10, and about 11% of those are octave errors. The plane
  glides when it cannot hear you, which is safer than jumping an octave, but you
  will need to hum louder, move closer or turn the fan off.
- **Synthetic voices only.** The detector has not been scored against labelled
  recordings of real people.
