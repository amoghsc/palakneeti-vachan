import { fetchArticles, fetchArticle, fetchByAuthor, fetchFiltered, fetchGhIssue, fetchGhIssues, fetchIssue, fetchIssues, findPhoto, latin, resolveIssue, skel } from './source.js';
import { SUPABASE_URL, SUPABASE_ANON, track, trackView, trackSearch } from './track.js';
import { relate, mr, readMins, mrDate, firstGrapheme } from './text.js';
import { applyDesign, mountSettings, setReadSize, readSize, READ_SIZES, clearColors } from './settings.js';

// articles: the recent list shown on the home page.
// pool: every article fetched so far (recent + authors' archives), all readable.
const S = { articles: [], pool: new Map(), authors: new Map(), topics: [], edges: [], photos: new Map(), issues: new Map() };
const $view = document.getElementById('view');
const $ = (sel, el = document) => el.querySelector(sel);
let teardown = [];

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const topicsOf = a => a.topics.length ? a.topics : ['इतर'];
const topicHref = t => `#/topic/${encodeURIComponent(t)}`;
const kicker = a => a.topics.length ? `<a class="label" href="${topicHref(a.topics[0])}">${esc(a.topics[0])}</a>` : '';
// Bio text with any web address turned into a link that opens in a new tab.
const linkify = text => esc(text).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)]|www\.[^\s<]+[^\s<.,;:!?)])/g,
  u => `<a href="${u.startsWith('www.') ? 'https://' + u : u}" target="_blank" rel="noopener">${u}</a>`);
const pref = (k, d) => { try { return localStorage.getItem('vachan.' + k) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('vachan.' + k, v); } catch { /* private mode */ } };
const authorHref = key => `#/author/${encodeURIComponent(key)}`;
const minutes = a => `${mr(readMins(a))} मिनिटांचं वाचन`;
const byDate = (x, y) => y.date - x.date;

function portrait(key, name, size) {
  const photo = S.photos.get(key);
  const s = size ? ` style="--s:${size}px"` : '';
  return `<span class="av" data-k="${esc(key)}"${s}>${photo ? `<img src="${esc(photo)}" alt="${esc(name)}" loading="lazy">` : esc(firstGrapheme(name))}</span>`;
}
// Author name with a thumbnail sized by the surrounding text (CSS .who .av uses em).
const who = (key, name) => `<a class="who" href="${authorHref(key)}">${portrait(key, name)}<span>${esc(name)}</span></a>`;
// Image, or a calm placeholder so every card has the same shape.
const media = a => a.hero ? `<img src="${esc(a.hero)}" alt="" loading="lazy">` : placeholder(a.id);

// A small abstract composition — arcs, a sun, a few lines — that is always the
// same for the same article, drawn in the page's own accent and ink colours.
function placeholder(seed) {
  let x = (typeof seed === 'number' ? seed : hashId(String(seed))) % 2147483647 || 7;
  const rnd = () => (x = x * 16807 % 2147483647) / 2147483647;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const shapes = [];
  const cx = 60 + rnd() * 180, cy = 40 + rnd() * 120, r = 50 + rnd() * 70;
  shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--accent)" opacity="${(.10 + rnd() * .1).toFixed(2)}"/>`);
  for (let i = 0; i < 3; i++) {
    const rr = 30 + rnd() * 110, ax = rnd() * 300, ay = rnd() * 200;
    shapes.push(`<circle cx="${ax}" cy="${ay}" r="${rr}" fill="none" stroke="var(--accent)" stroke-width="${pick([1, 1.5, 2])}" opacity="${(.25 + rnd() * .3).toFixed(2)}"/>`);
  }
  const lines = 3 + Math.floor(rnd() * 4), ly = 120 + rnd() * 60;
  for (let i = 0; i < lines; i++) shapes.push(`<line x1="0" x2="300" y1="${ly + i * 8}" y2="${ly + i * 8 - 30 + rnd() * 60}" stroke="var(--ink)" stroke-width=".7" opacity=".18"/>`);
  shapes.push(`<circle cx="${40 + rnd() * 220}" cy="${30 + rnd() * 140}" r="${6 + rnd() * 10}" fill="var(--accent)" opacity=".55"/>`);
  return `<svg class="ph-art" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="300" height="200" fill="var(--paper-2)"/>${shapes.join('')}</svg>`;
}

