#!/usr/bin/env node
// Markdown twins of the HTML debug notes, for reading by agents and search tools.
//
//     node tools/note-md.mjs                  → debug-notes/*.html → *.md where none exists
//     node tools/note-md.mjs some/folder      → the same for another folder
//     node tools/note-md.mjs a-note.html      → one file
//     node tools/note-md.mjs --force          → rewrite the twins that exist too
//
// The HTML page is the source; the twin is derived. Headings, paragraphs, lists, tables,
// code and mermaid blocks, links (to a page's .md twin where the page has one), bold,
// italics and code spans come through; styles, scripts and SVG are dropped. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', middot: '·', times: '×', rarr: '→', larr: '←' };
export function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    const k = e.toLowerCase();
    return k in ENT ? ENT[k] : m;
  });
}
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? decode(m[2] ?? m[3] ?? m[4]) : null; };

const CONTAINER = new Set(['p', 'div', 'figure', 'details', 'blockquote', 'main', 'section', 'article', 'body', 'html', 'header', 'footer', 'nav', 'aside', 'thead', 'tbody', 'tfoot']);
const SKIP = new Set(['style', 'script', 'head', 'title', 'svg', 'noscript', 'template']);

function tableMd(rows) {
  rows = rows.filter((r) => r.length);
  if (!rows.length) return '';
  const w = Math.max(...rows.map((r) => r.length));
  const line = (r) => '| ' + Array.from({ length: w }, (_, i) => (r[i] ? r[i].text : '')).join(' | ') + ' |';
  const header = rows[0].some((c) => c.th) ? rows.shift() : Array.from({ length: w }, () => ({ text: '' }));
  return [line(header), '| ' + Array.from({ length: w }, () => '---').join(' | ') + ' |', ...rows.map(line)].join('\n');
}

