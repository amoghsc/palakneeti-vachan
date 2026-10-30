// Live data layer: every article is read straight from palakneeti.in's public
// WordPress API in the browser. Nothing is copied, cached on disk or stored elsewhere.

const API = 'https://palakneeti.in/wp-json/wp/v2/posts';
const CAT_MASIK_ARTICLE = 49;
const FIELDS = 'id,date,link,title,content,excerpt,_links,_embedded';

// WordPress tags/categories → one Marathi topic. Synonyms share a key.
const TOPIC_MAP = {
  'parenting': 'पालकत्व', 'social parenting': 'पालकत्व',
  'challenges before parenting': 'पालकत्व',
  'story': 'गोष्टी', 'story for children': 'गोष्टी', 'russian': 'गोष्टी',
  'when daddy was a little boy': 'गोष्टी',
  'editorial': 'संपादकीय', 'language': 'भाषा', 'adoption': 'दत्तक',
  'translation': 'अनुवाद', 'book introduction': 'पुस्तकं',
  'education': 'शिक्षण', 'movie review': 'सिनेमा', 'tribute': 'आदरांजली',
  'fear': 'मन आणि भावना', 'cultural psychiatry': 'मन आणि भावना',
  'artificial intelligence': 'AI आणि स्क्रीन', 'screen and parenting': 'AI आणि स्क्रीन',
  'sexuality': 'लैंगिकता', 'sexuality & parenting': 'लैंगिकता',
  'sexuality and parenting': 'लैंगिकता',
  'parent-child dialogue': 'संवाद', 'dialogue with the child': 'संवाद',
  'parent-child relationship': 'संवाद', 'defining boundaries': 'संवाद',
  'children & war': 'समाज', 'metaphor': 'समाज',
};
export const TOPICS = [...new Set(Object.values(TOPIC_MAP))];
const IGNORE_TERM = /^(\d{4}|[०-९]{4}|masik.*|palakneeti.*|पालकनीती|uncategorized|original article)$|२०[०-९]{2}|20\d\d/i;

const NAME_REJECT = new Set(['पुस्तक परिचय', 'पालकनीती', 'संपादकीय', 'संवादकीय', 'मनोगत', 'या अंकात', 'अनुक्रम']);

const decoder = document.createElement('textarea');
export function decode(html) { decoder.innerHTML = html; return decoder.value; }

const clean = s => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

function normaliseName(s) {
  return clean(s).replace(/\s*\.\s*/g, '. ').replace(/\.\s*$/, '').trim();
}