function rebuild() {
  const all = [...S.pool.values()];
  const counts = new Map();
  S.articles.forEach(a => topicsOf(a).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  S.topics = [...counts].sort((x, y) => y[1] - x[1]).map(([name, count]) => ({ name, count }));
  S.edges = relate(all, { top: 3 });
  for (const a of all) {
    if (!S.authors.has(a.authorKey)) S.authors.set(a.authorKey, { key: a.authorKey, name: a.author, bio: '', articles: [] });
    const au = S.authors.get(a.authorKey);
    if (!au.articles.includes(a)) au.articles.push(a);
    au.articles.sort(byDate);
    if (a.bio.length > au.bio.length) au.bio = a.bio;
    if (a.photo && !S.photos.has(a.authorKey)) S.photos.set(a.authorKey, a.photo);
  }
}
const authorList = () => [...S.authors.values()].filter(au => S.articles.some(a => a.authorKey === au.key))
  .sort((x, y) => x.key.localeCompare(y.key, 'mr'));

function addToPool(list) {
  list.forEach(a => { if (!S.pool.has(a.id)) S.pool.set(a.id, a); });
}

async function loadMore() {
  const fresh = await fetchArticles(S.articles, { perAuthor: 3 });
  S.articles.push(...fresh.filter(a => !S.articles.some(b => b.id === a.id)));
  S.articles.sort(byDate);
  addToPool(fresh);
  rebuild();
  lookUpPhotos();
  return fresh.length;
}

// Authors without an in-article photo: ask the site's media library, then swap
// the initials for the portrait wherever it is on screen.
async function lookUpPhotos(extraKeys = []) {
  const missing = [...new Set([...S.authors.keys(), ...extraKeys])].filter(k => k && !S.photos.has(k) && !lookUpPhotos.tried.has(k));
  missing.forEach(k => lookUpPhotos.tried.add(k));
  await Promise.all(missing.map(async k => {
    const url = await findPhoto(k).catch(() => null);
    if (!url) return;
    S.photos.set(k, url);
    document.querySelectorAll(`.av[data-k="${CSS.escape(k)}"]`).forEach(el => {
      el.innerHTML = `<img src="${esc(url)}" alt="" loading="lazy">`;
    });
  }));
}
lookUpPhotos.tried = new Set();

// Stretched-link cards: the title link covers the card, the author link sits above it.
function entry(a, { excerpt = true, why = '', from = '' } = {}) {
  return `<div class="entry card">
    <div class="ph">${media(a)}</div>
    ${kicker(a)}
    <h3><a class="card-link" href="#/a/${a.id}${from ? `?from=${from}` : ''}">${esc(a.title)}</a></h3>
    <span class="meta">${who(a.authorKey, a.author)}<span class="dot">·</span>${mr(readMins(a))} मिनिटं</span>
    ${excerpt ? `<p>${esc(a.excerpt)}…</p>` : ''}
    ${why ? `<span class="why">${esc(why)}</span>` : ''}
  </div>`;
}

function rowList(list, { showAuthor = true } = {}) {
  return `<ul class="rows">${list.map(a => `<li><div class="ri card">
    <div>${kicker(a)}<h3><a class="card-link" href="#/a/${a.id}">${esc(a.title)}</a></h3><p>${esc(a.excerpt)}…</p>
      <span class="meta">${showAuthor ? who(a.authorKey, a.author) + '<span class="dot">·</span>' : ''}${mrDate(a.date)}<span class="dot">·</span>${minutes(a)}</span></div>
    <div class="thumb">${media(a)}</div>
  </div></li>`).join('')}</ul>`;
}

/* ---------- home ---------- */
const F = { year: '', month: '', author: '', topic: '', page: 1, results: null, total: 0 };
const MONTHS = ['जानेवारी', 'फेब्रुवारी', 'मार्च', 'एप्रिल', 'मे', 'जून', 'जुलै', 'ऑगस्ट', 'सप्टेंबर', 'ऑक्टोबर', 'नोव्हेंबर', 'डिसेंबर'];
const filtering = () => !!(F.year || F.month);

function filterBar() {
  const years = [];
  for (let y = new Date().getFullYear(); y >= 2010; y--) years.push(y);
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
  return `<div class="filters" id="filters">
    <select name="year" class="${F.year ? 'set' : ''}" aria-label="वर्ष">${opt('', 'सर्व वर्षं', F.year)}${years.map(y => opt(y, mr(y), F.year)).join('')}</select>
    <select name="month" class="${F.month ? 'set' : ''}" aria-label="महिना">${opt('', 'सर्व महिने', F.month)}${MONTHS.map((m, i) => opt(i + 1, m, F.month)).join('')}</select>
    ${filtering() ? '<button class="clear" type="button" data-clear>फिल्टर काढा</button>' : ''}
    <span class="status" id="fstatus"></span>
  </div>`;
}

let filterRun = 0;
async function runFilter(append) {
  const run = ++filterRun;
  const status = $('#fstatus'), grid = $('#grid'), more = $('#more');
  if (!append) { F.page = 1; F.results = []; grid.innerHTML = ''; }
  status.textContent = 'palakneeti.in च्या संग्रहात शोधत आहोत…';
  more.hidden = true;
  try {
    let articles, total;
    if (F.month && !F.year) {
      // one live query per year for that month, newest year first
      const years = [];
      for (let y = new Date().getFullYear(); y >= 2018; y--) years.push(y);
      const all = await Promise.all(years.map(y => fetchFiltered({ year: y, month: F.month }).catch(() => ({ articles: [] }))));
      articles = all.flatMap(r => r.articles);
      total = articles.length;
    } else {
      ({ articles, total } = await fetchFiltered({ year: F.year, month: F.month, authorKey: F.author, topic: F.topic, page: F.page }));
    }
    if (run !== filterRun) return;
    addToPool(articles); rebuild(); lookUpPhotos();
    F.results.push(...articles.filter(a => !F.results.some(b => b.id === a.id)));
    F.total = F.author ? F.results.length : total;
    grid.innerHTML = F.results.map(a => entry(a)).join('');
    status.textContent = F.results.length ? `${mr(F.total)} लेख` : 'या निवडीत लेख सापडले नाहीत.';
    more.hidden = F.author ? articles.length < 1 || F.page * 40 >= total : F.results.length >= total;
  } catch (err) {
    if (run === filterRun) status.textContent = 'संग्रहाशी संपर्क झाला नाही.';
  }
}

function home() {
  const rest = S.articles;
  $view.innerHTML = `<div class="wrap fade-in">
    <div class="issue-hero" id="issueHero"><div class="ih-cover"></div><div class="ih-text"><p class="loading">ताजा अंक आणत आहोत…</p></div></div>
    <section class="recent">
      <div class="sec-title"><h2>लेख</h2></div>
      ${filterBar()}
      <div class="grid" id="grid">${filtering() && F.results ? F.results.map(a => entry(a)).join('') : rest.map(a => entry(a)).join('')}</div>
    </section>
    <div class="more"><button id="more" type="button">आणखी लेख</button></div>
    <div class="two-up">
      <section>
        <div class="sec-title"><h2>विषयांनुसार</h2></div>
        <ul class="index-list">${S.topics.map(t => `<li><a href="#/topic/${encodeURIComponent(t.name)}">${esc(t.name)}</a><span class="n">${mr(t.count)}</span></li>`).join('')}</ul>
      </section>
      <section>
        <div class="sec-title"><h2>या अंकांतले लेखक</h2></div>
        <div class="faces">${authorList().map(au => `<a class="face" href="${authorHref(au.key)}">${portrait(au.key, au.name, 58)}${esc(au.name)}</a>`).join('')}</div>
      </section>
    </div>
  </div>`;
  fillHero();
  if (filtering()) runFilter(false);
  $('#filters').addEventListener('change', e => {
    const { name, value } = e.target;
    F[name] = value;
    const y = scrollY; home(); scrollTo(0, y);
    if (!filtering()) F.results = null;
  });
  $('#filters').addEventListener('click', e => {
    if (!e.target.closest('[data-clear]')) return;
    Object.assign(F, { year: '', month: '', author: '', topic: '', results: null });
    const y = scrollY; home(); scrollTo(0, y);
  });
  $('#more').onclick = async e => {
    if (filtering()) { F.page++; return runFilter(true); }
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'आणत आहोत…';
    try { await loadMore(); const y = scrollY; home(); scrollTo(0, y); }
    catch { b.disabled = false; b.textContent = 'पुन्हा प्रयत्न करा'; }
  };
}

/* ---------- article ---------- */
function bodyHtml(a) {
  const box = document.createElement('div');
  box.innerHTML = a.html;
  box.querySelectorAll('p').forEach(p => {
    const b = p.querySelector('strong, b');
    if (b && b.textContent.trim().length > 2 && b.textContent.trim() === p.textContent.trim()) p.classList.add('subhead');
  });
  const firstP = [...box.querySelectorAll('p')].find(p => p.textContent.trim().length > 40);
  if (firstP) {
    // some posts hand-set a drop letter as <strong>अ</strong>सं — fold it back into the word
    const lead = firstP.firstElementChild;
    if (lead && /^(STRONG|B)$/.test(lead.tagName) && lead.textContent.trim().length <= 2 && firstP.firstChild === lead) {
      lead.replaceWith(lead.textContent);
      firstP.normalize();
    }
    const w = document.createTreeWalker(firstP, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode()) && !n.textContent.trim());
    if (n) {
      const t = n.textContent.replace(/^\s+/, '');
      const cut = t.search(/\s/);
      if (cut > 0) {
        const span = document.createElement('span');
        span.className = 'first-word';
        span.textContent = t.slice(0, cut);
        n.textContent = t.slice(cut);
        n.parentNode.insertBefore(span, n);
      }
    }
  }
  return box.innerHTML;
}

