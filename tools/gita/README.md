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
- Applies `overrides.json` and strips the source's editorial variant notes, "(or …)" and "(var …)".
- Records the metre of each verse from the app's own table (`gitaFamily` in
  `js/chandas.js`) and counts the verses whose syllables do not fit it exactly (the manifest
  keeps the number; the fetch log lists them).

## verses.json

```json
{
  "dataset": "gita", "schema": 1,
  "source": { "repo": "vedicscriptures/vedicscriptures.github.io", "commit": "…", "fetchedAt": "…" },
  "chapters": [{ "number": 2, "name": "साङ्ख्ययोग", "nameIast": "…", "nameEnglish": "…", "verses": 72 }],
  "verses": [{
    "id": "2.47", "kind": "verse", "chapter": 2, "verse": 47,
    "speaker": "श्रीभगवान्", "speakerLine": null,
    "deva": ["कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।", "मा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥"],
    "iast": ["karmaṇyevādhikāraste mā phaleṣu kadācana |", "mā karmaphalaheturbhūrmā te saṅgo’astvakarmaṇi ||"],
    "metre": "anushtubh"
  }],
  "colophons": [{ "id": "2.colophon", "chapter": 2, "deva": ["…"], "iast": ["…"] }]
}
```

## Commands

```
node tools/gita/fetch.mjs                 # latest commit of the source → reference/gita/
node tools/gita/fetch.mjs --ref <sha>     # a pinned commit
node tools/gita/fetch.mjs --to <dir>      # another folder
node tools/gita/fetch.mjs --check         # validate reference/gita/ against its manifest
npm test                                  # includes test/gita-normalize.test.js
```
