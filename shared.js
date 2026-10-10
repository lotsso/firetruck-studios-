/* ============================================================
   CONFIG – shared by index.html and stats.html
   ============================================================ */
const CONFIG = {
  games: ['75987095614345'],   // Roblox game IDs
  names: { '75987095614345': '+1 Firefighter Evolution' },   // optional display names (Roblox returns the original title)
  idType: 'place',             // 'place' (the ID from the game link) or 'universe'
  apiDomain: 'roproxy.com',    // CORS proxy; put your own proxy here
  refreshMs: 30000,

  // Creator analytics are served by /analytics on this same site (functions/analytics.js, Cloudflare Pages).
  // Use '' to disable, or a full URL if you host the API elsewhere (see worker.js).
  workerUrl: location.origin
};

const api = (sub, path) => `https://${sub}.${CONFIG.apiDomain}${path}`;
const getJSON = async url => { const r = await fetch(url); if(!r.ok) throw new Error(r.status); return r.json(); };
const nf = new Intl.NumberFormat('en-US');
const esc = t => String(t ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function fmt(n){
  if(n>=1e9) return (n/1e9).toFixed(1).replace(/\.0$/,'')+'B+';
  if(n>=1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'')+'M+';
  if(n>=1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'')+'K+';
  return Math.round(n)+'+';
}
async function toUniverse(id){
  if(CONFIG.idType === 'universe') return { universeId: String(id), placeId: null };
  try{
    const r = await getJSON(api('apis', `/universes/v1/places/${id}/universe`));
    return { universeId: String(r.universeId), placeId: String(id) };
  }catch(e){ return { universeId: String(id), placeId: null }; }
}
async function fetchGames(){
  const ids = await Promise.all(CONFIG.games.map(toUniverse));
  const list = ids.map(i=>i.universeId).join(',');
  const [info, icons] = await Promise.all([
    getJSON(api('games', `/v1/games?universeIds=${list}`)),
    getJSON(api('thumbnails', `/v1/games/icons?universeIds=${list}&returnPolicy=PlaceHolder&size=256x256&format=Png&isCircular=false`)).catch(()=>({data:[]}))
  ]);
  return info.data.map((g,i) => ({
    ...g, inputId: CONFIG.games[i], name: CONFIG.names?.[CONFIG.games[i]] || g.name,
    icon: (icons.data.find(x=>x.targetId===g.id)||{}).imageUrl
  }));
}
