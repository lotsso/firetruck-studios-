/* ============================================================
   CONFIG – shared by index.html and stats.html
   ============================================================ */
const CONFIG = {
  // Roblox game IDs. Creator analytics and per-minute CCU also need the game's universe ID in
  // functions/analytics.js, functions/ccu.js and cron-worker.js (the first game is UNIVERSE_ID there).
  games: ['75987095614345', '99106007678581'],
  names: { '75987095614345': '+1 Firefighter Evolution', '99106007678581': 'Destroy a Brick!' },   // optional display names (Roblox returns the original title)
  idType: 'place',             // 'place' (the ID from the game link) or 'universe'
  apiDomain: 'roproxy.com',    // fallback CORS proxy, used only when this site's own /rbx proxy (functions/rbx) fails
  refreshMs: 30000,

  // DevEx calculator (devex.html): revenue split per game ID, in percent.
  // Games not on Roblox yet use any other key and get their name from `names`.
  payouts: { '75987095614345': { lotos: 5, lolcix: 45, partner: 50 }, '99106007678581': { lotos: 30, lolcix: 70 } },
  robuxUsd: 0.004,             // USD paid per Robux
  usdPln: 3.9,                 // used only if the live NBP exchange rate can't be fetched

  // Creator analytics are served by /analytics on this same site (functions/analytics.js, Cloudflare Pages).
  // Use '' to disable, or a full URL if you host the API elsewhere (see worker.js).
  workerUrl: location.origin
};

const getJSON = async url => { const r = await fetch(url); if(!r.ok) throw new Error(r.status); return r.json(); };
const siteApi = () => CONFIG.workerUrl.replace(/\/$/,'');
// Public Roblox API (sub = games / thumbnails / apis): this site's own proxy first, roproxy.com if that fails
async function rbx(sub, path){
  if(CONFIG.workerUrl){ try{ return await getJSON(`${siteApi()}/rbx/${sub}${path}`); }catch(e){} }
  return getJSON(`https://${sub}.${CONFIG.apiDomain}${path}`);
}
const nf = new Intl.NumberFormat('en-US');
const esc = t => String(t ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function fmt(n){
  if(n>=1e9) return (n/1e9).toFixed(1).replace(/\.0$/,'')+'B+';
  if(n>=1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'')+'M+';
  if(n>=1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'')+'K+';
  return Math.round(n)+'+';
}
// Newest player count recorded every minute by cron-worker.js (via /ccu). Roblox's own `playing` lags by minutes.
// null if the game isn't recorded, or the sample is unavailable or older than 3 minutes.
async function latestCcu(universeId){
  if(!CONFIG.workerUrl) return null;
  try{
    const r = await getJSON(`${siteApi()}/ccu?latest=1&universe=${encodeURIComponent(universeId)}`);
    return r.v != null && r.now - r.t < 3*6e4 ? r.v : null;
  }catch(e){ return null; }
}
// place -> universe never changes, so remember it (memory + localStorage) instead of asking the proxy every refresh
const uniCache = {};
async function toUniverse(id){
  if(CONFIG.idType === 'universe') return { universeId: String(id), placeId: null };
  let u = uniCache[id];
  if(!u){ try{ u = localStorage.getItem('ppc_uni_'+id); }catch(e){} }
  if(!u){
    try{
      const r = await rbx('apis', `/universes/v1/places/${id}/universe`);
      if(!r.universeId) throw new Error('no universeId');
      u = String(r.universeId);
      try{ localStorage.setItem('ppc_uni_'+id, u); }catch(e){}
    }catch(e){ return { universeId: String(id), placeId: null }; }
  }
  uniCache[id] = u;
  return { universeId: u, placeId: String(id) };
}
// Screenshots of each game (by universe ID): [[url, ...], ...] in the same order
async function fetchShots(universeIds, count = 3){
  const r = await rbx('thumbnails', `/v1/games/multiget/thumbnails?universeIds=${universeIds.join(',')}&countPerUniverse=${count}&size=768x432&format=Png`);
  return universeIds.map(u => ((r.data||[]).find(x=>String(x.universeId)===String(u))?.thumbnails||[])
    .filter(t=>t.state==='Completed' && t.imageUrl).map(t=>t.imageUrl));
}
async function fetchGames(){
  const ids = await Promise.all(CONFIG.games.map(toUniverse));
  const list = ids.map(i=>i.universeId).join(',');
  const [info, icons, lives] = await Promise.all([
    rbx('games', `/v1/games?universeIds=${list}`),
    rbx('thumbnails', `/v1/games/icons?universeIds=${list}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`).catch(()=>({data:[]})),
    Promise.all(ids.map(u => latestCcu(u.universeId)))
  ]);
  // match by universe ID, not by position: Roblox doesn't promise to keep the requested order
  return ids.map((u,i) => {
    const g = info.data.find(x=>String(x.id)===u.universeId);
    return g && {
      ...g, inputId: CONFIG.games[i], name: CONFIG.names?.[CONFIG.games[i]] || g.name,
      playing: lives[i] ?? g.playing,
      icon: (icons.data.find(x=>x.targetId===g.id)||{}).imageUrl
    };
  }).filter(Boolean);
}
