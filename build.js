#!/usr/bin/env node
/**
 * build.js — combines /content (Markdown) + /design (CSS/HTML template)
 * into the published static site (index.html, a/*.html, assets/*, ...).
 *
 * Run:  node build.js
 * See README.md for the content authoring guide.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const MarkdownIt = require('markdown-it');

const ROOT = __dirname;
const CONTENT_DIR = path.join(ROOT, 'content');
const DESIGN_DIR = path.join(ROOT, 'design');
const OUT_DIR = ROOT;
const ASSETS_OUT = path.join(OUT_DIR, 'assets');

// ===================== markdown-it instance =====================
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

// h5 ("##### Label") is repurposed as a small section label above a table,
// e.g. ##### 요약  ->  <div class="section-label">요약</div>
const defaultHeadingOpen = md.renderer.rules.heading_open;
md.renderer.rules.heading_open = function (tokens, idx, options, env, self) {
  if (tokens[idx].tag === 'h5') return '<div class="section-label">';
  return defaultHeadingOpen ? defaultHeadingOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
};
const defaultHeadingClose = md.renderer.rules.heading_close;
md.renderer.rules.heading_close = function (tokens, idx, options, env, self) {
  if (tokens[idx].tag === 'h5') return '</div>';
  return defaultHeadingClose ? defaultHeadingClose(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
};

// tables: wrap in .table-wrap, and auto-mono any first-column cell that's a
// bare 4-digit year or a "M1-2" style month code (no styling info in content).
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>';
md.renderer.rules.table_close = () => '</table></div>';
const MONO_CELL = /^(\d{4}|M\d+(?:[–-]\d+)?\+?)$/;
md.renderer.rules.td_open = function (tokens, idx, options, env, self) {
  const inline = tokens[idx + 1];
  const text = inline && inline.type === 'inline' ? inline.content.trim() : '';
  const isFirstCol = tokens[idx].info === undefined && (() => {
    // walk back to see if this is the first <td> in its row
    let i = idx - 1;
    while (i >= 0 && tokens[i].type !== 'tr_open') { if (tokens[i].type === 'td_open') return false; i--; }
    return true;
  })();
  if (isFirstCol && MONO_CELL.test(text)) return '<td class="mono">';
  return self.renderToken(tokens, idx, options);
};

function renderInline(text) {
  return md.renderInline(text || '').trim();
}
// Like renderInline, but a trailing-two-spaces (or backslash) line break
// inside the text becomes a real <br> instead of being escaped as text.
function renderInlineWithBreaks(text) {
  return (text || '').split(/\\\n|  \n/).map(seg => renderInline(seg)).join('<br>');
}
function renderBlock(text) {
  return md.render(text || '').trim();
}

// ===================== directive block extraction =====================
// Splits raw markdown body into an ordered list of {type:'md', text} and
// {type:'directive', name, args, text} chunks. Directives are fenced with
// ":::name args" ... ":::" on their own lines.
function splitDirectives(raw) {
  const lines = (raw || '').split(/\r?\n/);
  const chunks = [];
  let buf = [];
  let i = 0;
  function flushMd() {
    if (buf.length) { chunks.push({ type: 'md', text: buf.join('\n') }); buf = []; }
  }
  while (i < lines.length) {
    const m = /^:::\s*([a-z-]+)\s*(.*)$/.exec(lines[i]);
    if (m) {
      flushMd();
      const name = m[1];
      const args = m[2].trim();
      const inner = [];
      i++;
      while (i < lines.length && lines[i].trim() !== ':::') { inner.push(lines[i]); i++; }
      i++; // skip closing :::
      chunks.push({ type: 'directive', name, args, text: inner.join('\n') });
      continue;
    }
    buf.push(lines[i]);
    i++;
  }
  flushMd();
  return chunks;
}

function splitParagraphs(text) {
  return text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
}

// ---- ::: callout [warn] ----
function renderCallout(text, args) {
  const lines = text.split(/\r?\n/);
  let label = '';
  let rest = lines;
  const m = /^label:\s*(.+)$/.exec(lines[0] || '');
  if (m) { label = m[1].trim(); rest = lines.slice(1); }
  const bodyHtml = splitParagraphs(rest.join('\n')).map(p => '<p>' + renderInlineWithBreaks(p) + '</p>').join('');
  const cls = args === 'warn' ? ' warn' : '';
  return '<div class="callout' + cls + '">' +
    (label ? '<span class="callout-label">' + renderInline(label) + '</span>' : '') +
    bodyHtml + '</div>';
}

// ---- ::: cards ---- (also used for ::: faq)
function splitItems(text) {
  // split on lines starting with "#### "
  const parts = text.split(/\n(?=####\s)/).map(s => s.trim()).filter(Boolean);
  return parts.map(part => {
    const lines = part.split(/\r?\n/);
    const title = lines[0].replace(/^####\s*/, '').trim();
    const body = lines.slice(1).join('\n').trim();
    return { title, body };
  });
}

