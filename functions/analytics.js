/* Cloudflare Pages Function – available at /analytics on your site.
   Needs these in Pages → Settings → Variables and Secrets:
   - ROBLOX_API_KEY (Secret)   - UNIVERSE_ID (Text, e.g. 10529904359)
   After adding them, redeploy the site. */
const DAY = 864e5;
const BASE = 'https://apis.roblox.com/analytics-query-api';
const METRICS = ['DailyActiveUsers','MonthlyActiveUsers','AveragePlayTimeMinutesPerDAU','TotalPlayTimeHours',
  'AverageSessionLengthMinutes','Visits','DailyRevenue','PayingUsers','PayingUsersCVR','AverageRevenuePerPayingUser',
  'AverageRevenuePerUser','RFYPlayThroughRate','ForwardD1Retention','ForwardD7Retention','ForwardD30Retention','DauMauStickiness'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function queryMetric(env, metric, startTime, endTime) {
  const h = { 'x-api-key': env.ROBLOX_API_KEY, 'Content-Type': 'application/json' };
  let r = await fetch(`${BASE}/v1/universes/${env.UNIVERSE_ID}/metrics`, {
    method: 'POST', headers: h, body: JSON.stringify({ metric, granularity: 'OneDay', startTime, endTime })
  });
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

export async function onRequestGet({ request, env, waitUntil }) {
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (!env.ROBLOX_API_KEY || !env.UNIVERSE_ID) return json({ error: 'Missing ROBLOX_API_KEY or UNIVERSE_ID in Pages settings (redeploy after adding them)' }, 500);
  const url = new URL(request.url);
  const all = url.searchParams.get('days') === 'all';
  const n = all ? 734 : Math.min(Math.max(parseInt(url.searchParams.get('days')) || 7, 1), 734);
  const span = all ? 1468 : n * 2;
  const key = new Request(`https://cache.local/analytics?span=${span}`);
  const cached = await caches.default.match(key);
  if (cached) return new Response(await cached.text(), { headers: { 'Content-Type': 'application/json' } });

  const end = Math.floor(Date.now() / DAY) * DAY + DAY;
  const start = end - span * DAY, iso = t => new Date(t).toISOString();
  const res = await Promise.allSettled(METRICS.map(m => queryMetric(env, m, iso(start), iso(end))));
  const data = {}, errors = {};
  res.forEach((r, i) => r.status === 'fulfilled' ? data[METRICS[i]] = r.value : errors[METRICS[i]] = r.reason.message);
  const body = JSON.stringify({ end, days: span, data, errors });
  waitUntil(caches.default.put(key, new Response(body, { headers: { 'Cache-Control': 'max-age=600' } })));
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
}
