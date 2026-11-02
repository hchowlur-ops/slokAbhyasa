import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown } from '../tools/note-md.mjs';

test('headings, paragraphs, inline marks and links come through; styles and scripts do not', () => {
  const md = htmlToMarkdown(`<!doctype html><html><head><title>T</title><style>body{}</style></head><body>
<main><p class="muted">SlokAbhyasa debug note</p><h1>A &amp; B</h1>
<p>Some <b>bold</b>, <i>italic</i>, <code>x &lt; y</code> and <a href="other.html">a link</a>, <a href="https://a.b/c.html">outside</a>.</p>
<script>alert(1)</script><h2>Next</h2><p>Second   paragraph
across lines.</p></main></body></html>`);
  assert.equal(md, `SlokAbhyasa debug note

# A & B

Some **bold**, *italic*, \`x < y\` and [a link](other.md), [outside](https://a.b/c.html).

## Next

Second paragraph across lines.
`);
});

test('lists stay tight, ordered lists count, nested items indent', () => {
  const md = htmlToMarkdown('<ul><li>one</li><li>two<ul><li>two a</li></ul></li></ul><ol><li>first</li><li>second</li></ol>');
  assert.equal(md, `- one
- two
  - two a

1. first
2. second
`);
});

test('tables become pipe tables with a header row, line breaks and pipes kept readable', () => {
  const md = htmlToMarkdown('<table><tr><th>Sloka</th><th class="n">Δ</th></tr><tr><td>CH18-03</td><td>0.20–19.30<br><small>×0.99 · a|b</small></td></tr><tr><td>CH18-04</td><td></td></tr></table>');
  assert.equal(md, `| Sloka | Δ |
| --- | --- |
| CH18-03 | 0.20–19.30<br>×0.99 · a\\|b |
| CH18-04 |  |
`);
});

test('pre blocks are fenced, mermaid keeps its language, entities are decoded, tags inside dropped', () => {
  const md = htmlToMarkdown('<p>Before</p><pre class="mermaid">flowchart LR\n  A --&gt; B</pre><pre><code>if (a &lt; b) <b>x</b></code></pre>');
  assert.equal(md, `Before

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

\`\`\`
if (a < b) x
\`\`\`
`);
});

test('details, summary and figcaption are kept as text', () => {
  const md = htmlToMarkdown('<details><summary>The log</summary><p>tick</p></details><figure><pre>x</pre><figcaption>What it shows</figcaption></figure>');
  assert.equal(md, `**The log**

tick

\`\`\`
x
\`\`\`

*What it shows*
`);
});