function renderCards(text) {
  const items = splitItems(text);
  const cols = items.length === 1 ? 'cards-2' : (items.length >= 3 ? 'cards-3' : 'cards-2');
  return '<div class="card-grid ' + cols + '">' +
    items.map(it => '<div class="card"><h4>' + renderInline(it.title) + '</h4>' +
      splitParagraphs(it.body).map(p => '<p>' + renderInline(p) + '</p>').join('') +
      '</div>').join('') +
    '</div>';
}

function renderFaq(text) {
  const items = splitItems(text);
  return '<div class="faq-list">' +
    items.map(it => '<details class="faq-item"><summary>' + renderInline(it.title) + '<span class="faq-icon">+</span></summary><div class="faq-a">' +
      splitParagraphs(it.body).map(p => '<p>' + renderInline(p) + '</p>').join('') +
      '</div></details>').join('') +
    '</div>';
}

// ---- ::: stats ---- ("Arrow | Label" per line)
function renderStats(text) {
  const rows = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return '<div class="stat-grid">' +
    rows.map(row => {
      const [arrow, label] = row.split('|').map(s => s.trim());
      return '<div class="stat"><span class="arrow">' + renderInline(arrow) + '</span><span class="label">' + renderInline(label) + '</span></div>';
    }).join('') +
    '</div>';
}

// ---- ::: timeline ---- (blocks separated by blank lines)
function renderTimeline(text) {
  const blocks = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const rows = blocks.map((block, idx) => {
    const lines = block.split(/\r?\n/);
    const head = lines[0];
    const sep = head.indexOf('|');
    const when = sep === -1 ? '' : head.slice(0, sep).trim();
    const title = sep === -1 ? head.trim() : head.slice(sep + 1).trim();
    const rest = lines.slice(1);
    const listItems = rest.filter(l => /^-\s+/.test(l)).map(l => l.replace(/^-\s+/, '').trim());
    const deliverableLine = rest.find(l => /^산출물:/.test(l.trim()));
    const descLines = rest.filter(l => !/^-\s+/.test(l) && !/^산출물:/.test(l.trim()) && l.trim() !== '');
    let desc = descLines.length ? renderInline(descLines.join(' ')) : '';
    if (listItems.length) desc += '<ul>' + listItems.map(i => '<li>' + renderInline(i) + '</li>').join('') + '</ul>';
    if (deliverableLine) {
      const val = deliverableLine.trim().replace(/^산출물:\s*/, '');
      desc += '<div style="margin-top:6px;font-size:12.5px;color:var(--text-faint)"><strong style="color:var(--text-muted)">산출물</strong> · ' + renderInline(val) + '</div>';
    }
    return { when, title, desc, last: idx === blocks.length - 1 };
  });
  return '<div class="timeline">' + rows.map(r =>
    '<div class="tl-row"><div class="tl-when">' + renderInline(r.when) + '</div><div class="tl-rail"><div class="tl-dot"></div>' +
    (r.last ? '' : '<div class="tl-line"></div>') + '</div><div class="tl-body">' +
    '<div class="tl-title">' + renderInline(r.title) + '</div>' +
    '<div class="tl-desc">' + r.desc + '</div>' +
    '</div></div>'
  ).join('') + '</div>';
}

