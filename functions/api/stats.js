// Cloudflare Pages Function -> /api/stats  (zwraca zwykly tekst)
// Zmienne w Cloudflare: UNIVERSE_ID, ROBLOX_API_KEY (secret)
// Klucz musi miec uprawnienie universe.analytics:read dla Twojej gry.

const DAY = 86400000;
const BASE = "https://apis.roblox.com/analytics-query-api/";

export async function onRequest({ env }) {
  const id = env.UNIVERSE_ID;
  const key = env.ROBLOX_API_KEY;
  if (!id) return txt("Brak UNIVERSE_ID w zmiennych Cloudflare.", 500);
  if (!key) return txt("Brak ROBLOX_API_KEY w zmiennych Cloudflare.", 500);

  const end = new Date();
  end.setUTCHours(24, 0, 0, 0); // do konca dzisiejszego dnia UTC
  const start = new Date(end.getTime() - 8 * DAY);

  const q = (metric, breakdown) => query(id, key, metric, start, end, breakdown);

  const [dau, dauNew, play, d1, d7, rev, game, votes] = await Promise.all([
    q("DailyActiveUsers"),
    q("DailyActiveUsers", ["IsNewUser"]),
    q("AveragePlayTimeMinutesPerDAU"),
    q("ForwardD1Retention"),
    q("ForwardD7Retention"),
    q("DailyRevenue"),
    pub(`https://games.roblox.com/v1/games?universeIds=${id}`),
    pub(`https://games.roblox.com/v1/games/votes?universeIds=${id}`),
  ]);

  const g = game && game.data && game.data[0];
  const v = votes && votes.data && votes.data[0];
  const L = [];

  if (g) {
    L.push(g.name, "");
    L.push("CCU: " + g.playing);
  } else {
    L.push("CCU: brak danych");
  }

  L.push(line("DAU", dau, 0));
  L.push(newLine(dauNew));
  L.push(line("Playtime", play, 1, " min"));
  L.push(line("D1", d1, 2, "%", true));
  L.push(line("D7", d7, 2, "%", true));
  L.push(line("Revenue", rev, 0, " R$"));

  if (g) {
    L.push("", "Wizyty: " + g.visits);
    L.push("Ulubione: " + g.favoritedCount);
  }
  if (v) {
    const t = v.upVotes + v.downVotes;
    L.push("Lajki: " + v.upVotes + " / " + v.downVotes + (t ? " (" + Math.round((v.upVotes / t) * 100) + "%)" : ""));
  }
  L.push("", "Odswiezono: " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC");
  return txt(L.join("\n"));
}

async function query(id, key, metric, start, end, breakdown) {
  const body = { metric, granularity: "OneDay", startTime: start.toISOString(), endTime: end.toISOString() };
  if (breakdown) body.breakdown = breakdown;
  const headers = { "x-api-key": key, "Content-Type": "application/json" };
  try {
    let r = await fetch(`${BASE}v1/universes/${id}/metrics`, { method: "POST", headers, body: JSON.stringify(body) });
    if (r.status === 401) return { error: "401 - sprawdz uprawnienia klucza" };
    let j = await r.json();
    for (let i = 0; i < 5 && !j.done; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      r = await fetch(BASE + j.path, { headers });
      j = await r.json();
    }
    if (j.error) return { error: j.error.message };
    if (!j.done) return { error: "timeout" };
    return { values: (j.response && j.response.values) || [] };
  } catch (e) {
    return { error: e.message };
  }
}

async function pub(url) {
  try { return await (await fetch(url)).json(); } catch (e) { return null; }
}

function points(res, pick) {
  if (!res || !res.values) return [];
  const s = pick ? res.values.find(pick) : res.values[0];
  return s ? s.dataPoints.filter((p) => p.value != null) : [];
}

function fmt(n, d) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function line(name, res, d, unit = "", pct = false) {
  if (res && res.error) return name + ": brak (" + res.error + ")";
  let p = points(res);
  if (!p.length) return name + ": brak danych";
  let vals = p.map((x) => x.value);
  if (pct && vals.every((x) => x <= 1)) vals = vals.map((x) => x * 100);
  const last = vals[vals.length - 1];
  const day = p[p.length - 1].time.slice(5, 10);
  const last7 = vals.slice(-7);
  const avg = last7.reduce((a, b) => a + b, 0) / last7.length;
  return name + ": " + fmt(last, d) + unit + " (" + day + ")  |  7d sr.: " + fmt(avg, d) + unit;
}

function newLine(res) {
  if (res && res.error) return "Nowi gracze: brak (" + res.error + ")";
  const p = points(res, (s) => {
    const b = s.breakdowns && s.breakdowns[0];
    return b && ["true", "1", "yes"].includes(String(b.value).toLowerCase());
  });
  if (!p.length) return "Nowi gracze: brak danych";
  const last = p[p.length - 1];
  return "Nowi gracze: " + fmt(last.value, 0) + " (" + last.time.slice(5, 10) + ")";
}

function txt(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=120" },
  });
}
