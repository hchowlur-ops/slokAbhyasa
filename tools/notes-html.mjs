#!/usr/bin/env node
// Renders every Markdown research note as a readable HTML page beside it, and an index.
//
//     node tools/notes-html.mjs                  → research_notes/**/*.md → *.html, research_notes/index.html
//     node tools/notes-html.mjs some/folder      → the same for another folder
//
// No dependencies: a small Markdown renderer (headings, paragraphs, lists with nesting,
// tables, fenced code, quotes, rules, links, bare URLs, bold, italics, code spans) and the
// page the reports/ renderer makes: large type, a table of contents in the margin, tables
// that scroll sideways, text-size and light/dark controls, a print layout. The rule of the
// house: every research note gets its HTML beside the .md — re-run this after a note changes.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(process.platform === 'win32' ? 1 : 0)), '..');
const DIR = path.resolve(process.argv[2] || path.join(ROOT, 'research_notes'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripTags = (s) => s.replace(/<[^>]+>/g, '');

// ---------- inline ----------
function inline(text) {
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (m, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, t, u) => `<a href="${u}">${t}</a>`);
  s = s.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, (m, u) => `<a href="${u}">${u}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+?)([.,;:!?]?)(?=$|[\s)])/g, (m, pre, u, tail) => (m.includes('href=') ? m : `${pre}<a href="${u}">${u}</a>${tail}`));
  s = s.replace(/\*\*(?!\s)(.+?)(?<!\s)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?!\s)([^*]+?)(?<!\s)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_(?!\s)([^_]+?)(?<!\s)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[Number(i)]);
  return s;
}

// ---------- blocks ----------
const isFence = (l) => /^\s*```/.test(l);
const isHeading = (l) => /^#{1,6}\s/.test(l);
const isRule = (l) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l);
const isQuote = (l) => /^\s*>/.test(l);
const isItem = (l) => /^\s*([-*+]|\d+[.)])\s+/.test(l);
const isTableStart = (lines, i) => /^\s*\|/.test(lines[i]) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]);
const startsBlock = (lines, i) => isFence(lines[i]) || isHeading(lines[i]) || isRule(lines[i]) || isQuote(lines[i]) || isItem(lines[i]) || isTableStart(lines, i);

function renderList(block) {
  // items with their indent; a continuation line joins the item before it
  const items = [];
  for (const l of block) {
    const m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (m) items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] });
    else if (items.length && l.trim()) items[items.length - 1].text += ' ' + l.trim();
  }
  let html = '';
  const stack = []; // open lists: { indent, ordered }
  const close = (toIndent) => { while (stack.length && stack[stack.length - 1].indent > toIndent) { html += `</li></${stack.pop().ordered ? 'ol' : 'ul'}>`; } };
  for (const it of items) {
    if (!stack.length || it.indent > stack[stack.length - 1].indent) {
      if (stack.length) html = html.replace(/<\/li>$/, '');
      stack.push({ indent: it.indent, ordered: it.ordered });
      html += `<${it.ordered ? 'ol' : 'ul'}><li>${inline(it.text)}</li>`;
    } else {
      close(it.indent);
      if (!stack.length) { stack.push({ indent: it.indent, ordered: it.ordered }); html += `<${it.ordered ? 'ol' : 'ul'}><li>${inline(it.text)}</li>`; } else html += `<li>${inline(it.text)}</li>`;
    }
  }
  while (stack.length) html += `</${stack.pop().ordered ? 'ol' : 'ul'}>`;
  return html.replace(/<\/li><\/li>/g, '</li>').replace(/<li>(.*?)<\/li><(ul|ol)>/g, '<li>$1<$2>');
}

function renderTable(block) {
  const cells = (l) => { let s = l.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|')) s = s.slice(0, -1); return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|')); };
  const head = cells(block[0]);
  const rows = block.slice(2).map(cells);
  let html = '<div class="table-wrap"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of rows) html += '<tr>' + head.map((_, i) => `<td>${inline(r[i] || '')}</td>`).join('') + '</tr>';
  return html + '</tbody></table></div>';
}

