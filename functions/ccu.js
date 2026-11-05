/* Cloudflare Pages Function – available at /ccu on your Pages site (?universe=<id>, default UNIVERSE_ID).
   Reads the CCU history recorded every minute by cron-worker.js.
   Needs (Pages → Settings → Bindings): the same D1 database as cron-worker.js, variable name DB. Redeploy after adding it.
   Main game: tables ccu / ccu15. Other games (UNIVERSES, keep in sync with cron-worker.js): ccu_<id> / ccu15_<id>. */
const UNIVERSES = ['10770839978'];   // games besides UNIVERSE_ID: Destroy a Brick!
const DAY = 864e5, Q = 15 * 6e4;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.DB) return json({ error: 'No D1 database bound as DB on this Pages project' }, 404);
  const url = new URL(request.url);
  const main = String(env.UNIVERSE_ID || '10529904359');
  const u = url.searchParams.get('universe') || main;
  if (u !== main && !UNIVERSES.includes(u)) return json({ error: 'Unknown universe ' + u }, 404);
  const [T, T15] = u === main ? ['ccu', 'ccu15'] : ['ccu_' + u, 'ccu15_' + u];

  if (url.searchParams.has('latest')) {   // newest sample only (live player count for the site)
    let r = null;
    try { r = await env.DB.prepare(`SELECT t, v FROM ${T} ORDER BY t DESC LIMIT 1`).first(); } catch (e) {}
    return new Response(JSON.stringify({ now: Date.now(), t: r?.t ?? null, v: r?.v ?? null }),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days')) || 1, 1), 200);
  const key = new Request(`https://cache.local/ccu?u=${u}&days=${days}`);
  const cached = await caches.default.match(key);
  if (cached) return new Response(await cached.text(), { headers: { 'Content-Type': 'application/json' } });
  // per-minute rows for the last 2 days, 15-minute peaks before that; 2x the period so "previous period" works
  const now = Date.now(), split = Math.floor((now - 2 * DAY) / Q) * Q;
  let points = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT t, v FROM ${T15} WHERE t >= ?1 AND t < ?2 UNION ALL SELECT t, v FROM ${T} WHERE t >= ?2 ORDER BY t`
    ).bind(now - 2 * days * DAY, split).all();
    points = results.map(r => [r.t, r.v]);
  } catch (e) {}   // tables are created by the first cron run of cron-worker.js
  const body = JSON.stringify({ now, points });
  waitUntil(caches.default.put(key, new Response(body, { headers: { 'Cache-Control': 'max-age=60' } })));
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
}
