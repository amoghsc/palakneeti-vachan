// Supabase Edge Function "pk-suggest": POST { text } → suggested palakneeti.in articles.
// The Gemini key lives only in this function's secrets (GEMINI_API_KEY).
import { suggest } from './suggest.js';

const ALLOWED = [/^https:\/\/amoghsc\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const recent = new Map<string, number[]>(); // per-IP request times, best effort per instance
const LIMIT = 8, WINDOW_MS = 10 * 60 * 1000;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const headers = {
    'Access-Control-Allow-Origin': ALLOWED.some(r => r.test(origin)) ? origin : 'https://amoghsc.github.io',
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: 'post-only' }, 405);

  const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const times = (recent.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (times.length >= LIMIT) return reply({ error: 'rate-limited' }, 429);
  recent.set(ip, [...times, now]);

  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return reply({ error: 'not-configured' }, 503);
  try {
    const { text } = await req.json();
    return reply(await suggest(text, { key, model: Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash' }));
  } catch (err) {
    const e = err as { status?: number; message?: string };
    return reply({ error: e.message || 'failed' }, e.status || 502);
  }
});