async function article(id, from) {
  let a = S.pool.get(id);
  if (!a) {
    $view.innerHTML = `<p class="loading">लेख आणत आहोत…</p>`;
    a = await fetchArticle(id).catch(() => null);
    if (location.hash.split('?')[0] !== `#/a/${id}`) return;
    if (!a) { $view.innerHTML = `<div class="page-head"><h1>हा लेख सापडला नाही</h1><p><a class="read-link" href="#/">मुखपृष्ठावर परत</a></p></div>`; return; }
    addToPool([a]); rebuild(); lookUpPhotos();
    a = S.pool.get(id); // another fetch (e.g. AI picks) may have stored its copy first; that one carries .related
  }
  const issue = from && S.issues.get(issueId(from));
  document.title = `${a.title} · पालकनीती`;
  if (!S.authors.has(a.authorKey) || !a.related) { addToPool([a]); rebuild(); a = S.pool.get(id); }
  const au = S.authors.get(a.authorKey);
  const others = au.articles.filter(b => b.id !== a.id).slice(0, 4);
  $view.innerHTML = `${from ? crumbs([['मासिक', '#/masik'], [issue ? issue.title : '…', `#/masik/${from}`], [a.title]]) : ''}<article class="article fade-in">
    <header class="a-head">
      <span class="label">${a.topics.map(t => `<a href="${topicHref(t)}">${esc(t)}</a>`).join(' · ')}</span>
      <h1>${esc(a.title)}</h1>
      <p class="dek">${esc(a.excerpt)}…</p>
      <div class="byline">${portrait(a.authorKey, a.author, 50)}
        <div><a class="name" href="${authorHref(a.authorKey)}">${esc(a.author)}</a>
        <span class="meta">${mrDate(a.date)}<span class="dot">·</span>${minutes(a)}</span></div>
      </div>
    </header>
    ${a.hero ? `<figure class="a-figure"><img src="${esc(a.hero)}" alt=""></figure>` : ''}
    <div class="body" id="body">${bodyHtml(a)}</div>
    <div class="fleuron">॥ ॥</div>
    <aside class="about-author" ${a.author === 'पालकनीती' ? 'hidden' : ''}>
      ${portrait(a.authorKey, a.author)}
      <div>
        <span class="label">लेखकाविषयी</span>
        <h4><a href="${authorHref(a.authorKey)}">${esc(a.author)}</a></h4>
        ${au.bio ? `<p>${linkify(au.bio)}</p>` : ''}
        ${others.length ? `<div class="others">याच लेखकाचे: ${others.map(b => `<a href="#/a/${b.id}">${esc(b.title)}</a>`).join(', ')}</div>` : ''}
      </div>
    </aside>
    <div class="source">
      <span>मूळ प्रकाशन: <a href="${esc(a.link)}" target="_blank" rel="noopener">palakneeti.in</a>, ${mrDate(a.date)}</span>
      <a href="#/graph?focus=${a.id}">जाळ्यात पाहा</a>
      <a href="https://wa.me/?text=${encodeURIComponent(a.title + ' — ' + a.author + '\n' + a.link)}" target="_blank" rel="noopener">WhatsApp वर पाठवा</a>
    </div>
    <nav class="issue-nav" id="issueNav" hidden></nav>
    <section class="further">
      <div class="sec-title"><h2>पुढील वाचन</h2></div>
      <div class="grid">${a.related.map(r => entry(r.article, { excerpt: false, why: r.why.length ? 'समान धागा: ' + r.why.join(', ') : '' })).join('')}</div>
    </section>
  </article>`;
  scrollTo(0, 0);
  if (from) fillIssueNav(id, from);
  if (from && !issue) loadIssue(issueId(from)).then(({ issue: i }) => {
    const c = $view.querySelector('.crumbs a[href="#/masik/' + from + '"]');
    if (c) c.textContent = i.title;
  }).catch(() => {});
  $('#readerOpts').hidden = false;
  paintSizes();
  const bar = $('#progress'), body = $('#body');
  const onScroll = () => {
    const p = (scrollY + innerHeight * .5 - body.offsetTop) / body.offsetHeight;
    bar.style.width = Math.min(100, Math.max(0, p * 100)) + '%';
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  teardown.push(() => {
    removeEventListener('scroll', onScroll);
    bar.style.width = 0;
    $('#readerOpts').hidden = true;
  });
}

// Five article text sizes; the middle one is the default.
// Two buttons step through the five article sizes; the middle one is the default.
function paintSizes() {
  const i = READ_SIZES.indexOf(readSize());
  $('#readerOpts').innerHTML = `<button type="button" class="size" data-step="-1" ${i <= 0 ? 'disabled' : ''} aria-label="अक्षर लहान" title="अक्षर लहान" style="font-size:14px">अ</button>
    <button type="button" class="size" data-step="1" ${i >= READ_SIZES.length - 1 ? 'disabled' : ''} aria-label="अक्षर मोठं" title="अक्षर मोठं" style="font-size:20px">अ</button>`;
}
$('#readerOpts').addEventListener('click', e => {
  const b = e.target.closest('[data-step]');
  if (!b) return;
  const i = Math.max(0, READ_SIZES.indexOf(readSize()));
  setReadSize(READ_SIZES[Math.min(READ_SIZES.length - 1, Math.max(0, i + +b.dataset.step))]);
  paintSizes();
});

/* ---------- authors ---------- */
const LETTERS = 'अ आ इ ई उ ऊ ए ऐ ओ औ क ख ग घ च छ ज झ ट ठ ड ढ ण त थ द ध न प फ ब भ म य र ल व श ष स ह ळ क्ष ज्ञ'.split(' ');
const initialOf = key => ['क्ष', 'ज्ञ'].find(c => key.startsWith(c)) || key.charAt(0);

function authors() {
  const list = authorList();
  const have = new Set(list.map(au => initialOf(au.key)));
  $view.innerHTML = `<div class="fade-in">
    <header class="page-head"><h1>लेखक</h1><p>पालकनीतीत लिहिणारे पालक, शिक्षक, अभ्यासक आणि कार्यकर्ते. नावावर क्लिक करून त्यांच्याविषयी आणि त्यांचं लेखन वाचा.</p></header>
    <div class="wrap">
      <nav class="alphabet" aria-label="अक्षरानुसार">${LETTERS.map(l => `<button type="button" data-l="${l}" ${have.has(l) ? '' : 'disabled'}>${l}</button>`).join('')}</nav>
      <div class="roster">${list.map(au => `<a href="${authorHref(au.key)}" data-l="${initialOf(au.key)}">${portrait(au.key, au.name)}
        <span><span class="nm">${esc(au.name)}<span class="c">(${mr(au.articles.length)} लेख)</span></span>
        ${au.bio ? `<span class="meta roster-bio">${esc(au.bio)}</span>` : ''}</span></a>`).join('')}</div>
    </div>
  </div>`;
  const bar = $view.querySelector('.alphabet');
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-l]:not(:disabled)'); if (!b) return;
    const turnOff = b.classList.contains('on');
    bar.querySelectorAll('.on').forEach(x => x.classList.remove('on'));
    $view.querySelectorAll('.roster a.picked').forEach(a => a.classList.remove('picked'));
    if (turnOff) return;
    b.classList.add('on');
    const picked = $view.querySelectorAll(`.roster a[data-l="${b.dataset.l}"]`);
    picked.forEach(a => a.classList.add('picked'));
    picked[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function authorBody(au) {
  const list = au.articles;
  const oldest = list[list.length - 1];
  const topicLinks = [...new Set(list.flatMap(a => a.topics))];
  const totalMin = list.reduce((s, a) => s + readMins(a), 0);
  return `
    <header class="author-hero">${portrait(au.key, au.name)}<h1>${esc(au.name)}</h1>
      ${au.bio ? `<p>${linkify(au.bio)}</p>` : ''}
      <div class="author-facts">
        <div><b>${mr(list.length)}</b><span>${au.archived ? 'संग्रहातले लेख' : 'लेख'}</span></div>
        <div><b>${mr(oldest.date.getFullYear())}</b><span>पासून लिहिताहेत</span></div>
        <div><b>${mr(totalMin)}</b><span>मिनिटांचं वाचन</span></div>
      </div>
      ${topicLinks.length ? `<div class="author-topics">लिहितात: ${topicLinks.map(t => `<a href="#/topic/${encodeURIComponent(t)}">${esc(t)}</a>`).join(', ')}</div>` : ''}
    </header>
    <div class="sec-title"><h2>लेखन</h2></div>
    ${rowList(list, { showAuthor: false })}
    ${au.archived ? '' : `<p class="archive-note" id="archiveNote">palakneeti.in च्या संग्रहात यांचे आणखी लेख शोधत आहोत…</p>`}`;
}

function author(key) {
  const au = S.authors.get(key);
  if (!au) return authors();
  document.title = `${au.name} · पालकनीती`;
  $view.innerHTML = `<div class="author-page fade-in" id="authorPage">${authorBody(au)}</div>`;
  if (au.archived) return;
  fetchByAuthor(au).then(found => {
    addToPool(found);
    au.archived = true;
    rebuild();
    const page = $('#authorPage');
    if (page && location.hash === authorHref(key)) page.innerHTML = authorBody(au);
  }).catch(() => {
    const n = $('#archiveNote');
    if (n) n.textContent = 'संग्रहाशी संपर्क झाला नाही.';
  });
}

/* ---------- topics: list on the left, articles on the right ---------- */
function topics(sel) {
  sel = sel && S.topics.some(t => t.name === sel) ? sel : S.topics[0]?.name;
  const list = S.articles.filter(a => topicsOf(a).includes(sel));
  document.title = `${sel} · पालकनीती`;
  const pane = `<h1>${esc(sel)}</h1><span class="meta">${mr(list.length)} लेख</span>${rowList(list)}`;
  const existing = $('#topicPane');
  if (existing) {
    $view.querySelectorAll('.topic-nav a').forEach(l => l.classList.toggle('on', l.dataset.t === sel));
    existing.innerHTML = pane;
    existing.classList.remove('swap'); void existing.offsetWidth; existing.classList.add('swap');
    const top = existing.getBoundingClientRect().top + scrollY - $mast.offsetHeight - 20;
    if (scrollY > top) scrollTo({ top, behavior: 'smooth' });
    return;
  }
  $view.innerHTML = `<div class="wrap fade-in"><div class="topics-split">
    <nav><ul class="topic-nav">${S.topics.map(t => `<li><a class="${t.name === sel ? 'on' : ''}" data-t="${esc(t.name)}" href="#/topic/${encodeURIComponent(t.name)}">${esc(t.name)}<span class="n">${mr(t.count)}</span></a></li>`).join('')}</ul></nav>
    <section class="topic-pane" id="topicPane">${pane}</section>
  </div></div>`;
}

/* ---------- मासिक: printed issues ---------- */
const crumbs = items => `<nav class="crumbs" aria-label="breadcrumb"><div class="crumbs-in">${items.map(([label, href], i) =>
  href && i < items.length - 1 ? `<a href="${href}">${esc(label)}</a>` : `<span aria-current="page">${esc(label)}</span>`).join('<span class="sep">›</span>')}</div></nav>`;
const coverHtml = (is, cls = '') => is.cover
  ? `<img class="${cls}" src="${esc(is.cover)}" alt="${esc(is.title)}" loading="lazy">`
  : `<div class="cv-ph ${cls}" ${is.ghPdf ? `data-pdfcover="${esc(is.ghPdf)}" data-issue="${esc(is.id)}" data-title="${esc(is.title)}"` : ''}>${placeholder(is.id)}<span>${esc(is.title)}</span></div>`;
const onRoute = h => location.hash.split('?')[0] === h;

async function masik() {
  document.title = 'मासिक · पालकनीती';
  $view.innerHTML = `${crumbs([['मासिक']])}<div class="wrap fade-in">
    <header class="page-head"><h1>मासिक</h1><p>पालकनीतीचे छापील अंक. मुखपृष्ठावर क्लिक करून त्या अंकातले लेख वाचा आणि संपूर्ण अंकाची PDF मिळवा. <span class="diwali-note">दिवाळी अंक</span> दर वर्षी एका विषयाला वाहिलेला असतो.</p></header>
    <div id="issues"><p class="loading">अंक आणत आहोत…</p></div></div>`;
  let issues;
  try { issues = await allIssues(); }
  catch { if (onRoute('#/masik')) $('#issues').innerHTML = '<p class="loading">palakneeti.in शी संपर्क झाला नाही.</p>'; return; }
  if (!onRoute('#/masik')) return;
  const years = [...new Set(issues.map(i => i.year))].sort((x, y) => y - x);
  // years newest first; inside a year, January → December
  $('#issues').innerHTML = years.map(y => `<section class="year-block">
      <h2 class="year">${mr(y)}</h2>
      <div class="covers">${issues.filter(i => i.year === y).sort((a, b) => a.month - b.month || a.date - b.date).map(i => `
        <a class="cover ${i.diwali ? 'diwali' : ''}" href="#/masik/${i.id}">
          ${i.diwali ? '<span class="diwali-tag">दिवाळी अंक</span>' : ''}
          <div class="cv">${coverHtml(i)}</div><span class="cv-t">${esc(i.title)}</span></a>`).join('')}</div>
    </section>`).join('');
  paintPdfCovers();
}

// palakneeti.in issues, plus months that only amoghsc.github.io/palakneeti-masik lists
// (and its own PDFs, whose first page stands in for a missing cover).
let issuesAll;
function allIssues() {
  issuesAll ||= (async () => {
    const [wp, gh] = await Promise.all([fetchIssues(), fetchGhIssues().catch(() => [])]);
    const list = wp.map(i => ({ ...S.issues.get(i.id), ...i }));
    for (const g of gh) {
      const same = list.find(i => !i.diwali && i.year === g.year && i.month === g.month);
      if (same) { same.ghPdf ||= g.ghPdf; same.gh ||= g.gh; same.pdf ||= g.pdf; }
      else list.push(g);
    }
    list.forEach(i => S.issues.set(i.id, { ...S.issues.get(i.id), ...i }));
    return list;
  })().catch(err => { issuesAll = null; throw err; });
  return issuesAll;
}
const issueId = v => /^\d+$/.test(String(v)) ? +v : String(v);

// Draw page 1 of an issue's PDF (only those on the GitHub site allow it) as its cover.
let pdfjs;
const pdfCovers = new Map();
function pdfCover(url) {
  if (!pdfCovers.has(url)) pdfCovers.set(url, (async () => {
    pdfjs ||= new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; ok(window.pdfjsLib); };
      s.onerror = fail;
      document.head.appendChild(s);
    });
    const lib = await pdfjs;
    const doc = await lib.getDocument({ url, disableAutoFetch: true, disableStream: true }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const scale = 700 / vp.width;
    const canvas = document.createElement('canvas');
    const view = page.getViewport({ scale });
    canvas.width = view.width; canvas.height = view.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: view }).promise;
    doc.destroy();
    return canvas.toDataURL('image/jpeg', 0.85);
  })().catch(() => null));
  return pdfCovers.get(url);
}
function paintPdfCovers() {
  $view.querySelectorAll('[data-pdfcover]').forEach(async el => {
    const src = await pdfCover(el.dataset.pdfcover);
    if (!src || !el.isConnected) return;
    const is = S.issues.get(issueId(el.dataset.issue));
    if (is) is.cover = is.coverFull = src;
    el.outerHTML = `<img src="${src}" alt="${esc(el.dataset.title)}">`;
  });
}

// Home page: the newest issue's cover with a short note; links to its issue page.
async function fillHero() {
  let issues;
  try { issues = await allIssues(); } catch { $('#issueHero')?.remove(); return; }
  const hero = $('#issueHero');
  if (!hero) return;
  const latest = [...issues].sort((a, b) => b.year - a.year || b.month - a.month)[0];
  const href = `#/masik/${latest.id}`;
  const titlesHtml = list => list.length ? `<ol class="ih-list">${list.slice(0, 6).map(t => `<li>${esc(t)}</li>`).join('')}</ol>` : '';
  hero.innerHTML = `<a class="ih-cover" href="${href}"><div class="cv">${coverHtml(latest)}</div></a>
    <div class="ih-text">
      <span class="label">ताजा अंक</span>
      <h1><a href="${href}">${esc(latest.title)}</a></h1>
      <p>पालकनीतीचा हा अंक इथे पूर्ण वाचा: अनुक्रमातल्या प्रत्येक लेखावर क्लिक करा, एकामागून एक लेख वाचा, किंवा संपूर्ण अंकाची PDF मिळवा.</p>
      <div id="ihTitles">${titlesHtml(latest.titles || [])}</div>
      <a class="pdf-btn" href="${href}">अंक उघडा <span aria-hidden="true">→</span></a>
    </div>`;
  paintPdfCovers();
  if (!(latest.titles || []).length) {
    const data = await loadIssue(latest.id).catch(() => null);
    const box = $('#ihTitles');
    if (data && box) box.innerHTML = titlesHtml(data.items.map(i => i.title));
  }
}

