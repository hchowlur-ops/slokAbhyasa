"""Renders the Markdown research reports in reports/ as readable HTML pages in reports/html/.

    python tools/report-html.py

Needs the pure-Python "markdown" package (pip install markdown). Each report becomes one
page with large type, a table of contents in the margin, scrollable tables and a print
layout; index.html lists them. Re-run after a report changes.
"""
import html
import pathlib
import re
import sys

try:
    import markdown
except ImportError:  # pragma: no cover
    sys.exit("The 'markdown' package is needed: python -m pip install --user markdown")

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPORTS = ROOT / "reports"
OUT = REPORTS / "html"

CSS = """
:root {
  --bg: #fbfaf7; --surface: #ffffff; --text: #1f2328; --muted: #5b6168; --accent: #0f766e;
  --border: #e4e1da; --row: #f4f2ec; --link: #0b5f59; --mark: #fff3bf;
  --body-size: 19px; --measure: 74ch;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #15171a; --surface: #1d2024; --text: #e6e3dc; --muted: #a2a8b0; --accent: #5fd3c6;
    --border: #2e3237; --row: #22262b; --link: #7ee0d4; --mark: #4a4300;
  }
}
:root[data-theme="dark"] {
  --bg: #15171a; --surface: #1d2024; --text: #e6e3dc; --muted: #a2a8b0; --accent: #5fd3c6;
  --border: #2e3237; --row: #22262b; --link: #7ee0d4; --mark: #4a4300;
}
* { box-sizing: border-box; }
html { font-size: var(--body-size); }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: Georgia, "Noto Serif", "Nirmala UI", "Tunga", serif;
  line-height: 1.6; -webkit-font-smoothing: antialiased;
}
.page { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; }
@media (min-width: 1180px) { .page { grid-template-columns: 300px minmax(0, 1fr); } }
nav.toc {
  position: sticky; top: 0; align-self: start; max-height: 100vh; overflow-y: auto;
  padding: 28px 22px 40px 28px; font-family: system-ui, "Segoe UI", sans-serif; font-size: 0.78rem;
  border-right: 1px solid var(--border); background: var(--surface);
}
@media (max-width: 1179px) { nav.toc { position: static; max-height: none; border-right: 0; border-bottom: 1px solid var(--border); } }
nav.toc .home { display: inline-block; margin-bottom: 18px; color: var(--muted); text-decoration: none; }
nav.toc .home:hover { color: var(--accent); }
nav.toc .toc-title { font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-size: 0.7rem; margin-bottom: 10px; }
nav.toc ul { list-style: none; margin: 0; padding: 0; }
nav.toc ul ul { padding-left: 14px; margin: 2px 0 6px; }
nav.toc li { margin: 4px 0; }
nav.toc a { color: var(--text); text-decoration: none; display: block; padding: 3px 8px; border-radius: 6px; line-height: 1.35; }
nav.toc a:hover { background: var(--row); color: var(--accent); }
nav.toc a.active { background: var(--row); color: var(--accent); font-weight: 600; }
main { padding: 36px 24px 90px; }
article { max-width: var(--measure); margin: 0 auto; }
h1, h2, h3, h4 { font-family: system-ui, "Segoe UI", "Nirmala UI", sans-serif; line-height: 1.2; letter-spacing: -0.01em; scroll-margin-top: 20px; }
h1 { font-size: 2.1rem; margin: 0 0 .4em; }
h2 { font-size: 1.45rem; margin: 2.2em 0 .6em; padding-top: 1.2em; border-top: 1px solid var(--border); }
h3 { font-size: 1.12rem; margin: 1.8em 0 .5em; }
h4 { font-size: 1rem; margin: 1.4em 0 .4em; color: var(--muted); }
p { margin: 0 0 1.05em; }
a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 3px; }
article > p:first-of-type { font-size: 1.05rem; }
strong { color: var(--text); }
blockquote { margin: 1.2em 0; padding: .2em 1.2em; border-left: 4px solid var(--accent); color: var(--muted); }
code { font-family: ui-monospace, Consolas, monospace; font-size: 0.85em; background: var(--row); padding: .1em .35em; border-radius: 4px; }
pre { background: var(--row); padding: 14px 16px; border-radius: 10px; overflow-x: auto; font-size: 0.8rem; line-height: 1.5; }
pre code { background: none; padding: 0; font-size: inherit; }
ul, ol { padding-left: 1.4em; }
li { margin: .3em 0; }
hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
.table-wrap { overflow-x: auto; margin: 1.4em 0; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-family: system-ui, "Segoe UI", "Nirmala UI", sans-serif; font-size: 0.82rem; line-height: 1.4; }
th, td { text-align: left; vertical-align: top; padding: 9px 12px; border-bottom: 1px solid var(--border); }
th { background: var(--row); font-weight: 600; position: sticky; top: 0; }
tbody tr:nth-child(even) { background: color-mix(in srgb, var(--row) 55%, transparent); }
.meta { color: var(--muted); font-family: system-ui, "Segoe UI", sans-serif; font-size: 0.8rem; margin: 0 0 2.2em; }
.controls { position: fixed; right: 16px; bottom: 16px; display: flex; gap: 6px; font-family: system-ui, sans-serif; }
.controls button { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px; width: 40px; height: 40px; font-size: 1rem; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
.controls button:hover { color: var(--accent); }
.index-list { list-style: none; padding: 0; }
.index-list li { margin: 0 0 18px; }
.index-list a { font-family: system-ui, "Segoe UI", sans-serif; font-size: 1.1rem; font-weight: 600; text-decoration: none; }
.index-list .lede { color: var(--muted); margin: .25em 0 0; }
@media print {
  nav.toc, .controls { display: none; }
  .page { display: block; }
  body { background: #fff; color: #000; font-size: 11pt; }
  article { max-width: none; }
  a { color: inherit; text-decoration: none; }
  a[href^="http"]::after { content: ""; }
  .table-wrap { border: 0; overflow: visible; }
  h2 { break-after: avoid; }
  tr, blockquote, pre { break-inside: avoid; }
}
"""

