_Markdown twin of [index.html](index.html), written by `node tools/note-md.mjs` for reading by agents and search; the HTML page is the source._

# SlokAbhyasa debug notes

Reports written while chasing wrong verdicts: how the app finds mistakes, and what each take's ear, second opinion and sound said. The take notes are written by `node tools/debug-note.mjs <session id> [--replay <log>]`; the others by hand on the day. Every note has a Markdown twin beside it (`name.md`) for agents and search tools, written by `node tools/note-md.mjs`; the HTML page is the source, and a note written by hand needs the twin refreshed with `--force`.

## 2 November 2026 — the recital of CH18-03..06, and placement by sound alone

- [Can the sloka boundaries be made reliable? An assessment](2026-11-02-assessment.md) — the answer to the doubt after the 06:34 recital: right about the approach, wrong about the problem. What happened at 06:34, why rules on top of the ear and the second opinion cannot converge, what the measurement found, and the recommended replacement (the ordered placement by sound as the placer, the ear for page turning only, a draggable cut where the contrast is weak, the measurement as a regression bench). Nothing built yet.
- [Take 06:34 (2dom)](take-20261102-063453-2dom.md) — words off. The ear 2.8 and 5.6 s late (its count of nuclei ran 13 % under what it had learnt, and the shortfall accumulated sloka after sloka), the second opinion 8 and 12 s late (it took the ear's "last sloka partial" as its hypothesis and gave CH18-06 three seconds), the rule of the day before handing CH18-04 the second opinion's window on length fit with the sound's contrast at 0.999; CH18-06 "dropped 18 of 32" when it was whole.
- [Placement by sound alone, in order](2026-11-02-placement-by-sound.md) — each sloka's reference located in the take, the surest fixed first, the rest searched in the room their order leaves: over 33 recitals since 20 October, 98 of 113 slokas placed with contrast under 0.85, right on every take whose cuts are known, 19 of 22 within 1 s of the cuts the ear and the second opinion agree on; the learner's own solo takes the better reference, the CH11 library recordings unusable. `node tools/place-by-sound.mjs`.

## 1 November 2026 — the recitals of CH18-01..04

- [How SlokAbhyasa finds mistakes](2026-11-01-error-identification.md) — the pipeline from the live ear to the slips and grades: the ear's state machine and close rules, the second opinion and why it now places every sloka, the sound verdict, the words' guards and the self-correction detector, the slip filter and the weights, the three takes sloka by sloka, what can still go wrong.
- [The ear against the second opinion, judged by sound](2026-11-01-arbiter.md) — 22 recitals since 20 October, 30 cuts: the second opinion within a second of the sound on 24, the ear on 15.
- [Take 06:41 (33mt)](take-20261101-064104-33mt.md) — words on. A false "repeated उवाच सन्या" on CH18-01 (a five-sound echo across two words), a false start and a pause on CH18-03 that scored 93, CH18-04's window beginning inside CH18-03 and the recogniser looping at its end. With the replays before and after the fixes.
- [Take 07:03 (oo8n)](take-20261101-070324-oo8n.md) — words off. The ear cut 2.2 and 3.7 s late after CH18-02 and CH18-03; the second opinion within a third of a second of the sound; CH18-04 "27 of 32 dropped" by a count that began inside it.
- [Take 08:38 (xeca)](take-20261101-083846-xeca.md) — words off. The second opinion right on every cut (three methods agreeing, CH18-02 pinned at both ends by its signatures), the ear 3 to 4 s late; the morning's first fix still kept the ear's windows because the right windows' contrast sat over the match line. With the replays under the final rule.

## Reading a take note

The verdicts table is what the session kept. The windows table puts three opinions side by side for every sloka: the ear's stretch (its live count and pauses), the second opinion's segment (the whole take cut from its pauses, lengths and pins), and where the sloka's own library recording lies in the take by sound (the search at five tempos; weak when its contrast reaches 0.9), with the window the verdict used and why. Below them the second opinion in full and the ear's log tick by tick, as the readers in `tools/` print them, and the replays' findings when logs were given.
