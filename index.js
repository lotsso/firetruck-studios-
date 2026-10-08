/* One Worker that serves the website (public/ folder) AND the /analytics API.
   Needs: secret ROBLOX_API_KEY (Cloudflare dashboard) and var UNIVERSE_ID (in wrangler.jsonc). */
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
  for (let i = 0; i < 10 && !op.done; i++) {
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
  const span = 1468;
  const key = new Request('https://cache.local/analytics-full');
  const cached = await caches.default.match(key);
  if (cached) return new Response(await cached.text(), { headers: { 'Content-Type': 'application/json' } });

  const end = Math.floor(Date.now() / DAY) * DAY + DAY;
  const start = end - span * DAY, iso = t => new Date(t).toISOString();
  const res = await Promise.allSettled(METRICS.map(m => queryMetric(env, m, iso(start), iso(end))));
  const data = {}, errors = {};
  res.forEach((r, i) => r.status === 'fulfilled' ? data[METRICS[i]] = r.value : errors[METRICS[i]] = r.reason.message);
  const body = JSON.stringify({ end, days: span, data, errors });
  const ttl = Object.keys(errors).length ? 30 : 600;   // retry sooner if some metrics failed
  ctx.waitUntil(caches.default.put(key, new Response(body, { headers: { 'Cache-Control': `max-age=${ttl}` } })));
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/analytics') {
      try { return await analytics(request, env, ctx); }
      catch (e) { return json({ error: e.message }, 500); }
    }
    return env.ASSETS.fetch(request);   // everything else = the static website
  }
};
