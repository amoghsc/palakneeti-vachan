// Anonymous usage counts for the stats page (stats.html). Each browser gets a random id
// kept in localStorage; no IP, name or AI text is sent. Rows go straight into the
// insert-only pk_events table on Supabase; only whitelisted accounts can read them.
export const SUPABASE_URL = 'https://efxadlmhjzlejsacjwkf.supabase.co';
// Supabase's public client key, made to be shipped in web pages.
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmeGFkbG1oanpsZWpzYWNqd2tmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5OTU5NDMsImV4cCI6MjEwMTU3MTk0M30.HDtRJ-QOwxTW0ihtk-17Md4zX9i8oVHp85Uy40fodQM';

// Local copies don't count, unless ?track is in the address (for testing).
const ON = location.hostname.endsWith('github.io') || new URLSearchParams(location.search).has('track');

const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
function stored(store, key) {
  try { return store.getItem(key) || (store.setItem(key, rid()), store.getItem(key)); } catch { return rid(); }
}
const visitor = stored(localStorage, 'pk-visitor');
const session = stored(sessionStorage, 'pk-session');
const device = matchMedia('(max-width: 640px)').matches ? 'mobile' : matchMedia('(max-width: 1024px)').matches ? 'tablet' : 'desktop';
let referrer = '';
try { const r = document.referrer && new URL(document.referrer); if (r && r.host !== location.host) referrer = r.host.slice(0, 100); } catch {}

const cut = (s, n) => (s == null ? null : String(s).slice(0, n));

export function track(kind, { section = null, ref = null, label = null, q = null, n = null } = {}) {
  if (!ON) return;
  const row = { visitor, session, kind, section, ref: cut(ref, 40), label: cut(label, 200), q: cut(q, 120), n, device, referrer: referrer || null };
  referrer = ''; // only the first event of a visit carries where it came from
  fetch(`${SUPABASE_URL}/rest/v1/pk_events`, {
    method: 'POST', keepalive: true,
    headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON, authorization: `Bearer ${SUPABASE_ANON}`, prefer: 'return=minimal' },
    body: JSON.stringify(row),
  }).catch(() => {});
}

// A page view, labelled with the page's own title once the view has set it.
export function trackView(section, ref) {
  const hash = location.hash, start = Date.now();
  (function wait() {
    const t = document.title.split(' · ')[0];
    const ready = t !== 'पालकनीती' || section === 'home' || Date.now() - start > 5000 || location.hash !== hash;
    if (!ready) return setTimeout(wait, 250);
    track('view', { section, ref, label: section === 'home' ? null : t });
  })();
}

// Keyword searches are counted once the reader pauses typing; label = 'devanagari' or 'latin'.
// The same words again (e.g. after switching tabs and back) are not counted twice.
let searchTimer, lastSearch = '';
export function trackSearch(q, hits, script) {
  clearTimeout(searchTimer);
  q = q.trim().toLowerCase();
  if (q.length < 2 || q === lastSearch) return;
  searchTimer = setTimeout(() => { lastSearch = q; track('search', { q, n: hits, label: script }); }, 1500);
}

// Clicks on things worth counting, wherever they are on the page.
addEventListener('click', e => {
  const el = e.target.closest('a, button');
  if (!el) return;
  if (el.closest('.search-results')) track('search_click', { ref: (el.getAttribute('href') || '').split('/').pop() });
  else if (el.closest('.ai-picks')) track('ai_click', { ref: (el.getAttribute('href') || '').split('/').pop() });
  else if (el.matches('.pdf-btn[target="_blank"]')) track('pdf', { label: document.title.split(' · ')[0] });
  else if (el.closest('.view-toggle')) track('view_toggle', { label: el.dataset.v });
  else if (el.id === 'theme') setTimeout(() => track('theme', { label: document.documentElement.dataset.theme || '' }), 0);
  else if (el.dataset.step) track('font', { label: +el.dataset.step > 0 ? 'bigger' : 'smaller' });
}, true);
