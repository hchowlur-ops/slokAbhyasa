# The Bhagavad Gītā reference dataset

`reference/gita/` holds the 700 verses of the Bhagavad Gītā (701 on the numbering most
editions use, where 13.1 is "arjuna uvāca / prakṛtiṃ puruṣaṃ…") as a normalised
`verses.json`, with a `manifest.json` naming the source, the commit it was taken from, the
licence and the file's hash, the source's `LICENSE`, and an `ATTRIBUTION.txt`. The folder
is independent of the app: `node tools/gita/fetch.mjs` makes or updates it, and nothing
else writes there.

## Source and licence

The text comes from the Vedic Scriptures dataset by Pt. Prashant Tripathi — the
MIT-licensed static copy at https://github.com/vedicscriptures/vedicscriptures.github.io
(`slok/<chapter>/<verse>/index.json`, `chapters/index.json`), the same JSON the
`vedicscriptures/bhagavad-gita-data` repository publishes under GPL-3.0. Only the Sanskrit
fields are taken — the Devanagari text, its IAST transliteration and the chapter names;
the 22 translation and commentary sets bundled in every source file are third-party
copyrighted works (Gita Press, Chinmaya Mission, Bhaktivedanta Book Trust…) and are
dropped on download, as are the chapter summaries, whose provenance is unclear. The
Sanskrit verses themselves are an ancient text in the public domain.

It was chosen over the alternatives surveyed on 2026-10-11 (gita/gita, Wikisource, GRETIL,
sanskritdocuments.org, Kaggle and Hugging Face mirrors; notes under
`research_notes/Bhagavad Gita sloka datasets/`) because its text is the cleanest under a
free licence: every verse NFC, one half-verse per line, speaker lines present, proper IAST,
and only eight typos found by a three-way comparison — fixed here by
`overrides.json`.

## English

Each verse also carries `english`: Annie Besant's 1905 translation ("The Bhagavad-Gîtâ",
public domain), taken verse-aligned from the CANONCITE corpus file by pralia-labs on
Hugging Face (`corpora/bhagavad_gita/corpus_index.jsonl`; its alignment and metadata are
CC BY 4.0, so the attribution in `ATTRIBUTION.txt` must stay with the data). Nothing else
of that file is used. `--no-english` leaves the layer out. No Kannada or Telugu translation
of the Gītā exists under a free licence (the survey found every one copyrighted, and the
Telugu Wikisource text to be a copyrighted book pasted in); the Kannada and Telugu
*verse text* the app shows is written from the Devanagari by `js/lipi.js`.

## What the normaliser does (`normalize.mjs`, pure, tested)

- Drops the trailing marker (`||२-४७||`) and turns the ASCII daṇḍas into । and ॥.
- Takes the speaker line (`अर्जुन उवाच`, `श्रीभगवानुवाच`…) out of the text into
  `speakerLine`, and names the speaker of every verse (`speaker`), carried forward from
  the last speaker line as the text itself does.
- Keeps each half-verse as one line (`deva`, `iast`); the triṣṭubh verses have four.
- Files numbered past a chapter's verse count are its colophon (`colophons`).
- Applies `overrides.json` and strips the one editorial "(or …)" note.
- Records the metre of each verse from the app's own table (`gitaFamily` in
  `js/chandas.js`) and counts the verses whose syllables do not fit it exactly (the manifest
  keeps the number; the fetch log lists them).

## verses.json

The shape `js/verses.js` checks (`validateDataset`) and the server serves; a full
description is in the Learn redesign plan. Every entry has the same fields; `kind` is
`verse` for the 700, `colophon` for a chapter's closing line (the dataset's extras), and
the schema also allows `combined` (two or three verses recited as one), `opening`,
`dhyana`, `invocation` and `other`.

```json
{
  "schemaVersion": "1.0.0", "dataset": "gita", "version": "2026.10.11",
  "source": { "name": "vedicscriptures/vedicscriptures.github.io", "url": "…", "retrieved": "…" },
  "chapters": [{ "chapter": 2, "verses": 72, "name": { "deva": "सांख्ययोग", "iast": "…", "en": "…" } }],
  "verses": [{
    "id": "2.47", "kind": "verse", "chapter": 2, "verse": 47, "verseEnd": null,
    "speaker": { "who": "krishna", "deva": null, "iast": null },
    "deva": ["कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।", "मा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥"],
    "iast": ["karmaṇyevādhikāraste mā phaleṣu kadācana |", "mā karmaphalaheturbhūrmā te saṅgo’astvakarmaṇi ||"],
    "metre": { "family": "anushtubh", "name": "anuṣṭubh" },
    "translations": { "en": "Thy business is with the action only, never with its fruits; …" },
    "variants": [], "recitedWith": null
  }, {
    "id": "2.colophon", "kind": "colophon", "chapter": 2, "verse": null, "verseEnd": null,
    "speaker": null, "deva": ["ॐ तत्सदिति … द्वितीयोऽध्यायः ॥"], "iast": ["…"], "metre": null, "translations": {}, "variants": [], "recitedWith": null
  }]
}
```

`speaker.who` names who speaks the verse (`krishna`, `arjuna`, `sanjaya`,
`dhritarashtra`), carried forward from the last attribution line as the text itself does;
`speaker.deva` / `speaker.iast` hold that line only for the verses that open with one
(59 of them), never inside `deva`. The manifest (`manifest.json`) carries `id`, `work`,
`name`, `version` (the fetch date), `sourceCommit`, `source`, `licence`, `attribution`,
`files`, `sha256`, `translations`, `counts`, `checks` and `overrides`.

## Where the app looks for it

`<data>/reference/<id>/` first (the data folder of `datadir.js`, so a dataset dropped
there wins and survives an app upgrade), then the app's own `reference/<id>/` (this
snapshot, shipped in the package). `GET /api/reference` lists what was found, with the
errors of any dataset that fails its checks; `node tools/reference-check.mjs [folder]`
runs the same checks from the command line, with every verse that does not scan listed.

## Commands

```
node tools/gita/fetch.mjs                 # latest commit of the source → reference/gita/
node tools/gita/fetch.mjs --ref <sha>     # a pinned commit
node tools/gita/fetch.mjs --to <dir>      # another folder
node tools/gita/fetch.mjs --check         # validate reference/gita/ against its manifest
node tools/reference-check.mjs            # the same checks on any dataset folder, verse by verse
npm test                                  # includes test/gita-normalize.test.js
```