function renderMarkdown(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const headings = [];
  const seen = new Map();
  const slug = (t) => { let s = stripTags(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section'; const n = seen.get(s) || 0; seen.set(s, n + 1); return n ? `${s}-${n}` : s; };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if (isFence(line)) {
      const lang = (line.match(/```(\w*)/) || [])[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code${lang ? ` class="language-${lang}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      const lvl = m[1].length;
      const html = inline(m[2]);
      const id = slug(m[2]);
      if (lvl === 2 || lvl === 3) headings.push({ lvl, id, text: stripTags(html) });
      out.push(`<h${lvl} id="${id}">${html}</h${lvl}>`);
      i++;
      continue;
    }
    if (isRule(line)) { out.push('<hr>'); i++; continue; }
    if (isTableStart(lines, i)) {
      const block = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) block.push(lines[i++]);
      out.push(renderTable(block));
      continue;
    }
    if (isQuote(line)) {
      const block = [];
      while (i < lines.length && (isQuote(lines[i]) || (lines[i].trim() && !startsBlock(lines, i) && block.length))) block.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(block.join('\n')).html}</blockquote>`);
      continue;
    }
    if (isItem(line)) {
      const block = [];
      while (i < lines.length) {
        const l = lines[i];
        if (isItem(l)) { block.push(l); i++; continue; }
        if (l.trim() && /^\s+/.test(l)) { block.push(l); i++; continue; } // a continuation, indented
        if (!l.trim() && i + 1 < lines.length && (isItem(lines[i + 1]) || /^\s+\S/.test(lines[i + 1]))) { i++; continue; } // a blank inside the list
        break;
      }
      out.push(renderList(block));
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return { html: out.join('\n'), headings };
}

// ---------- the page ----------
const CSS = `
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
body { margin: 0; background: var(--bg); color: var(--text); font-family: Georgia, "Noto Serif", "Nirmala UI", "Tunga", serif; line-height: 1.6; -webkit-font-smoothing: antialiased; }
.page { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; }
@media (min-width: 1180px) { .page { grid-template-columns: 300px minmax(0, 1fr); } }
nav.toc { position: sticky; top: 0; align-self: start; max-height: 100vh; overflow-y: auto; padding: 28px 22px 40px 28px; font-family: system-ui, "Segoe UI", sans-serif; font-size: 0.78rem; border-right: 1px solid var(--border); background: var(--surface); }
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
a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 3px; overflow-wrap: anywhere; }
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
.index-list .folder { font-family: system-ui, "Segoe UI", sans-serif; font-size: 0.78rem; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin: 2em 0 .6em; }
@media print {
  nav.toc, .controls { display: none; }
  .page { display: block; }
  body { background: #fff; color: #000; font-size: 11pt; }
  article { max-width: none; }
  a { color: inherit; text-decoration: none; }
  .table-wrap { border: 0; overflow: visible; }
  h2 { break-after: avoid; }
  tr, blockquote, pre { break-inside: avoid; }
}
`;

const JS = `
(() => {
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
  for (const a of document.querySelectorAll('article a[href^="http"]')) { a.target = '_blank'; a.rel = 'noopener'; }
})();
`;

const CONTROLS = `<div class="controls" aria-label="Reading controls">
<button id="smaller" title="Smaller text" aria-label="Smaller text">A−</button>
<button id="bigger" title="Larger text" aria-label="Larger text">A+</button>
<button id="theme" title="Light or dark" aria-label="Switch light or dark">◐</button>
</div>`;

function tocHtml(headings) {
  if (!headings.length) return '';
  let html = '<ul>';
  let depth = 2;
  for (const h of headings) {
    if (h.lvl > depth) { html += '<ul>'; depth = h.lvl; } else if (h.lvl < depth) { html += '</ul>'; depth = h.lvl; }
    html += `<li><a href="#${h.id}">${esc(h.text)}</a></li>`;
  }
  if (depth > 2) html += '</ul>';
  return html + '</ul>';
}

function page({ title, meta, body, toc, home }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="page"${toc ? '' : ' style="grid-template-columns: minmax(0, 1fr)"'}>
${toc ? `<nav class="toc" aria-label="Contents">
<a class="home" href="${home}">← All notes</a>
<div class="toc-title">Contents</div>
${toc}
</nav>` : ''}
<main>
<article>
<p class="meta">${esc(meta)}</p>
${body}
</article>
</main>
</div>
${CONTROLS}
<script>${JS}</script>
</body>
</html>
`;
}

// ---------- run ----------
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md') && e.name.toLowerCase() !== 'readme.md') out.push(p);
  }
  return out;
}

const files = walk(DIR).sort();
const items = [];
for (const md of files) {
  const text = fs.readFileSync(md, 'utf8');
  const { html, headings } = renderMarkdown(text);
  const h1 = (html.match(/<h1[^>]*>(.*?)<\/h1>/s) || [])[1];
  const heading = h1 ? stripTags(h1) : path.basename(md, '.md');
  const lede = stripTags((html.match(/<\/h1>\s*<p>(.*?)<\/p>/s) || [])[1] || '').slice(0, 260);
  const rel = path.relative(DIR, md).split(path.sep).join('/');
  const folder = path.dirname(rel) === '.' ? '' : path.dirname(rel);
  const home = `${'../'.repeat(rel.split('/').length - 1)}index.html`;
  const out = md.replace(/\.md$/i, '.html');
  fs.writeFileSync(out, page({ title: `${heading} · SlokAbhyasa notes`, meta: `${folder ? `${folder} · ` : ''}research note · SlokAbhyasa`, body: html, toc: tocHtml(headings), home }));
  items.push({ folder, rel: rel.replace(/\.md$/i, '.html'), heading, lede });
  console.log(`${path.relative(ROOT, out)}  (${Math.round(fs.statSync(out).size / 1024)} KB)`);
}
let list = '';
let lastFolder = null;
for (const it of items) {
  if (it.folder !== lastFolder) { list += `<p class="folder">${esc(it.folder || 'notes')}</p>`; lastFolder = it.folder; }
  list += `<li><a href="${it.rel.split('/').map(encodeURIComponent).join('/')}">${esc(it.heading)}</a><p class="lede">${esc(path.basename(it.rel, '.html'))}${it.lede ? ` · ${esc(it.lede)}…` : ''}</p></li>`;
}
fs.writeFileSync(path.join(DIR, 'index.html'), page({ title: 'SlokAbhyasa research and design notes', meta: 'SlokAbhyasa · research and design notes', body: `<h1>Research and design notes</h1>\n<p>Each note has a table of contents in the margin, text-size and light/dark controls at the bottom right, and prints cleanly. Made by <code>node tools/notes-html.mjs</code>; the Markdown beside each page is the source.</p>\n<ul class="index-list">${list}</ul>`, toc: '', home: '' }));
console.log(`${path.relative(ROOT, path.join(DIR, 'index.html'))}  (${items.length} notes)`);