// One issue, fetched and resolved once per visit: its contents lines mapped to in-app articles.
const issueCache = new Map();
function loadIssue(id) {
  if (!issueCache.has(id)) {
    issueCache.set(id, (async () => {
      let issue;
      if (String(id).startsWith('gh-')) {
        await allIssues();
        issue = await fetchGhIssue(S.issues.get(id));
      } else {
        issue = { ...S.issues.get(id), ...(await fetchIssue(id)) };
      }
      const items = await resolveIssue(issue);
      addToPool(items.map(i => i.article).filter(Boolean));
      items.forEach(i => { if (i.article) i.article = S.pool.get(i.article.id); });
      rebuild();
      lookUpPhotos(items.filter(i => i.author).map(i => authorKeyOf(i.author)));
      S.issues.set(id, { ...S.issues.get(id), ...issue });
      return { issue: S.issues.get(id), items };
    })().catch(err => { issueCache.delete(id); throw err; }));
  }
  return issueCache.get(id);
}
const authorKeyOf = name => name.replace(/^(डॉ\.|अनु\.)\s*/, '').trim();

function anukramList(items, id) {
  return `<ol class="toc-rows">${items.map((it, i) => {
    const a = it.article;
    const name = it.author || (a && a.author !== 'पालकनीती' ? a.author : '');
    const key = a && (!it.author || a.author === it.author) ? a.authorKey : authorKeyOf(name);
    const inner = `<span class="n">${mr(i + 1)}</span>
      <span class="t">${esc(it.title)}${a ? '' : '<small class="meta"> · फक्त PDF मध्ये</small>'}</span>
      ${name ? `<span class="who static">${portrait(key, name)}<span>${esc(name)}</span></span>` : '<span></span>'}`;
    return `<li class="${a ? '' : 'off'}">${a ? `<a class="toc-row" href="#/a/${a.id}?from=${id}">${inner}</a>` : `<div class="toc-row">${inner}</div>`}</li>`;
  }).join('')}</ol>`;
}

