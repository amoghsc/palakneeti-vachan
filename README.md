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
