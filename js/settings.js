// Design tuning panel (bottom-right ⚙). Meant for fine-tuning the look during the
// prototype; values persist per browser and can be copied out as JSON.

const KEY = 'vachan.design';

// Google Fonts with Devanagari, with the axis/weights each one actually ships.
const FONTS = {
  'Tiro Devanagari Marathi': 'ital@0;1',
  'Noto Serif Devanagari': 'wght@100..900',
  'Martel': 'wght@200;300;400;600;700;800;900',
  'Eczar': 'wght@400..800',
  'Halant': 'wght@300;400;500;600;700',
  'Karma': 'wght@300;400;500;600;700',
  'Laila': 'wght@300;400;500;600;700',
  'Sahitya': 'wght@400;700',
  'Sura': 'wght@400;700',
  'Vesper Libre': 'wght@400;500;700;900',
  'Gotu': '',
  'Kurale': '',
  'Rozha One': '',
  'Yatra One': '',
  'Noto Sans Devanagari': 'wght@100..900',
  'Mukta': 'wght@200;300;400;500;600;700;800',
  'Hind': 'wght@300;400;500;600;700',
  'Anek Devanagari': 'wght@100..800',
  'Palanquin': 'wght@100;200;300;400;500;600;700',
  'Baloo 2': 'wght@400..800',
  'Khand': 'wght@300;400;500;600;700',
  'Poppins': 'wght@300;400;500;600;700',
  'Kalam': 'wght@300;400;700',
};

const DEFAULTS = {
  head: 'Mukta', body: 'Mukta', ui: 'Mukta',
  hw: 500, read: 19, lh: 1.7, measure: 41, base: 18, sp: 1.1,
  paper: '#fbf9f4', ink: '#1f1e1c', accent: '#5b4a8a',
};

const SWATCHES = [
  { name: 'कागद', paper: '#f6f2ea', ink: '#2b2723', accent: '#7a3e2e' },
  { name: 'जुनं पुस्तक', paper: '#efe4cf', ink: '#3a2f24', accent: '#7d3f22' },
  { name: 'हस्तिदंती', paper: '#fbf9f4', ink: '#1f1e1c', accent: '#5b4a8a' },
  { name: 'पानाफुलांचा', paper: '#eef0e6', ink: '#27302a', accent: '#4f6b45' },
  { name: 'संध्याकाळ', paper: '#e9e4ec', ink: '#2b2733', accent: '#6c4a6e' },
  { name: 'रात्र', paper: '#1d1b18', ink: '#e4dccf', accent: '#d39b85' },
];

const SLIDERS = [
  ['read', 'लेखातील अक्षरांचा आकार', 15, 28, 0.5, 'px'],
  ['lh', 'ओळींमधील अंतर', 1.4, 2.4, 0.05, ''],
  ['measure', 'मजकुराच्या स्तंभाची रुंदी', 26, 50, 1, 'em'],
  ['base', 'इतर मजकुराचा आकार', 14, 22, 0.5, 'px'],
  ['hw', 'शीर्षकांची जाडी', 200, 600, 100, ''],
  ['sp', 'एकूण मोकळी जागा', 0.6, 1.6, 0.05, '×'],
];

let state = load();
const loaded = new Set(['Noto Serif Devanagari', 'Tiro Devanagari Marathi', 'Mukta']);

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ } }

function loadFont(name) {
  if (loaded.has(name)) return;
  loaded.add(name);
  const axis = FONTS[name];
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}${axis ? ':' + axis : ''}&display=swap`;
  document.head.appendChild(link);
}

const isLight = hex => {
  const n = parseInt(hex.replace('#', ''), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 128;
};

const stack = (name, fallback) => `'${name}', ${fallback}`;

export function applyDesign() {
  const r = document.documentElement.style;
  [state.head, state.body, state.ui].forEach(loadFont);
  r.setProperty('--serif-head', stack(state.head, "'Noto Serif Devanagari', Georgia, serif"));
  r.setProperty('--serif-body', stack(state.body, "'Tiro Devanagari Marathi', Georgia, serif"));
  r.setProperty('--ui', stack(state.ui, 'system-ui, sans-serif'));
  r.setProperty('--hw', state.hw);
  r.setProperty('--read-size', state.read + 'px');
  r.setProperty('--lh', state.lh);
  r.setProperty('--measure', state.measure + 'em');
  r.setProperty('--base', state.base + 'px');
  r.setProperty('--sp', state.sp);
  const colorVars = ['--paper', '--paper-2', '--ink', '--ink-2', '--ink-3', '--rule', '--accent', '--accent-soft', '--hl'];
  colorVars.forEach(v => r.removeProperty(v));
  if (state.paper && state.ink) {
    r.setProperty('--paper', state.paper);
    r.setProperty('--ink', state.ink);
    r.setProperty('--paper-2', `color-mix(in srgb, ${state.paper} 93%, ${state.ink})`);
    r.setProperty('--rule', `color-mix(in srgb, ${state.paper} 82%, ${state.ink})`);
    r.setProperty('--ink-2', `color-mix(in srgb, ${state.ink} 78%, ${state.paper})`);
    r.setProperty('--ink-3', `color-mix(in srgb, ${state.ink} 55%, ${state.paper})`);
    // highlight = a lifted version of the page colour: near-white on light paper, a shade up on dark
    r.setProperty('--hl', isLight(state.paper) ? `color-mix(in srgb, ${state.paper} 20%, #fff)` : `color-mix(in srgb, ${state.paper} 88%, ${state.ink})`);
  }
  if (state.accent) {
    r.setProperty('--accent', state.accent);
    r.setProperty('--accent-soft', `color-mix(in srgb, ${state.accent} 70%, ${state.paper || '#f6f2ea'})`);
  }
  dispatchEvent(new Event('design:change'));
}