// ---- ::: diagram <name> ---- (aria: / caption: lines; svg loaded from /design/diagrams/<name>.svg)
const diagramCache = {};
function renderDiagram(text, args) {
  const name = args.trim();
  if (!diagramCache[name]) {
    diagramCache[name] = fs.readFileSync(path.join(DESIGN_DIR, 'diagrams', name + '.svg'), 'utf8');
  }
  const lines = text.split(/\r?\n/);
  let aria = '', caption = '';
  lines.forEach(l => {
    const ma = /^aria:\s*(.+)$/.exec(l);
    const mc = /^caption:\s*(.+)$/.exec(l);
    if (ma) aria = ma[1].trim();
    if (mc) caption = mc[1].trim();
  });
  return '<figure role="img" aria-label="' + aria.replace(/"/g, '&quot;') + '">' +
    diagramCache[name] +
    (caption ? '<figcaption>' + renderInline(caption) + '</figcaption>' : '') +
    '</figure>';
}

// ===================== main body renderer =====================
function renderBody(raw, pageId) {
  const chunks = splitDirectives(raw);
  return chunks.map(c => {
    if (c.type === 'md') return renderBlock(c.text);
    switch (c.name) {
      case 'callout': return renderCallout(c.text, c.args);
      case 'cards': return renderCards(c.text);
      case 'faq': return renderFaq(c.text);
      case 'stats': return renderStats(c.text);
      case 'timeline': return renderTimeline(c.text);
      case 'diagram': return renderDiagram(c.text, c.args);
      default: throw new Error('Unknown directive ::: ' + c.name + ' on page ' + pageId);
    }
  }).join('');
}

// ===================== load content tree =====================
function loadContentTree() {
  const nodesById = {};

  function walkDir(dir, idPrefix) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach(ent => {
      if (ent.name.startsWith('.')) return;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walkDir(full, idPrefix ? idPrefix + '/' + ent.name : ent.name);
      } else if (ent.name.endsWith('.md')) {
        const base = ent.name.replace(/\.md$/, '');
        let id;
        if (base === 'index' && idPrefix === '') id = '';
        else if (base === '_index') id = idPrefix;
        else id = idPrefix ? idPrefix + '/' + base : base;
        const raw = fs.readFileSync(full, 'utf8');
        const fm = matter(raw);
        nodesById[id] = {
          id,
          title: fm.data.title || '',
          summary: fm.data.summary || '',
          intro: fm.data.intro || undefined,
          pill: fm.data.pill || undefined,
          pillClass: fm.data.pillClass || undefined,
          icon: fm.data.icon || undefined,
          heroLogo: !!fm.data.hero_logo,
          order: fm.data.order === undefined ? 0 : fm.data.order,
          bodyRaw: fm.content,
          children: []
        };
      }
    });
  }

  walkDir(CONTENT_DIR, '');

  // link children to parents by id path
  Object.keys(nodesById).forEach(id => {
    if (id === '') return;
    const parentId = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
    const parent = nodesById[parentId];
    if (!parent) throw new Error('Missing parent page for content/' + id + '.md (expected a page at id "' + parentId + '")');
    parent.children.push(nodesById[id]);
  });
  Object.values(nodesById).forEach(n => n.children.sort((a, b) => a.order - b.order));

  // render markdown bodies now that the tree shape is known
  Object.values(nodesById).forEach(n => {
    n.body = renderBody(n.bodyRaw, n.id) || undefined;
    if (n.intro) n.intro = renderInline(n.intro);
  });

  return nodesById[''];
}

// ===================== tiny frontmatter parser (avoids extra deps) =====================
function matter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { data: {}, content: raw };
  const data = yaml.load(m[1]) || {};
  return { data, content: m[2] };
}

module.exports = { loadContentTree };

// ===================== the rest: identical page-shell rendering as before =====================
const TREE = loadContentTree();

const INDEX = {};
(function buildIndex(node, parent, ancestors) {
  const myPath = ancestors.concat([node]);
  const topPillClass = node.id === '' ? null : (myPath[1] ? myPath[1].pillClass : node.pillClass);
  INDEX[node.id] = {
    node, parent, path: myPath, pillClass: topPillClass,
    siblingIds: parent ? parent.children.map(c => c.id) : ['']
  };
  (node.children || []).forEach(child => buildIndex(child, node, myPath));
})(TREE, null, []);