async function issuePage(id) {
  const known = S.issues.get(id);
  document.title = `${known ? known.title + ' · ' : ''}मासिक · पालकनीती`;
  $view.innerHTML = `${crumbs([['मासिक', '#/masik'], [known ? known.title : 'अंक']])}<p class="loading">अंक आणत आहोत…</p>`;
  let data;
  try { data = await loadIssue(id); }
  catch {
    if (onRoute(`#/masik/${id}`)) $view.querySelector('.loading').textContent = 'palakneeti.in शी संपर्क झाला नाही.';
    return;
  }
  if (!onRoute(`#/masik/${id}`)) return;
  const { issue, items } = data;
  const online = items.filter(i => i.article);
  document.title = `${issue.title} · मासिक · पालकनीती`;
  $view.innerHTML = `${crumbs([['मासिक', '#/masik'], [issue.title]])}<div class="wrap fade-in">
    <div class="issue-head">
      <a class="issue-cover" ${issue.coverFull ? `href="${esc(issue.coverFull)}" target="_blank" rel="noopener"` : ''}>${coverHtml(issue)}</a>
      <div class="issue-info">
        ${issue.diwali ? '<span class="diwali-tag">दिवाळी अंक</span>' : '<span class="label">पालकनीती मासिक</span>'}
        <h1>${esc(issue.title)}</h1>
        <p class="meta">${items.length ? `या अंकात ${mr(items.length)} लेख<span class="dot">·</span>` : ''}${mr(online.length)} इथे वाचता येतात</p>
        ${issue.pdf ? `<a class="pdf-btn" href="${esc(issue.pdf)}" target="_blank" rel="noopener">संपूर्ण अंकाची PDF डाउनलोड करा <span aria-hidden="true">↗</span></a>` : ''}
        ${issue.year === 2026 ? issue.notes.map(n => `<p class="issue-note">${n}</p>`).join('') : ''}
      </div>
    </div>
    ${items.length ? `<section class="anukram">
      <div class="sec-title"><h2>अनुक्रम</h2>
        <div class="view-toggle" role="tablist">
          <button type="button" data-v="list" title="यादी" aria-label="यादी"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14"/></svg></button><button type="button" data-v="cards" title="कार्ड" aria-label="कार्ड"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="5.5" height="5.5"/><rect x="11.5" y="3" width="5.5" height="5.5"/><rect x="3" y="11.5" width="5.5" height="5.5"/><rect x="11.5" y="11.5" width="5.5" height="5.5"/></svg></button>
        </div></div>
      <div id="anukramBody"></div>
    </section>` : ''}
  </div>`;
  paintPdfCovers();
  const body = $('#anukramBody');
  if (!body) return;
  const show = v => {
    setPref('issueView', v);
    $view.querySelectorAll('.view-toggle button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    body.innerHTML = v === 'cards'
      ? `<div class="grid">${online.map(i => entry(i.article, { from: id })).join('')}</div>`
      : anukramList(items, id);
  };
  show(pref('issueView', 'list'));
  $view.querySelector('.view-toggle').addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (b) show(b.dataset.v);
  });
}

