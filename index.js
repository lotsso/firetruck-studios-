/* One Worker that serves the website (public/ folder) AND the /analytics API.
   Needs: secret ROBLOX_API_KEY (Cloudflare dashboard) and var UNIVERSE_ID (in wrangler.jsonc).
   CCU history (/ccu) also needs: a D1 database bound as DB and a Cron Trigger "* * * * *" (every minute). */
const DAY = 864e5;
const BASE = 'https://apis.roblox.com/analytics-query-api';
const METRICS = ['DailyActiveUsers','MonthlyActiveUsers','AveragePlayTimeMinutesPerDAU','TotalPlayTimeHours',
  'AverageSessionLengthMinutes','Visits','DailyRevenue','PayingUsers','PayingUsersCVR','AverageRevenuePerPayingUser',
  'AverageRevenuePerUser','RFYPlayThroughRate','ForwardD1Retention','ForwardD7Retention','ForwardD30Retention','DauMauStickiness'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

async function queryMetric(env, metric, startTime, endTime) {
  const h = { 'x-api-key': env.ROBLOX_API_KEY, 'Content-Type': 'application/json' };
  let r;
  for (let t = 0; t < 3; t++) {                    // retry when rate-limited (HTTP 429)
    r = await fetch(`${BASE}/v1/universes/${env.UNIVERSE_ID}/metrics`, {
      method: 'POST', headers: h, body: JSON.stringify({ metric, granularity: 'OneDay', startTime, endTime })
    });
    if (r.status !== 429) break;
    await sleep(2500);
  }
  if (!r.ok && r.status !== 202) throw new Error(`${metric}: HTTP ${r.status}`);
  let op = await r.json();
  for (let i = 0; i < 6 && !op.done; i++) {
    await sleep(1000);
    r = await fetch(`${BASE}/${op.path}`, { headers: h });
    if (!r.ok) throw new Error(`${metric}: poll HTTP ${r.status}`);
    op = await r.json();
  }
  if (!op.done) throw new Error(`${metric}: timeout`);
  const vals = op.response?.values || [];
  const series = vals.find(v => !v.breakdowns?.length) || vals[0];
  return (series?.dataPoints || []).map(p => [Date.parse(p.time), Number(p.value)]);
}

async function analytics(request, env, ctx) {
  if (!env.ROBLOX_API_KEY || !env.UNIVERSE_ID)
    return json({ error: 'Missing ROBLOX_API_KEY (secret) or UNIVERSE_ID (variable) on this Worker' }, 500);
  // Always fetch the full history once (16 queries) and cache it; the page filters periods itself.
  // This avoids Roblox's rate limit (30 queries/min) when switching periods.
  const key = new Request('https://cache.local/analytics-full');
  const cached = await caches.default.match(key);
  if (cached) return new Response(await cached.text(), { headers: { 'Content-Type': 'application/json' } });

  const end = Math.floor(Date.now() / DAY) * DAY + DAY;
  // Start at the game's creation date (small range = fast, synchronous answers); fall back to 180 days.
  let start = end - 180 * DAY;
  try {
    const g = (await (await fetch(`https://games.roblox.com/v1/games?universeIds=${env.UNIVERSE_ID}`)).json()).data?.[0];
    if (g?.created) start = Math.floor(Date.parse(g.created) / DAY) * DAY - DAY;
  } catch (e) {}
  start = Math.max(start, end - 1400 * DAY);
  const span = Math.round((end - start) / DAY), iso = t => new Date(t).toISOString();
  const res = await Promise.allSettled(METRICS.map(m => queryMetric(env, m, iso(start), iso(end))));
  const data = {}, errors = {};
  res.forEach((r, i) => r.status === 'fulfilled' ? data[METRICS[i]] = r.value : errors[METRICS[i]] = r.reason.message);
  const body = JSON.stringify({ end, days: span, data, errors });
  const ttl = Object.keys(errors).length ? 30 : 600;   // retry sooner if some metrics failed
  ctx.waitUntil(caches.default.put(key, new Response(body, { headers: { 'Cache-Control': `max-age=${ttl}` } })));
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
}

/* ---------- CCU history: sampled every minute by the Cron Trigger, stored in D1 ----------
   ccu   = one row per minute (last 3 days), ccu15 = highest value per 15 minutes (400 days), so peaks are never lost. */
const MIN = 6e4, Q = 15 * MIN;

async function sampleCcu(env) {
  if (!env.DB || !env.UNIVERSE_ID) return;
  const g = (await (await fetch(`https://games.roblox.com/v1/games?universeIds=${env.UNIVERSE_ID}`)).json()).data?.[0];
  if (!g) return;
  // `playing` above is cached by Roblox for a minute or two; the public server list is live, so take the higher one
  let sum = 0, servers = 0, cursor = '';
  try {
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`https://games.roblox.com/v1/games/${g.rootPlaceId}/servers/Public?limit=100` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''));
      if (!r.ok) break;
      const page = await r.json();
      for (const sv of page.data || []) { sum += sv.playing || 0; servers++; }
      if (!(cursor = page.nextPageCursor)) break;
    }
  } catch (e) {}
  const t = Math.floor(Date.now() / MIN) * MIN, v = Math.max(g.playing || 0, sum);
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS ccu (t INTEGER PRIMARY KEY, v INTEGER, playing INTEGER, servers INTEGER)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS ccu15 (t INTEGER PRIMARY KEY, v INTEGER)'),
    env.DB.prepare('INSERT OR REPLACE INTO ccu VALUES (?1, ?2, ?3, ?4)').bind(t, v, g.playing || 0, servers),
    env.DB.prepare('INSERT INTO ccu15 VALUES (?1, ?2) ON CONFLICT(t) DO UPDATE SET v = MAX(v, excluded.v)').bind(Math.floor(t / Q) * Q, v),
    env.DB.prepare('DELETE FROM ccu WHERE t < ?1').bind(t - 3 * DAY),
    env.DB.prepare('DELETE FROM ccu15 WHERE t < ?1').bind(t - 400 * DAY)
  ]);
}

async function ccuHistory(request, env) {
  if (!env.DB) return json({ error: 'No D1 database bound as DB on this Worker' }, 404);
  const days = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('days')) || 1, 1), 200);
  const key = new Request(`https://cache.local/ccu?days=${days}`);
  const cached = await caches.default.match(key);
  if (cached) return new Response(await cached.text(), { headers: { 'Content-Type': 'application/json' } });
  // per-minute rows for the last 2 days, 15-minute peaks before that; 2x the period so "previous period" works
  const now = Date.now(), split = Math.floor((now - 2 * DAY) / Q) * Q;
  let points = [];
  try {
    const { results } = await env.DB.prepare(
      'SELECT t, v FROM ccu15 WHERE t >= ?1 AND t < ?2 UNION ALL SELECT t, v FROM ccu WHERE t >= ?2 ORDER BY t'
    ).bind(now - 2 * days * DAY, split).all();
    points = results.map(r => [r.t, r.v]);
  } catch (e) {}   // tables are created by the first cron run
  const body = JSON.stringify({ now, points });
  await caches.default.put(key, new Response(body, { headers: { 'Cache-Control': 'max-age=60' } }));
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/analytics') return await analytics(request, env, ctx);
      if (pathname === '/ccu') return await ccuHistory(request, env);
    } catch (e) { return json({ error: e.message }, 500); }
    return env.ASSETS.fetch(request);   // everything else = the static website
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(sampleCcu(env)); }
};
