// Small Marathi text toolkit: tokenising, light stemming, TF-IDF similarity,
// pull-quote picking and Devanagari numerals. All computed in the browser.

const STOP = new Set(`आणि आहे आहेत होते होता होती हे ही हा त्या त्याला त्यांना त्यांच्या तर पण की ते ती तो
या ह्या असे असं अशी असा एक काही करून केले केला केली करत करतात करायला म्हणून मग मी आम्ही आपण
आपल्या आपल्याला तुम्ही तू मला माझ्या माझा माझी नाही नाहीत होतं होतो सगळे सगळ्या खूप अगदी कधी
कसं कसे काय कोण जे जो जी ज्या ज्यांना इथे तिथे तेव्हा जेव्हा पर्यंत साठी मध्ये वर खाली बरोबर सारखे
अजून आता नेहमी किंवा असतं असते असतो असतात त्यात त्याचा त्याची त्याचे तिला तिच्या त्यांनी आपली आपला
आपले म्हणजे मात्र तरी अशा अशी तसं तसे जसं कारण यांच्या यांना यांनी त्यामुळे झालं झाले झाली झाला
होऊन घेऊन देऊन येऊन जाऊन करणं करणे असणं असताना होईल नसतं एखादा एखादी एखाद्या प्रत्येक
सुद्धा देखील फक्त पुन्हा परत आधी नंतर आत बाहेर जास्त कमी मोठं मोठे छोटे`.split(/\s+/));

const SUFFIXES = ['ांच्या', 'ाच्या', 'च्या', 'ांनी', 'ांना', 'ांचा', 'ांची', 'ांचे', 'मध्ये',
  'ाला', 'ाने', 'ाचा', 'ाची', 'ाचे', 'ांत', 'ात', 'चा', 'ची', 'चे', 'ला', 'ना', 'ने', 'नी', 'ही', 'त'];

function stem(w) {
  for (const s of SUFFIXES) if (w.endsWith(s) && w.length - s.length >= 3) return w.slice(0, -s.length);
  return w;
}

export function tokens(text) {
  const words = text.toLowerCase().match(/[ऀ-ॣ०-ॿa-z]+/g) || [];
  return words.filter(w => w.length > 2 && !STOP.has(w)).map(stem).filter(w => !STOP.has(w));
}

// Fills a.related (top matches) and returns graph edges [{source, target, w}].
export function relate(articles, { top = 4, edgesPer = 3 } = {}) {
  const df = new Map();
  const tfs = articles.map(a => {
    const tf = new Map();
    for (const t of tokens(a.title + ' ' + a.title + ' ' + a.text)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return tf;
  });
  const N = articles.length;
  const vecs = tfs.map(tf => {
    const v = new Map(); let norm = 0;
    for (const [t, c] of tf) {
      if (df.get(t) < 2) continue; // words only one article uses can't link anything
      const w = (1 + Math.log(c)) * Math.log(1 + N / df.get(t));
      v.set(t, w); norm += w * w;
    }
    return { v, norm: Math.sqrt(norm) || 1 };
  });
  const cos = (a, b) => {
    let s = 0;
    const [small, big] = a.v.size < b.v.size ? [a, b] : [b, a];
    for (const [t, w] of small.v) { const o = big.v.get(t); if (o) s += w * o; }
    return s / (a.norm * b.norm);
  };
  const jac = (x, y) => {
    if (!x.length || !y.length) return 0;
    const inter = x.filter(t => y.includes(t)).length;
    return inter / new Set([...x, ...y]).size;
  };

  const edges = [];
  articles.forEach((a, i) => {
    const scored = articles.map((b, j) => {
      if (i === j) return null;
      const why = [];
      const shared = a.topics.filter(t => b.topics.includes(t));
      if (shared.length) why.push(shared[0]);
      if (a.authorKey === b.authorKey) why.push('तोच लेखक');
      const score = 0.62 * cos(vecs[i], vecs[j]) + 0.28 * jac(a.topics, b.topics) + (a.authorKey === b.authorKey ? 0.1 : 0);
      return { article: b, score, why };
    }).filter(Boolean).sort((x, y) => y.score - x.score);
    a.related = scored.slice(0, top);
    scored.slice(0, edgesPer).forEach(s => {
      if (s.score > 0.06 && !edges.some(e => (e.source === s.article.id && e.target === a.id)))
        edges.push({ source: a.id, target: s.article.id, w: s.score });
    });
  });
  return edges;
}

// Picks one striking sentence for stories and pull quotes.
export function pullQuote(a) {
  const sentences = a.text.split(/(?<=[।?!.])\s+/).map(s => s.trim());
  const n = sentences.length;
  let best = null, bestScore = -1;
  sentences.forEach((s, i) => {
    if (s.length < 45 || s.length > 150 || /https?:|www\.|@|\d{4}/.test(s)) return;
    if (a.bio && a.bio.includes(s)) return;
    let score = 1 - Math.abs(i / n - 0.45);
    if (/[?!]$/.test(s)) score += 0.6;
    if (/[‘“'"]/.test(s)) score += 0.2;
    if (/^(मी|आपण|मुलं|मुलांना|पालक)/.test(s)) score += 0.3;
    if (score > bestScore) { bestScore = score; best = s; }
  });
  return best || a.excerpt.slice(0, 140);
}

const MR_DIGITS = '०१२३४५६७८९';
export const mr = n => String(n).replace(/\d/g, d => MR_DIGITS[d]);
export const readMins = a => Math.max(1, Math.round(a.words / 170));
const dateFmt = new Intl.DateTimeFormat('mr-IN', { day: 'numeric', month: 'long', year: 'numeric' });
export const mrDate = d => mr(dateFmt.format(d));

const seg = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('mr', { granularity: 'grapheme' }) : null;
export function firstGrapheme(s) {
  s = s.replace(/^डॉ\.\s*/, '');
  if (!seg) return s[0];
  for (const { segment } of seg.segment(s)) return segment;
  return '';
}