// ← previous / next → within the issue the article was opened from
async function fillIssueNav(id, from) {
  let data;
  try { data = await loadIssue(issueId(from)); } catch { return; }
  const nav = $('#issueNav');
  if (!nav || location.hash.split('?')[0] !== `#/a/${id}`) return;
  const arts = data.items.map(i => i.article).filter(Boolean);
  const i = arts.findIndex(a => a.id === id);
  if (i < 0) return;
  const btn = (a, dir) => {
    const label = dir === 'prev' ? '← मागील लेख' : 'पुढील लेख →';
    return a
      ? `<a class="in-btn ${dir}" href="#/a/${a.id}?from=${from}"><small>${label}</small><span>${esc(a.title)}</span></a>`
      : `<span class="in-btn ${dir} disabled" aria-disabled="true"><small>${label}</small><span>${dir === 'prev' ? 'हा अंकातला पहिला लेख' : 'हा अंकातला शेवटचा लेख'}</span></span>`;
  };
  nav.hidden = false;
  nav.innerHTML = `${btn(arts[i - 1], 'prev')}<span class="pos">${esc(data.issue.title)}<br>${mr(i + 1)} / ${mr(arts.length)}</span>${btn(arts[i + 1], 'next')}`;
}

/* ---------- graph ---------- */
function graph(focusId) {
  const on = { sim: true, topic: true, author: false };
  $view.innerHTML = `<div class="graph-page fade-in">
    <div class="graph-intro">
      <h1>जाळं</h1>
      <p>प्रत्येक वर्तुळ एक लेख. शब्द, विषय आणि लेखक यांच्या साम्यावरून जवळचे लेख एकमेकांशी जोडलेले आहेत.</p>
      <div class="toggles">
        <label><input type="checkbox" data-k="sim" checked> साम्य</label>
        <label><input type="checkbox" data-k="topic" checked> विषय</label>
        <label><input type="checkbox" data-k="author"> लेखक</label>
      </div>
    </div>
    <svg id="gsvg"></svg>
    <div class="gtip" id="gtip" hidden></div>
    <div class="graph-note">ओढा, झूम करा, वर्तुळावर क्लिक करून वाचा</div>
  </div>`;
  let sim;
  const draw = () => { sim && sim.stop(); sim = drawGraph(on, focusId); };
  $view.querySelector('.toggles').addEventListener('change', e => {
    on[e.target.dataset.k] = e.target.checked;
    focusId = null;
    draw();
  });
  draw();
  teardown.push(() => sim && sim.stop());
}

