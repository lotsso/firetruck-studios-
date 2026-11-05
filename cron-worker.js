/* Cloudflare Worker that records CCU every minute into D1 – it runs on its own, nobody needs the site open.
   Paste this into a new Worker (Workers & Pages → Create → Hello World → Edit code), then on that Worker:
   - Settings → Bindings → Add → D1 database, variable name DB
   - Settings → Triggers → Cron Triggers → add  * * * * *   (every minute)
   The Pages site reads the history through functions/ccu.js (bind the same D1 database there as DB too).
   Main game:   ccu   = one row per minute (last 3 days)
                ccu15 = highest value per 15 minutes (400 days), so peaks are never lost
   Other games: the same in ccu_<universeId> / ccu15_<universeId> (keep EXTRA in sync with functions/ccu.js) */
const UNIVERSE_ID = '10529904359';   // main game: +1 Firefighter Evolution (or set a UNIVERSE_ID variable on the Worker)
const EXTRA = ['10770839978'];       // other games: Destroy a Brick!
const DAY = 864e5, MIN = 6e4, Q = 15 * MIN;

const universes = env => { const main = String(env.UNIVERSE_ID || UNIVERSE_ID); return [main, ...EXTRA.filter(u => u !== main)]; };
const tables = (env, u) => u === universes(env)[0] ? ['ccu', 'ccu15'] : ['ccu_' + u, 'ccu15_' + u];

async function sampleCcu(env, universe) {
  const [T, T15] = tables(env, universe);
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
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${T} (t INTEGER PRIMARY KEY, v INTEGER, playing INTEGER, servers INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${T15} (t INTEGER PRIMARY KEY, v INTEGER)`),
    env.DB.prepare(`INSERT OR REPLACE INTO ${T} VALUES (?1, ?2, ?3, ?4)`).bind(t, v, g.playing || 0, servers),
    env.DB.prepare(`INSERT INTO ${T15} VALUES (?1, ?2) ON CONFLICT(t) DO UPDATE SET v = MAX(v, excluded.v)`).bind(Math.floor(t / Q) * Q, v),
    env.DB.prepare(`DELETE FROM ${T} WHERE t < ?1`).bind(t - 3 * DAY),
    env.DB.prepare(`DELETE FROM ${T15} WHERE t < ?1`).bind(t - 400 * DAY)
  ]);
  return { t, v, playing: g.playing, serverSum: sum, servers };
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(Promise.all(universes(env).map(u => sampleCcu(env, u)))); },
  // Opening the Worker's URL shows the last 5 samples of each game, to check that it is recording
  async fetch(request, env) {
    if (!env.DB) return Response.json({ error: 'No D1 database bound as DB' }, { status: 500 });
    const out = {};
    for (const u of universes(env)) {
      try {
        const { results } = await env.DB.prepare(`SELECT * FROM ${tables(env, u)[0]} ORDER BY t DESC LIMIT 5`).all();
        out[u] = { ok: true, latest: results.map(r => ({ ...r, time: new Date(r.t).toISOString() })) };
      } catch (e) {
        out[u] = { ok: false, note: 'No samples yet – the first cron run creates the tables.', error: e.message };
      }
    }
    return Response.json(out);
  }
};
