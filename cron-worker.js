/* Cloudflare Worker that records CCU every minute into D1 – it runs on its own, nobody needs the site open.
   Paste this into a new Worker (Workers & Pages → Create → Hello World → Edit code), then on that Worker:
   - Settings → Bindings → Add → D1 database, variable name DB
   - Settings → Triggers → Cron Triggers → add  * * * * *   (every minute)
   The Pages site reads the history through functions/ccu.js (bind the same D1 database there as DB too).
   ccu   = one row per minute (last 3 days)
   ccu15 = highest value per 15 minutes (400 days), so peaks are never lost */
const UNIVERSE_ID = '10529904359';   // or set a UNIVERSE_ID variable on the Worker
const DAY = 864e5, MIN = 6e4, Q = 15 * MIN;

async function sampleCcu(env) {
  const universe = env.UNIVERSE_ID || UNIVERSE_ID;
  const g = (await (await fetch(`https://games.roblox.com/v1/games?universeIds=${universe}`)).json()).data?.[0];
  if (!g) throw new Error('No game found for universe ' + universe);
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
  return { t, v, playing: g.playing, serverSum: sum, servers };
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(sampleCcu(env)); },
  // Opening the Worker's URL shows the last 5 samples, to check that it is recording
  async fetch(request, env) {
    if (!env.DB) return Response.json({ error: 'No D1 database bound as DB' }, { status: 500 });
    try {
      const { results } = await env.DB.prepare('SELECT * FROM ccu ORDER BY t DESC LIMIT 5').all();
      return Response.json({ ok: true, latest: results.map(r => ({ ...r, time: new Date(r.t).toISOString() })) });
    } catch (e) {
      return Response.json({ ok: false, note: 'No samples yet – the first cron run creates the tables.', error: e.message });
    }
  }
};