// Readers get five fixed article sizes; the middle one is the design default.
export const READ_SIZES = [-4, -2, 0, 2, 4].map(d => DEFAULTS.read + d);
export const readSize = () => state.read;
export function setReadSize(px) {
  state.read = px;
  save(); applyDesign(); syncPanel();
}

// The ⚙ panel is hidden from readers. Open it with ?tune in the address
// (e.g. localhost:5202/?tune#/) or Ctrl+Shift+D; set SHOW_TUNING = true to show it always.
const SHOW_TUNING = false;
const tuningWanted = () => SHOW_TUNING || new URLSearchParams(location.search).has('tune');

const fontOptions = sel => Object.keys(FONTS).map(f => `<option ${f === sel ? 'selected' : ''}>${f}</option>`).join('');
const current = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const toHex = c => {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = c || '#000'; return ctx.fillStyle;
};

let panel;
function syncPanel() {
  if (!panel) return;
  SLIDERS.forEach(([k, , , , , unit]) => {
    panel.querySelector(`[name=${k}]`).value = state[k];
    panel.querySelector(`output[for=${k}]`).textContent = state[k] + unit;
  });
  ['head', 'body', 'ui'].forEach(k => { panel.querySelector(`[name=${k}]`).value = state[k]; });
  panel.querySelector('[name=paper]').value = toHex(state.paper || current('--paper'));
  panel.querySelector('[name=ink]').value = toHex(state.ink || current('--ink'));
  panel.querySelector('[name=accent]').value = toHex(state.accent || current('--accent'));
}

export function mountSettings() {
  const btn = document.createElement('button');
  btn.className = 'tune-btn'; btn.type = 'button'; btn.title = 'रचना सेटिंग्ज'; btn.textContent = '⚙';
  panel = document.createElement('div');
  panel.className = 'tune'; panel.hidden = true;
  panel.innerHTML = `
    <h3>रचना सेटिंग्ज <button class="x" type="button" aria-label="बंद करा">×</button></h3>
    <p class="hint">इथले बदल फक्त या ब्राउझरमध्ये साठवले जातात.</p>
    <h4>फॉन्ट</h4>
    <div class="row"><label>शीर्षकांसाठी</label><select name="head">${fontOptions(state.head)}</select></div>
    <div class="row"><label>लेखाच्या मजकुरासाठी</label><select name="body">${fontOptions(state.body)}</select></div>
    <div class="row"><label>मेन्यू आणि माहितीसाठी</label><select name="ui">${fontOptions(state.ui)}</select></div>
    <h4>आकार आणि अंतर</h4>
    ${SLIDERS.map(([k, label, min, max, step]) => `<div class="row"><label for="${k}">${label}</label><output for="${k}"></output>
      <input type="range" id="${k}" name="${k}" min="${min}" max="${max}" step="${step}"></div>`).join('')}
    <h4>रंग</h4>
    <div class="swatches">${SWATCHES.map((s, i) => `<button type="button" data-sw="${i}" title="${s.name}" style="background:${s.paper};--sw-ink:${s.ink}"></button>`).join('')}</div>
    <div class="row"><label>पार्श्वभूमी</label><input type="color" name="paper"></div>
    <div class="row"><label>मजकूर</label><input type="color" name="ink"></div>
    <div class="row"><label>उठावाचा रंग (दुवे, लेबल)</label><input type="color" name="accent"></div>
    <div class="actions"><button type="button" data-act="reset">मूळ रचना</button><button type="button" data-act="copy">सेटिंग्ज कॉपी करा</button></div>`;
  document.body.append(btn, panel);
  btn.hidden = !tuningWanted();
  addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') { btn.hidden = !btn.hidden; if (btn.hidden) panel.hidden = true; }
  });

  btn.onclick = () => { panel.hidden = !panel.hidden; syncPanel(); };
  panel.querySelector('.x').onclick = () => { panel.hidden = true; };
  panel.addEventListener('input', e => {
    const { name, value, type } = e.target;
    if (!name) return;
    state[name] = type === 'range' ? +value : value;
    if (name === 'paper' || name === 'ink') {
      state.paper ||= toHex(current('--paper'));
      state.ink ||= toHex(current('--ink'));
    }
    save(); applyDesign(); syncPanel();
  });
  panel.addEventListener('click', async e => {
    const sw = e.target.closest('[data-sw]');
    if (sw) {
      const s = SWATCHES[+sw.dataset.sw];
      Object.assign(state, { paper: s.paper, ink: s.ink, accent: s.accent });
      save(); applyDesign(); syncPanel();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'reset') { state = { ...DEFAULTS }; save(); applyDesign(); syncPanel(); }
    if (act === 'copy') {
      const b = e.target;
      try { await navigator.clipboard.writeText(JSON.stringify(state, null, 2)); b.textContent = 'कॉपी झालं ✓'; }
      catch { b.textContent = 'कॉपी झालं नाही'; }
      setTimeout(() => { b.textContent = 'सेटिंग्ज कॉपी करा'; }, 1600);
    }
  });
}

// The header's day / sepia / night switch takes over from custom colours.
export function clearColors() {
  Object.assign(state, { paper: '', ink: '', accent: '' });
  save(); applyDesign(); syncPanel();
}