function looksLikeName(s) {
  if (!s || s.length < 3 || s.length > 40 || NAME_REJECT.has(s)) return false;
  if (/[?!:…,“”‘’"'()0-9०-९–—]|\.\.\./.test(s)) return false;
  const words = s.split(' ').filter(w => !/^डॉ\.?$/.test(w));
  if (words.length < 1 || words.length > 3) return false;
  // genitive / verb endings mean it is a subtitle, not a person
  return !words.some(w => w.length > 4 && /(च्या|ची|चा|चे|ून|ाला|तेव्हा)$/.test(w));
}

// Marathi topic → WordPress tag ids, so filters can ask the archive directly.
export const topicTagIds = new Map();
const noteTag = (key, t) => {
  if (t.taxonomy !== 'post_tag') return;
  if (!topicTagIds.has(key)) topicTagIds.set(key, new Set());
  topicTagIds.get(key).add(t.id);
};

function topicsFor(terms) {
  const out = [];
  for (const t of terms) {
    const name = decode(t.name).trim();
    if (IGNORE_TERM.test(name)) continue;
    const key = TOPIC_MAP[name.toLowerCase()];
    if (!key) continue;
    noteTag(key, t);
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

function imageFrom(media) {
  if (!media || !media.source_url) return null;
  const s = media.media_details && media.media_details.sizes;
  return (s && (s.large || s.medium_large) || media).source_url;
}

const fileWords = src => {
  try { return decodeURIComponent(src.split('/').pop()).replace(/[-_.]/g, ' '); }
  catch { return ''; }
};

// Turns one WordPress post into an article object. Returns null when no author is found.
function parse(post, lenient = false) {
  const doc = new DOMParser().parseFromString(`<div id="r">${post.content.rendered}</div>`, 'text/html');
  const root = doc.getElementById('r');
  root.querySelectorAll('script,style,noscript,form,.heateor_sss_sharing_container,[class*="sharing"],[class*="sassy"],.jp-relatedposts').forEach(n => n.remove());
  root.querySelectorAll('p').forEach(p => { if (!clean(p.textContent) && !p.querySelector('img,iframe')) p.remove(); });

  // Author: first short line of the article, else a short line at the very end.
  let author = null;
  const first = root.firstElementChild;
  if (first && looksLikeName(normaliseName(first.textContent))) {
    author = normaliseName(first.textContent);
    first.remove();
  } else {
    const tail = [...root.querySelectorAll(':scope > p')].slice(-3).reverse();
    const hit = tail.find(p => looksLikeName(normaliseName(p.textContent)) && p.querySelector('strong,b'));
    if (hit) { author = normaliseName(hit.textContent); hit.remove(); }
  }
  if (!author) {
    if (!lenient) return null;
    author = 'पालकनीती';
  }

  const nameBits = author.split(' ').filter(w => w.length >= 3 && !w.startsWith('डॉ'));

  // Author photo: an uploaded image whose file name carries the author's name.
  let photo = null;
  root.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (!photo && nameBits.some(b => fileWords(src).includes(b))) {
      photo = src;
      (img.closest('figure') || img).remove();
    }
  });

  // Bio: last paragraph that reads like "… करतात / आहेत".
  let bio = '';
  const paras = [...root.querySelectorAll(':scope > p')];
  // Signature block at the end: the author's name on its own line, then an email / short bio.
  const sigAt = paras.slice(-4).findIndex(p => normaliseName(p.textContent) === author);
  if (sigAt >= 0) {
    const tail = paras.slice(paras.length - Math.min(4, paras.length) + sigAt);
    bio = tail.slice(1).map(p => clean(p.textContent)).filter(t => t && !/@|^\+?\d[\d\s-]{7,}$/.test(t)).join(' ');
    tail.forEach(p => p.remove());
    paras.length = 0;
  }
  const lastText = paras.slice(-3).reverse().find(p => {
    const t = clean(p.textContent);
    return t.length > 20 && t.length < 420 &&
      (nameBits.some(b => t.includes(b)) || /(आहेत|करतात|असतात|आहे|करते|करतो|शिकवतात|सदस्य|विद्यार्थिनी|समन्वयक)[.।]?$/.test(t));
  });
  if (lastText) { bio = clean(lastText.textContent); lastText.remove(); }

  root.querySelectorAll('img').forEach(img => {
    img.loading = 'lazy';
    img.removeAttribute('width'); img.removeAttribute('height'); img.removeAttribute('style');
  });
  root.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  root.querySelectorAll('iframe').forEach(f => {
    if (!/youtube|vimeo/.test(f.src)) f.remove(); else f.removeAttribute('width');
  });

  const embedded = post._embedded || {};
  const terms = (embedded['wp:term'] || []).flat();
  let hero = imageFrom((embedded['wp:featuredmedia'] || [])[0]);
  if (!hero) {
    const img = root.querySelector('img');
    if (img) { hero = img.getAttribute('src'); (img.closest('figure') || img).remove(); }
  }

  const text = clean(root.textContent);
  return {
    id: post.id,
    title: decode(post.title.rendered).trim(),
    date: new Date(post.date),
    link: post.link,
    author, authorKey: author.replace(/^डॉ\.\s*/, ''),
    photo, bio, hero,
    topics: topicsFor(terms),
    tagNames: terms.map(t => decode(t.name).toLowerCase()).filter(n => !IGNORE_TERM.test(n)),
    html: root.innerHTML,
    text,
    words: text.split(' ').length,
    excerpt: clean(decode(post.excerpt.rendered.replace(/<[^>]+>/g, ' '))).replace(new RegExp('^' + author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*'), '').slice(0, 220),
  };
}

let nextPage = 1;
export let totalAvailable = 0;

// Fetches the next page of recent articles. Keeps at most `perAuthor` per author
// so the prototype shows many voices.
export async function fetchArticles(existing = [], { perPage = 40, perAuthor = 2 } = {}) {
  const url = `${API}?categories=${CAT_MASIK_ARTICLE}&per_page=${perPage}&page=${nextPage}` +
    `&_embed=wp:featuredmedia,wp:term&_fields=${FIELDS}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`palakneeti.in replied ${res.status}`);
  totalAvailable = +res.headers.get('X-WP-Total') || totalAvailable;
  nextPage++;
  const posts = await res.json();
  const counts = {};
  existing.forEach(a => counts[a.authorKey] = (counts[a.authorKey] || 0) + 1);
  const out = [];
  for (const p of posts) {
    const a = parse(p);
    if (!a || existing.some(e => e.id === a.id)) continue;
    if ((counts[a.authorKey] || 0) >= perAuthor) continue;
    counts[a.authorKey] = (counts[a.authorKey] || 0) + 1;
    out.push(a);
  }
  return out;
}

// All of one author's articles in the full archive, via the site's own search.
export async function fetchByAuthor(au) {
  const url = `${API}?categories=${CAT_MASIK_ARTICLE}&search=${encodeURIComponent(au.key)}&per_page=40` +
    `&_embed=wp:featuredmedia,wp:term&_fields=${FIELDS}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`palakneeti.in replied ${res.status}`);
  return (await res.json()).map(parse).filter(a => a && a.authorKey === au.key);
}

// Rough Devanagari → Latin, enough to find "tushar-paranjape.jpg" for तुषार परांजपे.
const V = { 'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऋ': 'ru', 'ॲ': 'a', 'ऑ': 'o' };
const M = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ृ': 'ru', 'ॅ': 'e', 'ॉ': 'o' };
const C = { 'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
  'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l' };
export function latin(word) {
  let out = '';
  const chars = [...word];
  chars.forEach((ch, i) => {
    const next = chars[i + 1];
    if (V[ch]) out += V[ch];
    else if (M[ch]) out += M[ch];
    else if (ch === 'ं' || ch === 'ँ') out += 'n';
    else if (C[ch]) out += C[ch] + (next && (M[next] || next === '्' || next === '़') ? '' : i === chars.length - 1 ? '' : 'a');
  });
  return out;
}
// consonant skeleton, so kulkarni / kulakarni / kulkarnee all compare equal
export const skel = w => w.toLowerCase().replace(/w/g, 'v').replace(/z/g, 'j').replace(/f/g, 'ph').replace(/q/g, 'k')
  .replace(/x/g, 'ks').replace(/([kgcjtdpbs])h/g, '$1').replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');

// A portrait from the site's media library whose title or file name carries the
// name, in Devanagari or in English spelling.
export async function findPhoto(key) {
  const words = key.split(' ').filter(w => w.length >= 2);
  const first = words[0], last = words[words.length - 1];
  const attempts = [
    { q: key, ok: t => words.every(b => t.includes(b)) },
    { q: latin(first), ok: t => {
      const toks = t.toLowerCase().split(/[^a-z]+/).map(skel);
      return words.length > 1 && toks.includes(skel(latin(first))) && toks.includes(skel(latin(last)));
    } },
  ];
  for (const { q, ok } of attempts) {
    const res = await fetch(`https://palakneeti.in/wp-json/wp/v2/media?search=${encodeURIComponent(q)}&per_page=20&media_type=image&_fields=title,source_url,media_details`);
    if (!res.ok) continue;
    const hit = (await res.json()).find(m => ok(decode(m.title.rendered) + ' ' + fileWords(m.source_url)));
    if (hit) {
      const s = hit.media_details && hit.media_details.sizes;
      return (s && (s.medium || s.thumbnail) || hit).source_url;
    }
  }
  return null;
}

// Every WordPress tag that maps to one of our topics (one request, cached in memory).
let allTags;
export async function loadTopicTags() {
  if (allTags) return allTags;
  allTags = (async () => {
    for (let page = 1; page <= 3; page++) {
      const res = await fetch(`https://palakneeti.in/wp-json/wp/v2/tags?per_page=100&page=${page}&orderby=count&order=desc&_fields=id,name,taxonomy`);
      if (!res.ok) break;
      const tags = await res.json();
      tags.forEach(t => { const key = TOPIC_MAP[decode(t.name).trim().toLowerCase()]; if (key) noteTag(key, { ...t, taxonomy: 'post_tag' }); });
      if (tags.length < 100) break;
    }
  })();
  return allTags;
}

// Asks the whole archive: optional year / month, author name, topic.
export async function fetchFiltered({ year, month, authorKey, topic, page = 1 }) {
  const q = new URLSearchParams({ categories: CAT_MASIK_ARTICLE, per_page: 40, page, _embed: 'wp:featuredmedia,wp:term', _fields: FIELDS });
  if (year) {
    const from = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`;
    const to = month ? new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10) : `${+year + 1}-01-01`;
    q.set('after', from + 'T00:00:00'); q.set('before', to + 'T00:00:00');
  }
  if (authorKey) q.set('search', authorKey);
  if (topic) {
    await loadTopicTags();
    const ids = [...(topicTagIds.get(topic) || [])];
    if (!ids.length) return { articles: [], total: 0 };
    q.set('tags', ids.join(','));
  }
  const res = await fetch(`${API}?${q}`);
  if (!res.ok) throw new Error(`palakneeti.in replied ${res.status}`);
  const total = +res.headers.get('X-WP-Total') || 0;
  let articles = (await res.json()).map(parse).filter(Boolean);
  if (authorKey) articles = articles.filter(a => a.authorKey === authorKey);
  return { articles, total };
}

/* ---------- printed issues (मासिक) ---------- */
const CAT_MASIK_MONTHLY = 48;
// site-structure categories; whatever category is left on an issue is its month
const STRUCTURAL = new Set([7, 43, 44, 47, 48, 49, 50, 51, 52, 116, 168, 602, 603, 605, 671, 680, 693, 728]);
const toAscii = s => s.replace(/[०-९]/g, d => '०१२३४५६७८९'.indexOf(d));

const MONTH_WORDS = [/जाने|jan/i, /फेब्रु|feb/i, /मार्च|march/i, /एप्रि|एप्प्री|april/i, /^मे|\sमे\s|may/i, /जून|june/i, /जुलै|july/i, /ऑगस्ट|aug/i, /सप्टे|sep/i, /ऑक्टो|oct/i, /नोव्हें|nov/i, /डिसें|दिसम|dec/i];
// month number for Jan→Dec ordering; Diwali issues sit between October and November
const monthOf = title => {
  const i = MONTH_WORDS.findIndex(r => r.test(title));
  return i >= 0 ? i + 1 : /दिवाळी/.test(title) ? 10.5 : 13;
};

function issueFrom(p) {
  const terms = ((p._embedded || {})['wp:term'] || []).flat();
  const month = terms.find(t => t.taxonomy === 'category' && !STRUCTURAL.has(t.id) && !/^(\d{4}|[०-९]{4})$/.test(decode(t.name).trim()));
  const media = ((p._embedded || {})['wp:featuredmedia'] || [])[0];
  const title = decode(p.title.rendered).trim();
  const y = toAscii(title).match(/(19|20)\d\d/);
  return {
    id: p.id, title, link: p.link, date: new Date(p.date),
    year: y ? +y[0] : new Date(p.date).getFullYear(),
    monthCat: month ? month.id : null,
    diwali: terms.some(t => t.id === 47) || /दिवाळी/.test(title),
    month: monthOf(title),
    cover: imageFrom(media), coverFull: media && media.source_url,
  };
}

// All monthly issues, newest first (three pages of 100).
let issuesCache;
export function fetchIssues() {
  issuesCache ||= (async () => {
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const res = await fetch(`${API}?categories=${CAT_MASIK_MONTHLY}&per_page=100&page=${page}` +
        `&_embed=wp:featuredmedia,wp:term&_fields=id,date,title,link,_links,_embedded`);
      if (!res.ok) break;
      const posts = await res.json();
      out.push(...posts.map(issueFrom));
      if (posts.length < 100) break;
    }
    return out;
  })().catch(err => { issuesCache = null; throw err; });
  return issuesCache;
}

// One issue in full: PDF link, its own notes and the अनुक्रम (contents list).
// One contents entry from an <li> or a numbered <p>: its title, author and how to find
// the article — a slug, or a post id (old issues link /21965/ or the editor's post.php?post=).
const LINE_NO = /^([०-९\d]+)[.)]\s*/;
function contentsItem(el) {
  const line = clean(el.textContent).replace(LINE_NO, '');
  if (!line) return null;
  const link = [...el.querySelectorAll('a[href]')].find(a => clean(a.textContent)) || el.querySelector('a[href]');
  let slug = null, postId = null;
  if (link) {
    try {
      const u = new URL(link.getAttribute('href'), 'https://palakneeti.in/');
      if (/palakneeti\.in$/.test(u.hostname)) {
        const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
        const q = u.searchParams.get('post') || u.searchParams.get('p');
        if (q) postId = +q;
        else if (/^\d+$/.test(seg)) postId = +seg;
        else if (seg && !/\.php$/.test(seg)) slug = seg;
      }
    } catch { /* malformed link: fall back to the title */ }
  }
  // "title – author": the last dash-part is the author when it is short
  const parts = line.split(/\s+[–—-]\s+/);
  const last = parts.length > 1 ? parts[parts.length - 1].trim() : '';
  // a person (or "a, b"), not a date or a subtitle like "एका चरित्राचा शोध"
  const isAuthor = !!last && last.split(/\s*,\s*/).every(n => { const nm = normaliseName(n.replace(/^(अनु\.|अनुवाद\s*:|डॉ\.)\s*/, '')); return nm.includes(' ') && looksLikeName(nm); })
    && !/(जानेवारी|फेब्रुवारी|मार्च|एप्रिल|मे|जून|जुलै|ऑगस्ट|सप्टेंबर|ऑक्टोबर|नोव्हेंबर|डिसेंबर)/.test(last);
  return { line, title: isAuthor ? parts.slice(0, -1).join(' – ') : line, author: isAuthor ? last : '', slug, postId };
}

// One issue in full: PDF link, its own notes and the अनुक्रम (contents list).
export async function fetchIssue(id) {
  const res = await fetch(`${API}/${id}?_embed=wp:featuredmedia,wp:term&_fields=id,date,title,link,content,_links,_embedded`);
  if (!res.ok) throw new Error(`palakneeti.in replied ${res.status}`);
  const post = await res.json();
  const issue = issueFrom(post);
  const doc = new DOMParser().parseFromString(`<div id="r">${post.content.rendered}</div>`, 'text/html');
  const root = doc.getElementById('r');
  root.querySelectorAll('script,style,.gsp_post_data,[class*="sharing"]').forEach(n => n.remove());
  root.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  const pdf = [...root.querySelectorAll('a[href]')].find(a => {
    try { const u = new URL(a.href); return u.hostname.includes('.') && /पीडीएफ|pdf|drive\.google/i.test(a.textContent + a.href); }
    catch { return false; }
  });
  issue.pdf = pdf ? pdf.href : null;
  issue.contents = [];
  issue.notes = [];
  root.querySelectorAll('p, li').forEach(el => {
    if (el.tagName === 'P' && el.closest('li')) return;
    const t = clean(el.textContent);
    if (!t) return;
    if (el.tagName === 'LI' || LINE_NO.test(t)) { const it = contentsItem(el); if (it) issue.contents.push(it); return; }
    if (/^(या अंकात|अनुक्रम)/.test(t) || /pdf format|पीडीएफ/i.test(t) || (pdf && el.contains(pdf))) return;
    issue.notes.push(el.innerHTML.trim());
  });
  return issue;
}

// The issue's articles that are online: same month category, not the issue post itself.
export async function fetchIssueArticles(monthCat) {
  if (!monthCat) return [];
  const res = await fetch(`${API}?categories=${monthCat}&categories_exclude=${CAT_MASIK_MONTHLY}&per_page=60` +
    `&_embed=wp:featuredmedia,wp:term&_fields=${FIELDS}`);
  if (!res.ok) throw new Error(`palakneeti.in replied ${res.status}`);
  return (await res.json()).map(p => parse(p, true)).filter(Boolean).reverse();
}

// A single article by id, for links opened directly (e.g. after a reload).
export async function fetchArticle(id) {
  const res = await fetch(`${API}/${id}?_embed=wp:featuredmedia,wp:term&_fields=${FIELDS}`);
  if (!res.ok) return null;
  return parse(await res.json(), true);
}

// Turns each अनुक्रम line into an in-app article: by its link to the site, else by the
// issue's month category, else by a title search. Lines with none stay PDF-only.
const letters = t => t.replace(/भाग/g, '').replace(/[^ऀ-ॣ०-ॿa-z0-9]/gi, '');
const sameTitle = (line, title) => {
  const l = letters(line), t = letters(title);
  return !!t && (l.includes(t) || t.includes(l) || (t.length > 10 && l.startsWith(t.slice(0, 14))));
};

export async function resolveIssue(issue) {
  const items = issue.contents.map(c => ({ ...c, article: null }));
  const fetchList = async query => {
    const res = await fetch(`${API}?${query}&_embed=wp:featuredmedia,wp:term&_fields=${FIELDS}`);
    return res.ok ? (await res.json()) : [];
  };
  const slugs = items.filter(i => i.slug).map(i => i.slug);
  const ids = items.filter(i => i.postId).map(i => i.postId);
  const [bySlug, byId] = await Promise.all([
    slugs.length ? fetchList(`slug=${encodeURIComponent(slugs.join(','))}&per_page=100`) : [],
    ids.length ? fetchList(`include=${ids.join(',')}&per_page=100`) : [],
  ]);
  for (const post of bySlug) {
    const item = items.find(i => i.slug && (i.slug === post.slug || decodeURIComponent(post.slug) === i.slug));
    if (item) item.article = parse(post, true);
  }
  for (const post of byId) {
    const item = items.find(i => i.postId === post.id);
    if (item) item.article = parse(post, true);
  }
  if (items.some(i => !i.article) || !items.length) {
    const fromMonth = (await fetchIssueArticles(issue.monthCat).catch(() => [])).filter(a => !items.some(i => i.article && i.article.id === a.id));
    if (!items.length) return fromMonth.map(a => ({ line: a.title, title: a.title, author: a.author, article: a }));
    for (const item of items.filter(i => !i.article)) item.article = fromMonth.find(a => sameTitle(item.line, a.title)) || null;
  }
  await Promise.all(items.filter(i => !i.article).map(async item => {
    const posts = await fetchList(`search=${encodeURIComponent(item.title.slice(0, 60))}&per_page=5`).catch(() => []);
    const hit = posts.find(p => sameTitle(item.line, decode(p.title.rendered)));
    if (hit) item.article = parse(hit, true);
  }));
  // the अनुक्रम knows the author when the article itself doesn't say
  for (const item of items) {
    const a = item.article;
    if (a && a.author === 'पालकनीती' && item.author) { a.author = item.author; a.authorKey = item.author.replace(/^(डॉ\.|अनु\.|अनुवाद\s*:)\s*/, ''); }
  }
  return items;
}

/* ---------- issues not (yet) on palakneeti.in, from amoghsc.github.io/palakneeti-masik ---------- */
const GH = 'https://amoghsc.github.io/palakneeti-masik/';

export async function fetchGhIssues() {
  const res = await fetch(GH);
  if (!res.ok) return [];
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  return [...doc.querySelectorAll('section.issue')].map(sec => {
    const key = (sec.querySelector('a.read')?.getAttribute('href') || '').replace(/\/$/, '');
    const [y, m] = key.split('-').map(Number);
    const pdfA = sec.querySelector('a.pdf');
    const pdf = pdfA ? new URL(pdfA.getAttribute('href'), GH).href : null;
    return {
      id: 'gh-' + key, gh: key, title: clean(sec.querySelector('h2')?.textContent || key),
      year: y, month: m, date: new Date(Date.UTC(y, m - 1, 1)),
      pdf, ghPdf: pdf && pdf.startsWith(GH) ? pdf : null,
      titles: [...sec.querySelectorAll('.titles li')].map(li => clean(li.textContent)),
      cover: null, coverFull: null, diwali: false, monthCat: null,
    };
  }).filter(i => i.year && i.month);
}

// A GitHub-listed issue's contents: titles and authors only; the articles themselves are
// then found on palakneeti.in by title.
export async function fetchGhIssue(base) {
  const res = await fetch(`${GH}${base.gh}/`);
  if (!res.ok) throw new Error(`github replied ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const contents = [...doc.querySelectorAll('nav.contents .toc li')].map(li => {
    const title = clean(li.querySelector('.t')?.textContent || '');
    const author = clean((li.querySelector('.m')?.textContent || '').split('·')[0]).replace(/^अनुवाद\s*:\s*/, 'अनु. ');
    return { line: title, title, author, slug: null, postId: null };
  }).filter(c => c.title);
  return { ...base, contents, notes: [] };
}
