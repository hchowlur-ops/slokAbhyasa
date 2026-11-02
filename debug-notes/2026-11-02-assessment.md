_Markdown twin of [2026-11-02-assessment.html](2026-11-02-assessment.html), written by `node tools/note-md.mjs` for reading by agents and search; the HTML page is the source._

SlokAbhyasa debug note · 2 November 2026

# Can the sloka boundaries be made reliable? An assessment

After the recital of 06:34 (CH18-03..06) was cut in the wrong places, the question was put plainly: whether the evaluation of a recital of several slokas will ever be right with the current approach, after two weeks of changing, regressing and fixing. This note is the answer, with the evidence beside it: [the take note of 06:34](take-20261102-063453-2dom.md) and [the measurement of placement by sound alone](2026-11-02-placement-by-sound.md).

**The doubt is right about the approach and wrong about the problem.** The evidence for the correct cuts was present in every take examined, including this morning's. The app has been trusting the wrong evidence, and each fix moved the failure instead of removing it.

## What happened at 06:34

All four slokas were whole. Three opinions on where they lay, against the sloka's own sound, the strongest evidence there is:

| Sloka | By sound | The ear | The second opinion (chosen) | Window the verdict used |
| --- | --- | --- | --- | --- |
| CH18-03 | 0–16.1 | 0–15.6 | 0.2–19.3 | 0.1–20.1 |
| CH18-04 | 16.1–31.1 | 15.6–33.8 | 19.9–39.1 | 19.1–39.9 |
| CH18-05 | 31.0–47.1 | 33.8–52.7 | 39.6–59.2 | 33.0–53.6 |
| CH18-06 | 47.1–63.2 | 52.7–63.9 | 59.8–63.0 | 51.9–63.1 |

- **The ear** counted 13 % fewer nuclei per akṣara than it had learnt, and the shortfall accumulated sloka after sloka: CH18-04 closed 2.8 s late, CH18-05 5.6 s late, and CH18-06 came out "dropped 18 of 32".
- **The second opinion** took the ear's "last sloka partial" as its hypothesis, gave CH18-06 three seconds, and pushed the other cuts 8 to 12 s late. Its *share* method had every cut within 0.6 s of the sound and lost on cost.
- **The rule of the day before** handed CH18-04 the second opinion's window on length fit, although the sound's contrast on that window was 0.999, which means nothing recognisable was in it. That rule was the regression felt this morning.

## Why rules on top of this will not converge

- The ear and the second opinion both infer where a sloka is from how long it should be. When the pace drifts, they fail together. They are not two opinions.
- Neither can tell when it is wrong, so every arbitration rule between them is a guess tuned on the last bad take. Eleven of the seventeen commits since 20 October touched this logic, across 43 named thresholds, each validated by replaying the take it was written for.
- The direct evidence, the sloka's own sound against a reference in the learner's voice, has only ever been a referee: a confirmer of windows chosen by the other two.

## What was measured instead

Each sloka's reference located in the take by sound, the surest fixed first, the others searched only in the room their order leaves. Run over every recital kept since 20 October (`node tools/place-by-sound.mjs`):

| Over 33 recitals, 113 slokas |  |
| --- | --- |
| Slokas placed with contrast under 0.85 | 98 |
| Recitals with every sloka placed surely | 24 of 33 |
| Cuts within 1 s of the truth, on the four takes verified by hand | all |
| Cuts within 1 s where the ear and the second opinion agree with each other | 19 of 22 |

This morning it places the four slokas back to back at 16.1, 31.0 and 47.1 s, and the learner's own solo takes agree with the library recordings within 0.1 s on every cut. Its limits are real but visible: the CH11 library recordings, 9 to 10 s long for slokas the learner takes 15 s over, place nothing, and the contrast says so. The learner's own clean solo takes are the stronger reference everywhere, but exist for only 54 of the 113 slokas. A repeat at a sloka's end falls in the gap between placements and has to be assigned to a neighbour.

## What is recommended, and not built

Replace the placer, not patch it:

1. The ordered placement by sound decides the windows for the verdict. The ear keeps only the live page turning and the wave. The second opinion's pauses only snap the placed edges to the nearest breath.
2. A sloka whose contrast stays weak says so on its card, and the cut can be dragged on the wave. No silent wrong verdict, and each correction is saved as ground truth.
3. The measurement script becomes the regression bench: no placement change is committed if it lowers the rate on the kept recitals.
4. A clean solo take of a sloka becomes its reference automatically, so CH11 heals itself the next time it is practised alone.

The app is unchanged by this note. The placer itself exists as the measurement's script; what remains is wiring it in place of the window choice in `js/app.js`, the draggable cut on the wave, the bench as a test, and the reference rule. Whether to go ahead is the learner's call.