function drawGraph(on, focusId) {
  const svgEl = $('#gsvg'), tip = $('#gtip');
  const W = svgEl.clientWidth, H = svgEl.clientHeight;
  const shown = new Set(S.articles.map(a => a.id));
  const nodes = S.articles.map(a => ({ id: 'a' + a.id, type: 'a', a, r: 13 + Math.min(10, a.words / 300) }));
  const links = [];
  if (on.sim) S.edges.forEach(e => {
    if (shown.has(e.source) && shown.has(e.target)) links.push({ source: 'a' + e.source, target: 'a' + e.target, kind: 'sim', w: e.w });
  });
  if (on.topic) S.topics.forEach(t => {
    nodes.push({ id: 't' + t.name, type: 't', t, w: t.name.length * 9 + 28 });
    S.articles.filter(a => topicsOf(a).includes(t.name)).forEach(a => links.push({ source: 'a' + a.id, target: 't' + t.name, kind: 'topic' }));
  });
  if (on.author) authorList().forEach(au => {
    nodes.push({ id: 'u' + au.key, type: 'u', au, r: 17 });
    S.articles.filter(a => a.authorKey === au.key).forEach(a => links.push({ source: 'a' + a.id, target: 'u' + au.key, kind: 'author' }));
  });

  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();
  const defs = svg.append('defs');
  const root = svg.append('g');
  const zoom = d3.zoom().scaleExtent([0.3, 4]).on('zoom', ev => root.attr('transform', ev.transform));
  svg.call(zoom);

  const link = root.append('g').selectAll('line').data(links).join('line')
    .attr('class', d => 'g-link' + (d.kind === 'sim' ? ' sim' : ''))
    .attr('stroke-width', d => d.kind === 'sim' ? 0.8 + d.w * 6 : 0.8);
  const node = root.append('g').selectAll('g').data(nodes).join('g')
    .attr('class', d => ({ a: 'g-art', t: 'g-topic', u: 'g-author' }[d.type]));

  node.filter(d => d.type === 'a').each(function (d) {
    const g = d3.select(this);
    g.append('circle').attr('class', 'ring').attr('r', d.r);
    if (d.a.hero) {
      defs.append('clipPath').attr('id', 'c' + d.a.id).append('circle').attr('r', d.r - 2);
      g.append('image').attr('href', d.a.hero).attr('x', -d.r).attr('y', -d.r).attr('width', d.r * 2).attr('height', d.r * 2)
        .attr('preserveAspectRatio', 'xMidYMid slice').attr('clip-path', `url(#c${d.a.id})`).style('pointer-events', 'none');
    } else {
      g.append('text').attr('text-anchor', 'middle').attr('dy', '.35em').attr('font-size', d.r * .9).text(firstGrapheme(d.a.title));
    }
  });
  const top = node.filter(d => d.type === 't');
  top.append('rect').attr('x', d => -d.w / 2).attr('y', -14).attr('width', d => d.w).attr('height', 28).attr('rx', 14);
  top.append('text').attr('text-anchor', 'middle').attr('dy', '.35em').attr('font-size', 15).text(d => d.t.name);
  const aut = node.filter(d => d.type === 'u');
  aut.each(function (d) {
    const g = d3.select(this);
    g.append('circle').attr('r', d.r);
    const photo = S.photos.get(d.au.key);
    if (photo) {
      defs.append('clipPath').attr('id', 'u' + hashId(d.au.key)).append('circle').attr('r', d.r - 1);
      g.append('image').attr('href', photo).attr('x', -d.r).attr('y', -d.r).attr('width', d.r * 2).attr('height', d.r * 2)
        .attr('preserveAspectRatio', 'xMidYMid slice').attr('clip-path', `url(#u${hashId(d.au.key)})`).style('pointer-events', 'none');
    } else {
      g.append('text').attr('text-anchor', 'middle').attr('dy', '.35em').attr('font-size', 14).text(firstGrapheme(d.au.name));
    }
    g.append('text').attr('text-anchor', 'middle').attr('y', d.r + 14).attr('font-size', 12).text(d.au.name);
  });

  const neighbours = new Map(nodes.map(n => [n.id, new Set([n.id])]));
  links.forEach(l => { neighbours.get(l.source).add(l.target); neighbours.get(l.target).add(l.source); });
  const highlight = id => {
    const keep = id && neighbours.get(id);
    node.classed('dim', d => keep && !keep.has(d.id));
    link.classed('dim', d => keep && !(d.source.id === id || d.target.id === id));
  };

  node.on('mouseenter', (ev, d) => {
    highlight(d.id);
    if (d.type !== 'a') return;
    tip.hidden = false;
    tip.innerHTML = `${esc(d.a.title)}<small>${esc(d.a.author)}${d.a.topics.length ? ' · ' + d.a.topics.join(', ') : ''}</small>`;
  }).on('mousemove', ev => {
    const r = svgEl.getBoundingClientRect();
    tip.style.left = (ev.clientX - r.left) + 'px'; tip.style.top = (ev.clientY - r.top) + 'px';
  }).on('mouseleave', () => { tip.hidden = true; highlight(focusId ? 'a' + focusId : null); })
    .on('click', (ev, d) => {
      if (d.type === 'a') location.hash = `#/a/${d.a.id}`;
      if (d.type === 't') location.hash = `#/topic/${encodeURIComponent(d.t.name)}`;
      if (d.type === 'u') location.hash = authorHref(d.au.key);
    });

  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id)
      .distance(d => d.kind === 'sim' ? 130 - d.w * 120 : d.kind === 'topic' ? 100 : 60)
      .strength(d => d.kind === 'sim' ? 0.2 + d.w : d.kind === 'topic' ? 0.12 : 0.5))
    .force('charge', d3.forceManyBody().strength(d => d.type === 't' ? -500 : -220))
    .force('collide', d3.forceCollide(d => d.type === 't' ? d.w / 2 + 6 : d.r + 7))
    .force('x', d3.forceX(W / 2).strength(0.04))
    .force('y', d3.forceY(H / 2).strength(0.06))
    .on('tick', () => {
      link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

  node.call(d3.drag()
    .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
    .on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

  if (focusId) {
    highlight('a' + focusId);
    const f = nodes.find(n => n.id === 'a' + focusId);
    setTimeout(() => {
      if (f && f.x != null) svg.transition().duration(900).call(zoom.transform, d3.zoomIdentity.translate(W / 2, H / 2).scale(1.6).translate(-f.x, -f.y));
    }, 1400);
  }
  return sim;
}
const hashId = s => { let h = 7; for (const c of s) h = (h * 31 + c.codePointAt(0)) | 0; return Math.abs(h); };
/* ---------- search: Devanagari or English spelling ---------- */
const $search = $('#search'), $q = $('#q'), $results = $('#results');
function closeSearch() {
  $search.hidden = true; $q.value = ''; $results.innerHTML = ''; $('#aiResults').innerHTML = '';
  $('#searchBtn').classList.remove('on'); focusResults();
}
$('#searchBtn').onclick = () => {
  if (!$search.hidden) return closeSearch();
  $search.hidden = false; $('#searchBtn').classList.add('on'); growQ(); $q.focus();
};
// Author (with thumbnail) and date for a search or AI result. 'पालकनीती' is the fallback name, not an author.
function byline(a) {
  const au = a.author && a.author !== 'पालकनीती' ? `${portrait(a.authorKey, a.author)}<span>${esc(a.author)}</span><span class="dot">·</span>` : '';
  return `${au}<span>${mrDate(a.date)}</span>`;
}
// While results are showing, the page underneath steps aside so only the list is seen.
function focusResults() {
  const on = !$search.hidden && !!($results.innerHTML.trim() || $('#aiResults').innerHTML.trim());
  document.body.classList.toggle('searching', on);
}

// Each article's words as consonant skeletons of their Latin spelling, so
// "paranjape" finds परांजपे and "palakatva" / "palaktva" find पालकत्व.
function haystack(a) {
  if (!a._hay) {
    const text = `${a.title} ${a.author} ${a.topics.join(' ')}`;
    const words = text.split(/[\s,.:;!?'"‘’“”()–—-]+/).filter(Boolean);
    a._hay = {
      dev: text.toLowerCase(),
      en: (a.tagNames || []).join(' '),
      sk: words.map(w => skel(/[a-z]/i.test(w) ? w : latin(w))).filter(k => k.length > 1),
      title: a.title.split(/\s+/).map(w => skel(latin(w))),
    };
  }
  return a._hay;
}
function score(a, q) {
  const h = haystack(a);
  if (!/[a-z]/i.test(q)) return h.dev.includes(q) ? (a.title.toLowerCase().includes(q) ? 2 : 1) : 0;
  if (h.en.includes(q)) return 1;
  const ks = q.split(/\s+/).map(skel).filter(k => k.length > 1);
  if (!ks.length || !ks.every(k => h.sk.some(t => t.startsWith(k)))) return 0;
  return ks.every(k => h.title.some(t => t.startsWith(k))) ? 2 : 1;
}
$q.addEventListener('input', () => {
  const q = $q.value.trim().toLowerCase();
  if (!q) { $results.innerHTML = ''; return focusResults(); }
  const hits = [...S.pool.values()].map(a => [a, score(a, q)]).filter(([, s]) => s)
    .sort((x, y) => y[1] - x[1] || y[0].date - x[0].date).slice(0, 8).map(([a]) => a);
  $results.innerHTML = hits.length
    ? hits.map(a => `<a href="#/a/${a.id}"><span class="st">${esc(a.title)}</span><small class="who">${byline(a)}</small></a>`).join('')
    : `<p class="meta">काही सापडलं नाही.</p>`;
  trackSearch(q, hits.length);
  focusResults();
});
addEventListener('keydown', e => { if (e.key === 'Escape' && !$search.hidden) closeSearch(); });

/* ---------- AI: articles for the reader's own situation ---------- */
// The Gemini key stays server-side in the Supabase Edge Function (ai/index.ts).
// For offline work, run ai/dev-server.mjs and add ?ai=local to the address.
const AI_LOCAL = new URLSearchParams(location.search).get('ai') === 'local';
const AI_URL = AI_LOCAL ? 'http://127.0.0.1:5203/' : `${SUPABASE_URL}/functions/v1/pk-suggest`;
const AI_HEADERS = AI_LOCAL ? {} : { authorization: `Bearer ${SUPABASE_ANON}`, apikey: SUPABASE_ANON };
const $ai = $('#aiResults'), $aiBtn = $('#aiBtn');
// Grow with the text; when empty, size to the placeholder so the hint is never clipped.
function growQ() {
  $q.style.height = 'auto';
  let h = $q.scrollHeight;
  if (!$q.value) {
    $q.value = $q.placeholder; $q.classList.add('measuring');
    h = Math.max(h, $q.scrollHeight);
    $q.value = ''; $q.classList.remove('measuring');
  }
  $q.style.height = Math.min(220, h) + ($q.offsetHeight - $q.clientHeight) + 'px'; // border-box: add the rule line
}
addEventListener('resize', () => { if (!$search.hidden) growQ(); });
$q.addEventListener('input', () => { growQ(); $aiBtn.disabled = $q.value.trim().length < 8; });
$q.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!$aiBtn.disabled) askAI(); }
  else if (e.key === 'Enter' && !e.shiftKey && $q.value.length < 60) e.preventDefault(); // short queries stay one line
});
$aiBtn.onclick = askAI;

