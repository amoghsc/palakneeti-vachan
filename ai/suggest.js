// Suggests palakneeti.in articles for a reader's own words (Marathi, English or Marathi in
// English letters). Small Gemini calls around a live search of palakneeti.in; nothing is stored.
// Plain JS with fetch only, so it runs both in the Supabase Edge Function (Deno)
// and in the local Node dev server.

const WP = 'https://palakneeti.in/wp-json/wp/v2/posts';
// issue posts, Khelghar news and announcements are not articles
const NOT_ARTICLES = '48,3,52,44,602,603,605,43';

// When a model is busy (503/429), try once more and then the next Flash model.
const FALLBACKS = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gemini(key, model, prompt, schema, level = 'minimal') {
  const models = [model, ...FALLBACKS.filter(m => m !== model)];
  let last, thinking = true;
  for (const m of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json', responseSchema: schema, temperature: 0, seed: 11, maxOutputTokens: 4096, // fixed seed: same question, same answer
            ...(thinking ? { thinkingConfig: { thinkingLevel: level } } : {}),
          },
        }),
      });
      if (res.status === 400 && thinking) { thinking = false; attempt--; continue; } // model without this thinking level
      if (res.ok) {
        const data = await res.json();
        const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
        return JSON.parse(text);
      }
      last = `gemini ${res.status}: ${(await res.text()).slice(0, 160)}`;
      if (res.status !== 503 && res.status !== 429) throw new Error(last);
      await sleep(600 + attempt * 900);
    }
  }
  throw Object.assign(new Error(last || 'gemini unavailable'), { status: 503 });
}

const strip = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&#8211;/g, '–').replace(/&#8230;/g, '…')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

async function searchSite(query) {
  const q = new URLSearchParams({ search: query, per_page: '8', orderby: 'relevance', categories_exclude: NOT_ARTICLES, _fields: 'id,title,excerpt,date' });
  const res = await fetch(`${WP}?${q}`, { headers: { accept: 'application/json' } });
  if (!res.ok) return [];
  return (await res.json()).map(p => ({ id: p.id, title: strip(p.title.rendered), excerpt: strip(p.excerpt.rendered).slice(0, 220), date: p.date }));
}

// Step 0 rewrites every question in plain Devanagari Marathi, so the same question typed in
// Marathi, English or Marathi-in-English letters reaches the search step as the same text.
const ASKED_SCHEMA = { type: 'OBJECT', properties: { marathi: { type: 'STRING' } }, required: ['marathi'] };
const tidy = s => String(s || '').normalize('NFC').replace(/[\s।.!?,;:]+$/u, '').replace(/\s+/g, ' ').trim();

const TERMS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    queries: { type: 'ARRAY', items: { type: 'STRING' } },
    note: { type: 'STRING' },
    urgent: { type: 'BOOLEAN' },
  },
  required: ['queries', 'note', 'urgent'],
};

const PICKS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    picks: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, reason: { type: 'STRING' } }, required: ['id', 'reason'] },
    },
  },
  required: ['picks'],
};

export async function suggest(text, { key, model }) {
  text = String(text || '').trim();
  if (text.length < 8) throw Object.assign(new Error('too-short'), { status: 400 });
  if (text.length > 3000) text = text.slice(0, 3000);

  // 0. whatever the script → one plain Devanagari Marathi sentence
  const norm = await gemini(key, model, `खालचा मजकूर मराठीत, इंग्रजीत किंवा इंग्रजी अक्षरांत लिहिलेल्या मराठीत आहे
(उदा. 'malaa premaawishayii lekh suchaw' = 'मला प्रेमाविषयी लेख सुचव'; 'maza mulga mobile sodat nahi' = 'माझा मुलगा मोबाईल सोडत नाही').
तो साध्या, प्रमाण देवनागरी मराठीत "marathi" मध्ये लिहा. अर्थ, शब्दक्रम आणि क्रियापदाचे रूप शक्य तितके तसेच ठेवा; काहीही वाढवू नका, स्पष्टीकरण देऊ नका.
मजकूर: <<<${text}>>>`, ASKED_SCHEMA);
  const asked = tidy(norm.marathi) || tidy(text);

  // 1. the reader's situation → Marathi search phrases
  const terms = await gemini(key, model, `तुम्ही 'पालकनीती' या पालकत्वावरील मराठी मासिकाच्या वाचकांना मदत करता.
एका वाचकाने आपली परिस्थिती लिहिली आहे:
<<<${asked}>>>

हे करा:
1. "queries": पालकनीतीच्या मराठी लेखांमध्ये सापडतील असे ८ ते १० मराठी शोध-शब्द. बहुतेक दोन शब्दांचे जोड असावेत जे एकाच लेखात एकत्र येतील (उदा. 'शाळेची भीती', 'मोबाईल राग', 'किशोरवयीन संवाद', 'मुलांना शिक्षा'), दोन-तीन एक शब्दाचे चालतील. लेखांत प्रत्यक्ष वापरले जाणारे साधे शब्द निवडा. इंग्रजी नको.
2. "note": वाचकाच्या परिस्थितीची जाणीव ठेवणारे एक उबदार, आदरपूर्वक मराठी वाक्य (जास्तीत जास्त २५ शब्द). सल्ला देऊ नका.
3. "urgent": मजकुरात आत्महानी, हिंसा, अत्याचार किंवा तातडीच्या धोक्याचा उल्लेख असेल तर true, नाहीतर false.`, TERMS_SCHEMA);

  // 2. live search of palakneeti.in for each phrase
  const queries = (terms.queries || []).map(q => String(q).trim()).filter(Boolean).slice(0, 10);
  const found = (await Promise.all(queries.map(q => searchSite(q).catch(() => [])))).flat();
  const candidates = [];
  for (const c of found) if (!candidates.some(x => x.id === c.id)) candidates.push(c);
  const pool = candidates.slice(0, 45);
  if (!pool.length) return { asked, note: terms.note, urgent: !!terms.urgent, queries, picks: [] };

  // 3. pick the articles that would genuinely help, with a one-line reason each
  const list = pool.map(c => `[${c.id}] ${c.title} — ${c.excerpt}`).join('\n');
  const ranked = await gemini(key, model, `वाचकाची परिस्थिती:
<<<${asked}>>>

पालकनीतीचे हे लेख सापडले आहेत (प्रत्येकापुढे [id], शीर्षक आणि सुरुवात):
${list}

या वाचकाला उपयोगी पडतील असे ४ ते ६ लेख निवडा, सर्वात उपयोगी आधी. फक्त वरच्या यादीतले id वापरा.
प्रत्येकासाठी "reason": हा लेख त्यांना का उपयोगी पडेल हे सांगणारे एक साधे मराठी वाक्य (जास्तीत जास्त २० शब्द, 'तुम्ही' वापरून, उपदेश न करता).
आधी परिस्थितीशी थेट जोडलेले लेख घ्या. ते ४ पेक्षा कमी असतील तर त्याच प्रश्नाच्या जवळच्या पैलूंवरचे (नाती, संवाद, भावना, सवयी) लेखही घ्या, पण असंबंधित लेख घेऊ नका.`, PICKS_SCHEMA);

  const byId = new Map(pool.map(c => [c.id, c]));
  const picks = (ranked.picks || []).filter(p => byId.has(p.id)).slice(0, 6)
    .map(p => ({ ...byId.get(p.id), reason: String(p.reason || '').trim() }));
  return { asked, note: terms.note, urgent: !!terms.urgent, queries, picks };
}
