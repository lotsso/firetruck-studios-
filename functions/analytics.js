/* Cloudflare Pages Function – available at /analytics on your Pages site (?universe=<id>, default UNIVERSE_ID).
   Needs (Pages → Settings → Variables and Secrets, for Production): ROBLOX_API_KEY (Secret), UNIVERSE_ID (Text).
   Other games: list their universe ID in UNIVERSES below. If their API key is not ROBLOX_API_KEY,
   add it as the secret ROBLOX_API_KEY_<universeId> (e.g. ROBLOX_API_KEY_10770839978).
   Redeploy after adding or changing them. */
const UNIVERSES = ['10770839978'];   // games besides UNIVERSE_ID: Destroy a Brick!
const DAY = 864e5;
const BASE = 'https://apis.roblox.com/analytics-query-api';
const METRICS = ['DailyActiveUsers','MonthlyActiveUsers','AveragePlayTimeMinutesPerDAU','TotalPlayTimeHours',
  'AverageSessionLengthMinutes','Visits','DailyRevenue','PayingUsers','PayingUsersCVR','AverageRevenuePerPayingUser',
  'AverageRevenuePerUser','RFYPlayThroughRate','ForwardD1Retention','ForwardD7Retention','ForwardD30Retention','DauMauStickiness'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

async function queryMetric(key, universe, metric, startTime, endTime) {
  const h = { 'x-api-key': key, 'Content-Type': 'application/json' };
  let r;
  for (let t = 0; t < 3; t++) {                    // retry when rate-limited (HTTP 429)
    r = await fetch(`${BASE}/v1/universes/${universe}/metrics`, {
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
  const main = String(env.UNIVERSE_ID || '');
  const universe = new URL(request.url).searchParams.get('universe') || main;
  if (universe !== main && !UNIVERSES.includes(universe)) return json({ error: 'Unknown universe ' + universe }, 404);
  const key = env['ROBLOX_API_KEY_' + universe] || env.ROBLOX_API_KEY;
  if (!key || !universe)
    return json({ error: 'Missing ROBLOX_API_KEY (secret) or UNIVERSE_ID (variable) in Pages settings (Production) – redeploy after adding them' }, 500);
  // Always fetch the full history once (16 queries) and cache it; the page filters periods itself.
  // This avoids Roblox's rate limit (30 queries/min) when switching periods.
  const cacheKey = new Request('https://cache.local/analytics-full?u=' + universe);
  const cached = await caches.default.match(cacheKey);
  if (cached) return new Response(await cached.text(), { headers: { 'Content-Type': 'application/json' } });

  const end = Math.floor(Date.now() / DAY) * DAY + DAY;
  // Start at the game's creation date (small range = fast, synchronous answers); fall back to 180 days.
  let start = end - 180 * DAY;
  try {
    const g = (await (await fetch(`https://games.roblox.com/v1/games?universeIds=${universe}`)).json()).data?.[0];
    if (g?.created) start = Math.floor(Date.parse(g.created) / DAY) * DAY - DAY;
  } catch (e) {}
  start = Math.max(start, end - 1400 * DAY);
  const span = Math.round((end - start) / DAY), iso = t => new Date(t).toISOString();
  const res = await Promise.allSettled(METRICS.map(m => queryMetric(key, universe, m, iso(start), iso(end))));
  const data = {}, errors = {};
  res.forEach((r, i) => r.status === 'fulfilled' ? data[METRICS[i]] = r.value : errors[METRICS[i]] = r.reason.message);
  const body = JSON.stringify({ end, days: span, data, errors });
  const ttl = Object.keys(errors).length ? 30 : 600;   // retry sooner if some metrics failed
  ctx.waitUntil(caches.default.put(cacheKey, new Response(body, { headers: { 'Cache-Control': `max-age=${ttl}` } })));
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env, waitUntil }) {
  try { return await analytics(request, env, { waitUntil }); }
  catch (e) { return json({ error: e.message }, 500); }
}
