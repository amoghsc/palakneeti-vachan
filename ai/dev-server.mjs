// Local stand-in for the pk-suggest Edge Function, for testing on localhost.
// Usage: GEMINI_API_KEY=… node ai/dev-server.mjs   (listens on 127.0.0.1:5203)
import http from 'node:http';
import { suggest } from './suggest.js';

const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
if (!key) { console.error('GEMINI_API_KEY is not set'); process.exit(1); }

http.createServer(async (req, res) => {
  const headers = {
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, headers); return res.end(); }
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    const out = await suggest(JSON.parse(body || '{}').text, { key, model });
    res.writeHead(200, headers); res.end(JSON.stringify(out));
  } catch (err) {
    res.writeHead(err.status || 502, headers); res.end(JSON.stringify({ error: err.message }));
  }
}).listen(5203, '127.0.0.1', () => console.log(`pk-suggest dev server on http://127.0.0.1:5203 (${model})`));