// The AI returns ids and titles only; authors come from the article itself, fetched live.
async function fillPickAuthors(run) {
  const els = [...$ai.querySelectorAll('[data-au]')];
  const found = await Promise.all(els.map(el => S.pool.get(+el.dataset.au) || fetchArticle(+el.dataset.au).catch(() => null)));
  if (run !== aiRun) return;
  const fresh = found.filter(a => a && !S.pool.has(a.id));
  if (fresh.length) { addToPool(fresh); rebuild(); } // registers their authors too, so the article pages open
  els.forEach((el, i) => { if (found[i]) el.innerHTML = byline(found[i]); });
}

let aiRun = 0;
async function askAI() {
  const text = $q.value.trim();
  if (text.length < 8) return;
  const run = ++aiRun;
  $results.innerHTML = '';
  const steps = ['तुमचं म्हणणं समजून घेत आहोत…', 'पालकनीतीच्या संग्रहात लेख शोधत आहोत…', 'तुमच्यासाठी योग्य लेख निवडत आहोत…'];
  let k = 0;
  $ai.innerHTML = `<p class="ai-wait"><span class="dotty"></span>${steps[0]}</p>`;
  focusResults();
  const tick = setInterval(() => { const w = $ai.querySelector('.ai-wait'); if (w && k < steps.length - 1) w.lastChild.textContent = steps[++k]; }, 4500);
  $aiBtn.disabled = true;
  try {
    const res = await fetch(AI_URL, { method: 'POST', headers: { 'content-type': 'application/json', ...AI_HEADERS }, body: JSON.stringify({ text }) });
    const out = await res.json().catch(() => ({}));
    if (run !== aiRun) return;
    track('ai', { n: res.ok ? (out.picks || []).length : -1 });
    if (!res.ok) throw Object.assign(new Error(out.error || 'failed'), { status: res.status });
    $ai.innerHTML = `
      ${out.urgent ? `<p class="ai-urgent">तुम्ही किंवा तुमच्या जवळचं कोणी धोक्यात असल्यास कृपया लगेच मदत घ्या: <b>टेली-मानस हेल्पलाइन १४४१६</b> (२४ तास, विनामूल्य) किंवा आपत्कालीन क्रमांक <b>११२</b>.</p>` : ''}
      ${out.note ? `<p class="ai-note">${esc(out.note)}</p>` : ''}
      ${out.picks && out.picks.length ? `<ol class="ai-picks">${out.picks.map(p => `<li><a href="#/a/${p.id}">
          <span class="t">${esc(p.title)}</span><small class="who" data-au="${p.id}"></small><span class="r">${esc(p.reason)}</span></a></li>`).join('')}</ol>`
        : '<p class="meta">या वेळी जुळणारे लेख सापडले नाहीत. थोडं वेगळ्या शब्दांत लिहून पाहा.</p>'}
      <p class="ai-foot">हे सुचवलेले लेख AI ने निवडले आहेत; प्रत्येक लेख palakneeti.in वरून थेट वाचला जातो.</p>`;
    fillPickAuthors(run);
  } catch (err) {
    if (run !== aiRun) return;
    $ai.innerHTML = `<p class="meta">${err.status === 503 && /not-configured/.test(err.message) ? 'ही सुविधा लवकरच सुरू होईल.'
      : err.status === 429 ? 'खूप विनंत्या आल्या आहेत; थोड्या वेळाने पुन्हा प्रयत्न करा.'
      : 'आत्ता लेख सुचवता आले नाहीत. थोड्या वेळाने पुन्हा प्रयत्न करा.'}</p>`;
  } finally {
    clearInterval(tick);
    if (run === aiRun) $aiBtn.disabled = $q.value.trim().length < 8;
  }
}

/* ---------- theme: day → sepia → night ---------- */
const THEMES = ['light', 'sepia', 'dark'];
const applyTheme = t => { if (t) document.documentElement.dataset.theme = t; };
applyTheme(pref('theme', ''));
$('#theme').onclick = () => {
  const cur = document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
  clearColors();
  applyTheme(next); setPref('theme', next);
};

/* ---------- sticky masthead ---------- */
const $mast = $('#masthead');
const measureHead = () => document.documentElement.style.setProperty('--head-h', $mast.offsetHeight + 'px');
// Separate on / off thresholds: shrinking the header moves the page by its height
// change, and a single threshold would toggle back and forth (the flicker).
addEventListener('scroll', () => {
  const was = $mast.classList.contains('compact');
  if (scrollY > 120) $mast.classList.add('compact');
  else if (scrollY < 4) $mast.classList.remove('compact');
  if (was !== $mast.classList.contains('compact')) { measureHead(); setTimeout(measureHead, 350); }
}, { passive: true });
addEventListener('resize', measureHead);
$mast.addEventListener('transitionend', measureHead);
addEventListener('design:change', measureHead);

/* ---------- router ---------- */
function route() {
  teardown.forEach(f => f()); teardown = [];
  closeSearch();
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const fromIssue = parts[0] === 'a' && /from=/.test(qs || '');
  const section = fromIssue ? 'masik' : { a: '', author: 'authors', topic: 'topics' }[parts[0]] ?? (parts[0] || 'home');
  document.querySelectorAll('#nav a').forEach(l => l.classList.toggle('on', l.dataset.r === section));
  document.title = 'पालकनीती';
  measureHead();
  // switching subjects only swaps the right-hand pane
  const inTopics = (parts[0] === 'topic' || parts[0] === 'topics') && $('#topicPane');
  switch (parts[0]) {
    case 'a': article(+parts[1], new URLSearchParams(qs || '').get('from')); break;
    case 'authors': authors(); break;
    case 'author': author(parts[1]); break;
    case 'topics': topics(); break;
    case 'topic': topics(parts[1]); break;
    case 'graph': graph(new URLSearchParams(qs || '').get('focus')); break;
    case 'masik': parts[1] ? issuePage(issueId(parts[1])) : masik(); break;
    default: home();
  }
  trackView({ a: 'article', masik: parts[1] ? 'issue' : 'masik' }[parts[0]] || parts[0] || 'home', parts[1] || null);
  if (parts[0] !== 'a' && !inTopics) scrollTo(0, 0);
  if (!inTopics) $view.focus({ preventScroll: true });
}

applyDesign();
mountSettings();
(async function start() {
  try {
    await loadMore();
    addEventListener('hashchange', route);
    route();
  } catch (err) {
    $view.innerHTML = `<div class="page-head"><h1>palakneeti.in शी संपर्क झाला नाही</h1><p>${esc(err.message)}</p><p><button class="read-link" onclick="location.reload()">पुन्हा प्रयत्न करा</button></p></div>`;
  }
})();
