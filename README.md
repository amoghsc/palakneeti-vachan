# पालकनीती — वाचनासाठी

A calm reading site for the Marathi parenting magazine [पालकनीती](https://palakneeti.in).

**Live:** https://amoghsc.github.io/palakneeti-vachan/

- Every article, author, issue and cover is fetched live from palakneeti.in's public WordPress API in the reader's browser. Nothing is copied or stored.
- 2026 issues not yet listed on palakneeti.in come from [palakneeti-masik](https://amoghsc.github.io/palakneeti-masik/).
- **Search** (🔍) finds titles, authors and subjects in Marathi or English spelling. **✦ माझ्यासाठी लेख सुचवा** sends what the reader writes about their situation to a Supabase Edge Function (`ai/`), which uses Gemini to turn it into Marathi search terms, searches palakneeti.in live, and picks the most helpful articles with a one-line reason. The Gemini key lives only in the function's secrets.

## Run locally

```
python3 serve.py 5202
```

Then open http://localhost:5202. `serve.py` only adds no-cache headers.

The design panel is hidden: add `?tune` to the address (e.g. `/?tune#/`) or press Ctrl+Shift+D.

## AI function

`ai/index.ts` + `ai/suggest.js` are deployed as the Supabase Edge Function `pk-suggest` (secret: `GEMINI_API_KEY`, optional `GEMINI_MODEL`). `ai/dev-server.mjs` runs the same logic locally on port 5203; use it with `?ai=local`.

## Usage stats

Search has two tabs: **शब्द शोध** (titles, authors, subjects, and words inside articles via
palakneeti.in's own search; Roman-letter queries are spelled back in Marathi from the loaded
articles' words) and **लेख सुचवा** (the AI function; it first rewrites any input as Devanagari
Marathi, with temperature 0 and a fixed seed, so the same question in either script gets the
same picks).

`js/track.js` counts page views, searches, AI suggestions and a few clicks into the
`pk_events` table on Supabase (insert-only for visitors). Each browser gets a random id in
localStorage; no IP, name or AI text is stored. Local copies don't count unless the address
has `?track`.

The private dashboard is `stats.html` (sign in with a shelfie account listed in `pk_members`).
`stats.html?demo` on localhost shows sample numbers without signing in.
