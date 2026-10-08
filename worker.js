/* ============================================================
   Cloudflare Worker – proxy between stats.html and Roblox Open Cloud
   The API key lives only here (never in the HTML).

   SETUP (Cloudflare → Workers → Settings):
   - Secret   ROBLOX_API_KEY   key from Creator Hub → Open Cloud → API Keys
                               system: universe-analytics, operation: universe.analytics:read,
                               select your experience (universe)
   - Variable UNIVERSE_ID      e.g. 10529904359
   - Variable ALLOWED_ORIGIN   e.g. https://yoursite.com  (your website's domain)
   - KV binding  CCU           (Storage → KV → create a namespace and bind it as CCU)
   - Cron trigger  0,15,30,45 * * * *   (records CCU every 15 min for the chart history)
   ============================================================ */
const DAY = 864e5;
const METRICS = ['DailyActiveUsers','MonthlyActiveUsers','AveragePlayTimeMinutesPerDAU','TotalPlayTimeHours',
  'AverageSessionLengthMinutes','Visits','DailyRevenue','PayingUsers','PayingUsersCVR','AverageRevenuePerPayingUser',
  'AverageRevenuePerUser','RFYPlayThroughRate','ForwardD1Retention','ForwardD7Retention','ForwardD30Retention','DauMauStickiness'];
const BASE = 'https://apis.roblox.com/analytics-query-api';

const reply = (obj, cors, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors, ...extra } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function queryMetric(env, metric, startTime, endTime) {
  const h = { 'x-api-key': env.ROBLOX_API_KEY, 'Content-Type': 'application/json' };
  let r = await fetch(`${BASE}/v1/universes/${env.UNIVERSE_ID}/metrics`, {
    method: 'POST', headers: h, body: JSON.stringify({ metric, granularity: 'OneDay', startTime, endTime })
  });
  if (!r.ok && r.status !== 202) throw new Error(`${metric}: HTTP ${r.status}`);
  let op = await r.json();
  for (let i = 0; i < 10 && !op.done; i++) {           // long queries: polling
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

async function analytics(url, env, ctx) {
  const all = url.searchParams.get('days') === 'all';
  const n = all ? 734 : Math.min(Math.max(parseInt(url.searchParams.get('days')) || 7, 1), 734);
  const span = all ? 1468 : n * 2;                       // 2x period = current + previous
  const key = new Request(`https://cache.local/analytics?span=${span}`);
  const cached = await caches.default.match(key);
  if (cached) return cached.json();

  const end = Math.floor(Date.now() / DAY) * DAY + DAY;  // tomorrow 00:00 UTC (exclusive)
  const start = end - span * DAY;
  const iso = t => new Date(t).toISOString();
  const res = await Promise.allSettled(METRICS.map(m => queryMetric(env, m, iso(start), iso(end))));
  const data = {}, errors = {};
  res.forEach((r, i) => r.status === 'fulfilled' ? data[METRICS[i]] = r.value : errors[METRICS[i]] = r.reason.message);
  const out = { end, days: span, data, errors };
  ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(out), { headers: { 'Cache-Control': 'max-age=600' } })));
  return out;
}

async function ccu(url, env) {
  const n = Math.min(parseInt(url.searchParams.get('days')) || 1, 90);
  const hist = JSON.parse((await env.CCU.get('history')) || '[]');
  return { points: hist.filter(p => p[0] >= Date.now() - 2 * n * DAY), now: Date.now() };
}

async function sampleCcu(env) {
  const r = await fetch(`https://games.roblox.com/v1/games?universeIds=${env.UNIVERSE_ID}`);
  const g = (await r.json()).data?.[0];
  if (!g) return;
  const hist = JSON.parse((await env.CCU.get('history')) || '[]');
  hist.push([Date.now(), g.playing]);
  await env.CCU.put('history', JSON.stringify(hist.slice(-8640)));   // ~90 days at 15 min
}

export default {
  async fetch(req, env, ctx) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Headers': '*' } });
    const url = new URL(req.url);
    try {
      if (url.pathname === '/analytics') return reply(await analytics(url, env, ctx), cors);
      if (url.pathname === '/ccu') return reply(await ccu(url, env), cors);
      return reply({ error: 'not found' }, cors, 404);
    } catch (e) { return reply({ error: e.message }, cors, 500); }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(sampleCcu(env)); }
};