const ALL_IDS = Object.keys(INDEX);

function fileFor(id) { return id === '' ? 'index.html' : id + '.html'; }
function dirDepth(id) { return id === '' ? 0 : id.split('/').length - 1; }
function hrefBetween(fromId, toId) {
  const depth = dirDepth(fromId);
  return (depth > 0 ? '../'.repeat(depth) : '') + fileFor(toId);
}
function assetHref(fromId, assetPath) {
  const depth = dirDepth(fromId);
  return (depth > 0 ? '../'.repeat(depth) : '') + assetPath;
}
function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
function escText(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const ICONS = {
  compass: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><path d="M12.6 7.4l-1.4 3.8-3.8 1.4 1.4-3.8 3.8-1.4z"/></svg>',
  gear: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.8v2M10 15.2v2M17.2 10h-2M4.8 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3L4.9 4.9"/></svg>',
  chat: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.8c0-3.5 3-6.3 7-6.3s7 2.8 7 6.3-3 6.3-7 6.3c-.9 0-1.8-.15-2.6-.44L4 17l1.2-3.2C3.8 12.7 3 11.3 3 9.8z"/></svg>',
  doc: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.8h5.4L15 6.4v10.8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1z"/><path d="M11.2 2.8v3.6H15M7.3 10.6h5.4M7.3 13.4h5.4"/></svg>'
};
const TRACK_ICON = { a: 'compass', b: 'gear', c: 'chat' };
function iconBadge(iconKey, trackClass) {
  return '<span class="icon-badge' + (trackClass ? ' track-' + trackClass : '') + '">' + (ICONS[iconKey] || ICONS.doc) + '</span>';
}

function subtreeSearchText(node) {
  let parts = [node.title];
  (node.children || []).forEach(c => parts.push(subtreeSearchText(c)));
  return parts.join(' ');
}
function renderNodeList(nodes, depth, currentId, fromId) {
  if (!nodes.length) return '';
  return '<ul class="tree-list' + (depth === 0 ? ' root-list' : '') + '">' +
    nodes.map(n => renderNode(n, depth, currentId, fromId)).join('') + '</ul>';
}
function renderNode(n, depth, currentId, fromId) {
  const hasKids = n.children && n.children.length;
  const active = n.id === currentId;
  const indent = depth * 14;
  const searchText = escAttr(subtreeSearchText(n).toLowerCase());
  return '<li class="tree-item" data-search="' + searchText + '">' +
    '<div class="tree-row' + (active ? ' active' : '') + (depth === 0 ? ' top' : '') + '" style="padding-left:' + indent + 'px">' +
    '<span class="tree-toggle-spacer"></span>' +
    '<a class="tree-link" href="' + hrefBetween(fromId, n.id) + '">' + escText(n.title) + '</a>' +
    '</div>' + (hasKids ? renderNodeList(n.children, depth + 1, currentId, fromId) : '') + '</li>';
}

function renderChildGrid(children, showPills, fromId, currentTrack) {
  if (!children || !children.length) return '';
  const cols = children.length === 1 ? 'cards-2' : (children.length >= 3 ? 'cards-3' : 'cards-2');
  return '<div class="section-label">이 섹션의 내용</div><div class="card-grid ' + cols + '">' +
    children.map(c => '<a class="track-card child-card" href="' + hrefBetween(fromId, c.id) + '">' +
      (showPills ? iconBadge(TRACK_ICON[c.pillClass] || 'doc', c.pillClass) : '') +
      '<h3>' + escText(c.title) + '</h3><p>' + (c.summary ? escText(c.summary) : '') + '</p>' +
      '<span class="go">읽기 →</span></a>').join('') + '</div>';
}
function renderCrumbs(entryPath, fromId) {
  return entryPath.map((n, i) => {
    const label = n.id === '' ? 'aisight 도움말' : n.title;
    if (i === entryPath.length - 1) return '<span class="crumb-current">' + escText(label) + '</span>';
    return '<a href="' + hrefBetween(fromId, n.id) + '">' + escText(label) + '</a>';
  }).join('<span class="crumb-sep">›</span>');
}
function pageMeta(node) {
  const desc = node.summary || node.intro || 'aisight 도움말';
  const title = node.id === '' ? 'aisight 도움말' : node.title + ' | aisight 도움말';
  return { title, desc };
}

const TEMPLATE = fs.readFileSync(path.join(DESIGN_DIR, 'template.html'), 'utf8');

function renderFullPage(id) {
  const entry = INDEX[id];
  const node = entry.node;
  const entryPath = entry.path;
  const { title: pageTitle, desc } = pageMeta(node);
  const crumbsHtml = renderCrumbs(entryPath, id);

  let doc = '';
  if (node.id === '') {
    doc += '<div class="eyebrow">시작하기</div>';
  } else {
    doc += '<div class="eyebrow track-' + entry.pillClass + '">' + escText(entryPath[1].title) + '</div>';
  }
  doc += '<h1>' + escText(node.title) + '</h1>';
  if (node.heroLogo) {
    doc += '<div class="about-hero"><img class="about-logo" src="' + assetHref(id, 'assets/about-hero-logo.png') + '" alt="Sailingstone 로고" />' +
      (node.intro ? '<p class="lede" style="margin:0;">' + node.intro + '</p>' : '') + '</div>';
  } else if (node.intro) {
    doc += '<p class="lede">' + node.intro + '</p>';
  }
  if (node.body) doc += node.body;
  doc += renderChildGrid(node.children, node.id === '', id, entry.pillClass);

  if (node.id !== '') {
    const sibs = entry.siblingIds;
    const idx = sibs.indexOf(node.id);
    const prevId = idx > 0 ? sibs[idx - 1] : null;
    const nextId = idx < sibs.length - 1 ? sibs[idx + 1] : null;
    if (prevId || nextId) {
      doc += '<div class="page-nav">' +
        (prevId ? '<a class="page-nav-link prev" href="' + hrefBetween(id, prevId) + '"><span class="pn-dir">← 이전</span><span class="pn-title">' + escText(INDEX[prevId].node.title) + '</span></a>' : '<span class="page-nav-spacer"></span>') +
        (nextId ? '<a class="page-nav-link next" href="' + hrefBetween(id, nextId) + '"><span class="pn-dir">다음 →</span><span class="pn-title">' + escText(INDEX[nextId].node.title) + '</span></a>' : '<span class="page-nav-spacer"></span>') +
        '</div>';
    }
  }

  const treeHtml = renderNodeList(TREE.children, 0, id, id);

  return TEMPLATE
    .replace(/\{\{PAGE_TITLE\}\}/g, escText(pageTitle))
    .replace(/\{\{PAGE_DESC\}\}/g, escAttr(desc))
    .replace(/\{\{CSS_HREF\}\}/g, assetHref(id, 'assets/style.css'))
    .replace(/\{\{NAV_JS_HREF\}\}/g, assetHref(id, 'assets/nav.js'))
    .replace(/\{\{ROOT_HREF\}\}/g, hrefBetween(id, ''))
    .replace(/\{\{FOOTER_LOGO_HREF\}\}/g, assetHref(id, 'assets/about-hero-logo.png'))
    .replace(/\{\{TREE_NAV\}\}/g, treeHtml)
    .replace(/\{\{CRUMBS\}\}/g, crumbsHtml)
    .replace(/\{\{DOC_BODY\}\}/g, doc);
}

// ===================== write output =====================
fs.mkdirSync(ASSETS_OUT, { recursive: true });
fs.copyFileSync(path.join(DESIGN_DIR, 'style.css'), path.join(ASSETS_OUT, 'style.css'));
fs.copyFileSync(path.join(DESIGN_DIR, 'nav.js'), path.join(ASSETS_OUT, 'nav.js'));
fs.copyFileSync(path.join(DESIGN_DIR, 'images', 'about-hero-logo.png'), path.join(ASSETS_OUT, 'about-hero-logo.png'));

let count = 0;
ALL_IDS.forEach(id => {
  const html = renderFullPage(id);
  const outFile = path.join(OUT_DIR, fileFor(id));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html, 'utf8');
  count++;
});

console.log('Built', count, 'pages from /content into', OUT_DIR);
console.log('Preview: node _serve.js   (then open http://localhost:4173)');
