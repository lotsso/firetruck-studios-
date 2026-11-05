/* Cloudflare Pages Function – /rbx/<sub>/<path> → https://<sub>.roblox.com/<path>
   This site's own proxy for the public Roblox APIs the pages use. roproxy.com is shared by many sites
   and often answers 429, so it is only a fallback (see rbx() in shared.js).
   Only the endpoints below are allowed, and answers are cached at the edge so all visitors share them. */
const ROUTES = [
  { sub: 'apis',       re: /^\/universes\/v1\/places\/\d+\/universe$/, ttl: 86400 },   // place -> universe never changes
  { sub: 'games',      re: /^\/v1\/games$/,                            ttl: 30 },
  { sub: 'games',      re: /^\/v1\/games\/votes$/,                     ttl: 60 },
  { sub: 'games',      re: /^\/v1\/games\/\d+\/servers\/Public$/,      ttl: 30 },
  { sub: 'thumbnails', re: /^\/v1\/games\/icons$/,                     ttl: 3600 },
];
const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestGet({ request, params, waitUntil }) {
  const [sub, ...rest] = [].concat(params.path || []);
  const path = '/' + rest.join('/');
  const route = ROUTES.find(r => r.sub === sub && r.re.test(path));
  if (!route) return json({ error: 'Not an allowed Roblox endpoint' }, 404);

  const { search } = new URL(request.url);
  const key = new Request(`https://cache.local/rbx/${sub}${path}${search}`);
  const cached = await caches.default.match(key);
  if (cached) return cached;

  const r = await fetch(`https://${sub}.roblox.com${path}${search}`, { headers: { Accept: 'application/json' } });
  const res = new Response(await r.text(), {
    status: r.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${r.ok ? route.ttl : 0}` }
  });
  if (r.ok) waitUntil(caches.default.put(key, res.clone()));
  return res;
}
