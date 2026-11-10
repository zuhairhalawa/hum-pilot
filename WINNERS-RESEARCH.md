# Hum Pilot: winners and prior-art research (2026-11-10)

Caveat: devpost.com pages could not be loaded during this research, so the event page and project pages were not read directly. No Devpost winner for a pitch/hum game was found; patterns below come from general hackathon guidance plus comparable projects. Items marked UNVERIFIED must be checked before citing.

## Sources
- Humbird (hum a note, bird height): https://github.com/ValentinH/humbird
- Pitch Bird (80-800 Hz to altitude): https://flappysound.pages.dev/pitch-bird/ and https://flappysound.pages.dev/blog/how-pitch-detection-works/
- Yasuhati / Scream Go Hero: https://apps.apple.com/app/id1215691000 , https://www.vice.com/en/article/hilarious-frustrating-voice-controlled-iphone-game
- Voice of God (Global Game Jam 2017, pitch moves terrain): https://chronologist.itch.io/voice-of-god
- Devpost: HumBox https://devpost.com/software/humbox ; Voice Piano https://devpost.com/software/voice-piano ; BirdPitch https://devpost.com/software/birdpitch ; Karaoke Combat (mirror) https://kelaenderkoe.pages.dev/Function-https-devpost.com/software/karaoke-combat
- YIN paper PDF: https://cagnazzo.wp.imt.fr/files/2013/05/2002_JASA_YIN.pdf (JASA 111, 1917-1930)
- TarsosDSP MPM docs: https://0110.be/releases/TarsosDSP/TarsosDSP-2.3/TarsosDSP-2.3-Documentation/be/tarsos/dsp/pitch/McLeodPitchMethod.html
- Dysphonia game tool, pitch estimators compared: https://arxiv.org/pdf/1504.04309
- Visual feedback singing: https://ses.library.usyd.edu.au/handle/2123/1526 ; https://journals.sagepub.com/doi/10.1177/03057356211026730 ; https://scholars.wlu.ca/etd/1812 (null result)
- Vocal Joystick (UW): https://faculty.washington.edu/wobbrock/pubs/assets-07.03.pdf ; longitudinal study https://people.ece.uw.edu/bilmes/p/mypubs/harada2009-longitude.pdf
- Hackathon judging tips: https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l ; https://dev.to/jacklyn/how-to-make-your-devpost-submissions-not-suck-37i0

## Winning pattern (bullets)
- Video is demo-only, about 2 min (many events cap at 2; judges skip longer). Show the product working in the first 15 s, then criteria-by-criteria.
- Record a backup demo video while it works; upload early (YouTube processing can take hours).
- Live, playable link plus a repo README; a working experience beats slides.
- Storytelling and demo quality decide when rubrics are vague.
- Comparable Devpost voice/pitch projects (HumBox, Karaoke Combat, Riffs) all tell a "problem found while testing" story: noise/breath triggering notes, debounce of 600 ms, "chose stability over exact pitch." This is exactly what the "testing shaped the build" criterion rewards. None is confirmed as a winner.
- Game jam pitch-games that won (Voice of God, Best Game at its GGJ site; Gnilley, most original) won on novelty of the control, not polish. UNVERIFIED beyond the search summary.
- Measured results are rare in comparable entries, so a real test log is a differentiator.

## Prior art
| Game | Mechanic (1 line) |
|---|---|
| Yasuhati / Eighth Note / Scream Go Hero | Mic volume moves a character; soft = walk, loud = jump. Pitch not confirmed. |
| Humbird (GitHub) | Flappy variant: sing/hum a displayed target note to set bird height; vanilla JS autocorrelation. |
| Pitch Bird | Voice pitch 80-800 Hz maps to altitude; silence returns bird to center. |
| Voice of God (GGJ 2017) | Pitch reshapes terrain. |
| Karaoke Combat (Devpost) | Singing matched to MIDI notes drives a duel. |
| HumBox (Devpost) | Humming becomes a step sequencer. |
| Voice Piano (Devpost) | YIN + HPS in WebAssembly to play notes by voice. |

Hum Pilot differs from Humbird/Pitch Bird (nearest): continuous relative pitch steering of a paper plane through gaps (not a fixed target note), per-player calibration of range, and a published measured test log. Avoid "bird", "Flappy", "Pitch Bird", "Humbird", "Scream" in name, art or levels.

## Technical notes
- YIN: threshold 0.1 on the cumulative-mean-normalized difference is the paper default; TarsosDSP uses 0.2. Take the FIRST dip below threshold (not the global minimum) to avoid octave-low errors. Fall back to global minimum if none.
- Octave errors: typically sub-octave (half frequency) with weak fundamental or breathy hum; octave-up on strong harmonics. Mitigate with median filter over 3-5 frames, rejecting jumps over about 7 semitones per frame, and a clarity gate (1 - d' above about 0.8-0.9).
- Frame size: 80 Hz needs at least 2 periods = 25 ms; use window 2048 samples at 44.1/48 kHz (about 43-46 ms), hop 512-1024 (about 12-23 ms). Tau max about fs/80. Expect 40-80 ms end-to-end. Smaller (1024) works for 120 Hz+ but errors rise at low male hums.
- Accuracy numbers: I could not extract the paper's table (PDF was binary). From memory, YIN reported gross error about 1% vs about 10% for plain autocorrelation (UNVERIFIED; open the PDF and confirm before quoting). No MPM-on-voice accuracy number found; one dysphonic-voice study found MPM failed with buffers over 1024 and preferred autocorrelation (https://arxiv.org/pdf/1504.04309). Measure your own: report gross error rate vs a reference tone/known-pitch recordings.
- Use getFloatTimeDomainData on an AnalyserNode or an AudioWorklet; disable echoCancellation/noiseSuppression/autoGainControl in getUserMedia constraints.

## Value evidence
- Singing: visual real-time pitch feedback improved pitch accuracy in a 2007 thesis (Wilson, Sydney) and a 2021 Psychology of Music study (only the visual-feedback group improved significantly). Counter-evidence: a Wilfrid Laurier thesis found no effect on vocal control. Present as "promising, mixed", not proven.
- Speech/voice therapy: game-based dysphonic rehabilitation tool research compares pitch estimators for patients (arXiv 1504.04309); this supports the concept, not outcomes. No intonation-therapy outcome numbers found.
- Accessibility: Vocal Joystick (UW) shows non-speech voice control for people with motor impairments; a 2.5-week longitudinal study (5 impaired, 4 non-impaired participants) showed significant improvement in cursor control. It used vowels and loudness; pitch was not the main control, so do not claim prior validation of pitch control.

## What to copy / what to avoid
Copy: 2-min demo-only video; live link; README with test table (devices, mics, rooms, gross error %, calibration success rate, latency); a "what testing changed" section (e.g. threshold 0.1 vs 0.2, median filter, clarity gate, calibration added after failed tests); first-run calibration shown in video.
Avoid: claiming humming improves singing or therapy outcomes without own data; naming or art resembling Yasuhati/Flappy-style birds; quoting unverified YIN numbers.
