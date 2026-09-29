// Cloudflare Pages Function -> /api/stats
// Env vars (Pages > Settings > Variables and Secrets):
//   UNIVERSE_ID     (wymagane) - ID universe, NIE place ID
//   ROBLOX_API_KEY  (opcjonalne) - jesli podasz, zostanie dodany do zapytan

export async function onRequest({ env }) {
  const id = env.UNIVERSE_ID;
  if (!id) return txt("Brak UNIVERSE_ID w zmiennych Cloudflare.", 500);

  const headers = {};
  if (env.ROBLOX_API_KEY) headers["x-api-key"] = env.ROBLOX_API_KEY;

  try {
    const [g, v] = await Promise.all([
      fetch(`https://games.roblox.com/v1/games?universeIds=${id}`, { headers }).then((r) => r.json()),
      fetch(`https://games.roblox.com/v1/games/votes?universeIds=${id}`, { headers }).then((r) => r.json()),
    ]);

    const game = g.data && g.data[0];
    const votes = v.data && v.data[0];
    if (!game) return txt("Nie znaleziono gry. Sprawdz UNIVERSE_ID.", 404);

    const up = votes ? votes.upVotes : 0;
    const down = votes ? votes.downVotes : 0;
    const ratio = up + down ? Math.round((up / (up + down)) * 100) : 0;

    const lines = [
      game.name,
      "",
      "Graczy teraz: " + game.playing,
      "Wizyty: " + game.visits,
      "Ulubione: " + game.favoritedCount,
      "Lajki: " + up + " / Dislajki: " + down + " (" + ratio + "% pozytywnych)",
      "Aktualizacja gry: " + (game.updated || "").slice(0, 10),
      "",
      "Dane z: " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    ];
    return txt(lines.join("\n"));
  } catch (e) {
    return txt("Blad pobierania: " + e.message, 502);
  }
}

function txt(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