JS = """
(() => {
  // remember the reader's text size and theme (per browser)
  const root = document.documentElement;
  try { const s = localStorage.getItem('report-size'); if (s) root.style.setProperty('--body-size', s); } catch {}
  try { const t = localStorage.getItem('report-theme'); if (t) root.dataset.theme = t; } catch {}
  const size = (d) => {
    const cur = parseFloat(getComputedStyle(root).getPropertyValue('--body-size')) || 19;
    const next = Math.min(28, Math.max(14, cur + d)) + 'px';
    root.style.setProperty('--body-size', next);
    try { localStorage.setItem('report-size', next); } catch {}
  };
  document.getElementById('bigger')?.addEventListener('click', () => size(1));
  document.getElementById('smaller')?.addEventListener('click', () => size(-1));
  document.getElementById('theme')?.addEventListener('click', () => {
    const dark = root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('report-theme', root.dataset.theme); } catch {}
  });
  // highlight the section being read
  const links = [...document.querySelectorAll('nav.toc a[href^="#"]')];
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const heads = [...document.querySelectorAll('article h2, article h3')].filter((h) => byId.has(h.id));
  const mark = () => {
    let cur = heads[0];
    for (const h of heads) if (h.getBoundingClientRect().top < 120) cur = h;
    links.forEach((a) => a.classList.toggle('active', cur && a === byId.get(cur.id)));
  };
  addEventListener('scroll', mark, { passive: true });
  mark();
  // tables scroll sideways rather than overflowing the page
  for (const t of document.querySelectorAll('article table')) {
    const w = document.createElement('div'); w.className = 'table-wrap'; t.replaceWith(w); w.appendChild(t);
  }
  // sources open beside the report
  for (const a of document.querySelectorAll('article a[href^="http"]')) { a.target = '_blank'; a.rel = 'noopener'; }
})();
"""

CONTROLS = """<div class="controls" aria-label="Reading controls">
<button id="smaller" title="Smaller text" aria-label="Smaller text">A−</button>
<button id="bigger" title="Larger text" aria-label="Larger text">A+</button>
<button id="theme" title="Light or dark" aria-label="Switch light or dark">◐</button>
</div>"""


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def render(md_path: pathlib.Path) -> tuple[str, str, str]:
    text = md_path.read_text(encoding="utf-8")
    md = markdown.Markdown(extensions=["tables", "toc", "fenced_code", "sane_lists", "smarty"],
                           extension_configs={"toc": {"toc_depth": "2-3", "permalink": False}})
    body = md.convert(text)
    title = md_path.stem
    m = re.search(r"<h1[^>]*>(.*?)</h1>", body, re.S)
    heading = re.sub(r"<[^>]+>", "", m.group(1)) if m else title
    toc = md.toc  # <div class="toc"><ul>…</ul></div>
    lede_match = re.search(r"</h1>\s*<p>(.*?)</p>", body, re.S)
    lede = re.sub(r"<[^>]+>", "", lede_match.group(1)) if lede_match else ""
    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(heading)} · {html.escape(title)}</title>
<style>{CSS}</style>
</head>
<body>
<div class="page">
<nav class="toc" aria-label="Contents">
<a class="home" href="index.html">← All reports</a>
<div class="toc-title">Contents</div>
{toc}
</nav>
<main>
<article>
<p class="meta">{html.escape(title)} · research report · SlokAbhyasa</p>
{body}
</article>
</main>
</div>
{CONTROLS}
<script>{JS}</script>
</body>
</html>
"""
    return heading, lede, page


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    items = []
    for md_path in sorted(REPORTS.glob("*.md")):
        heading, lede, page = render(md_path)
        out = OUT / f"{slug(md_path.stem)}.html"
        out.write_text(page, encoding="utf-8")
        items.append((md_path.stem, heading, lede, out.name))
        print(f"{out.relative_to(ROOT)}  ({out.stat().st_size // 1024} KB)")
    lis = "\n".join(
        f'<li><a href="{html.escape(fn)}">{html.escape(stem)}</a><p class="lede">{html.escape(heading)}. {html.escape(lede[:260])}…</p></li>'
        for stem, heading, lede, fn in items
    )
    index = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SlokAbhyasa research reports</title>
<style>{CSS}</style>
</head>
<body>
<div class="page" style="grid-template-columns: minmax(0, 1fr)">
<main>
<article>
<p class="meta">SlokAbhyasa · research reports</p>
<h1>Research reports</h1>
<p>Background research for the evaluation parameters and the recording metadata. Each page has a table of contents in the margin, text-size and light/dark controls at the bottom right, and prints cleanly.</p>
<ul class="index-list">
{lis}
</ul>
</article>
</main>
</div>
{CONTROLS}
<script>{JS}</script>
</body>
</html>
"""
    (OUT / "index.html").write_text(index, encoding="utf-8")
    print(f"{(OUT / 'index.html').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