// HTML → Markdown. `linkExt`: relative links to .html pages are pointed at that extension
// instead (the page's twin); null leaves them.
export function htmlToMarkdown(html, { linkExt = '.md' } = {}) {
  const out = [];           // finished blocks: { t, kind }
  let para = '';            // the inline text being gathered
  const stack = [];         // open tags
  const lists = [];         // { ordered, n }
  let table = null;         // { rows, row, cell }
  let pre = null;           // { lang, text }
  let skip = 0;             // depth inside a skipped element
  let link = null;          // href of the open <a>
  let kind = 'block';
  let indent = '';          // a list item's indentation, kept outside the trimmed text
  const push = (t, k) => { if (t) out.push({ t, kind: k }); };
  const flush = () => { const t = para.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); push(t && indent + t, kind); para = ''; kind = 'block'; indent = ''; };
  const text = (s) => { if (table && table.cell != null) { table.cell += s; return; } para += s; };
  const re = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g;
  let m;
  while ((m = re.exec(html))) {
    const tok = m[0];
    if (tok.startsWith('<!')) continue;
    if (tok[0] !== '<') {
      if (skip) continue;
      if (pre) { pre.text += tok; continue; }
      let s = decode(tok).replace(/\s+/g, ' ');
      if (table && table.cell != null) s = s.replace(/\|/g, '\\|');
      text(s);
      continue;
    }
    const close = tok[1] === '/';
    const name = tok.replace(/^<\/?/, '').match(/^[a-zA-Z0-9]+/)[0].toLowerCase();
    if (pre) {
      if (close && name === 'pre') {
        // tags inside a code block are dropped; a <br> is a line break, or stays mermaid's own <br/> in a diagram
        const body = decode(pre.text.replace(/<br\s*\/?>/gi, '\u0001').replace(/<[^>]+>/g, '').replace(/\u0001/g, pre.lang === 'mermaid' ? '<br/>' : '\n')).replace(/^\s*\n|\s+$/g, '');
        flush();
        push('```' + pre.lang + '\n' + body + '\n```', 'block');
        pre = null;
      } else pre.text += tok;
      continue;
    }
    if (SKIP.has(name)) { if (!close) skip++; else if (skip) skip--; continue; }
    if (skip) continue;
    if (!close) {
      switch (name) {
        case 'pre': { flush(); const cls = attr(tok, 'class') || ''; pre = { lang: /\bmermaid\b/.test(cls) ? 'mermaid' : '', text: '' }; break; }
        case 'br': text(table && table.cell != null ? '<br>' : '  \n'); break;
        case 'hr': flush(); push('---', 'block'); break;
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': flush(); para += '#'.repeat(+name[1]) + ' '; break;
        case 'figcaption': flush(); para += '*'; break;
        case 'summary': flush(); para += '**'; break;
        case 'ul': case 'ol': flush(); lists.push({ ordered: name === 'ol', n: 0 }); break;
        case 'li': { flush(); const L = lists[lists.length - 1] || { ordered: false, n: 0 }; L.n++; kind = 'li'; indent = '  '.repeat(Math.max(0, lists.length - 1)); para += L.ordered ? `${L.n}. ` : '- '; break; }
        case 'table': flush(); table = { rows: [], row: null, cell: null }; break;
        case 'tr': if (table) { table.row = []; table.rows.push(table.row); } break;
        case 'th': case 'td': if (table && table.row) { table.cell = ''; table.row.push({ th: name === 'th', text: '' }); } break;
        case 'strong': case 'b': text('**'); break;
        case 'em': case 'i': text('*'); break;
        case 'code': text('`'); break;
        case 'a': link = attr(tok, 'href'); text('['); break;
        default: if (CONTAINER.has(name) && !table) flush(); break;
      }
      if (name !== 'br' && name !== 'hr' && !tok.endsWith('/>')) stack.push(name);
      continue;
    }
    const i = stack.lastIndexOf(name);
    if (i >= 0) stack.length = i;
    switch (name) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': flush(); break;
      case 'figcaption': text('*'); flush(); break;
      case 'summary': text('**'); flush(); break;
      case 'li': flush(); break;
      case 'ul': case 'ol': flush(); lists.pop(); if (!lists.length && out.length) out[out.length - 1].end = true; break;
      case 'th': case 'td': if (table && table.row && table.cell != null) { table.row[table.row.length - 1].text = table.cell.replace(/\s+/g, ' ').trim(); table.cell = null; } break;
      case 'tr': if (table) table.row = null; break;
      case 'table': if (table) { flush(); push(tableMd(table.rows), 'block'); table = null; } break;
      case 'strong': case 'b': text('**'); break;
      case 'em': case 'i': text('*'); break;
      case 'code': text('`'); break;
      case 'a': {
        let h = link || '';
        if (linkExt && /^(?!https?:|mailto:|#)[^?#]*\.html?(?=$|[#?])/i.test(h)) h = h.replace(/\.html?(?=$|[#?])/i, linkExt);
        text(h ? `](${h})` : ']');
        link = null;
        break;
      }
      default: if (CONTAINER.has(name) && !table) flush(); break;
    }
  }
  flush();
  let s = '';
  out.forEach((b, i) => { if (i) s += out[i - 1].kind === 'li' && !out[i - 1].end && b.kind === 'li' ? '\n' : '\n\n'; s += b.t; });
  return s.replace(/\n{3,}/g, '\n\n') + '\n';
}

// Writes the twin of one page beside it. Returns its path, or null when it exists and
// `force` is not set.
export function markdownTwin(htmlPath, { force = false } = {}) {
  const mdPath = htmlPath.replace(/\.html?$/i, '.md');
  if (!force && fs.existsSync(mdPath)) return null;
  const base = path.basename(htmlPath);
  const md = `_Markdown twin of [${base}](${base}), written by \`node tools/note-md.mjs\` for reading by agents and search; the HTML page is the source._\n\n` + htmlToMarkdown(fs.readFileSync(htmlPath, 'utf8'));
  fs.writeFileSync(mdPath, md);
  return mdPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const target = path.resolve(ROOT, args.find((a) => !a.startsWith('--')) || 'debug-notes');
  const files = fs.statSync(target).isDirectory() ? fs.readdirSync(target).filter((f) => /\.html?$/i.test(f)).sort().map((f) => path.join(target, f)) : [target];
  let n = 0;
  for (const f of files) { const p = markdownTwin(f, { force }); if (p) { n++; console.log(path.relative(ROOT, p)); } }
  console.log(`${n} written, ${files.length - n} kept`);
}
