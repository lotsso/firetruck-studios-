const UNIVERSE_ID = "10529904359";

function sanitizeKey(raw) {
    if (!raw) return "";
    return raw
        .normalize("NFKC")
        .replace(/[\s\u200B\u200C\u200D\u200E\u200F\uFEFF]/g, "");
}

async function fetchLatestMetric(universeId, apiKey, metric) {
    const now = new Date();
    const endTime = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const startTime = new Date(endTime);
    startTime.setUTCDate(startTime.getUTCDate() - 9);

    const res = await fetch(
        `https://apis.roblox.com/analytics-query-api/v1/universes/${universeId}/metrics`,
        {
            method: "POST",
            headers: {
                "x-api-key": apiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                metric,
                granularity: "OneDay",
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString()
            })
        }
    );

    if (!res.ok) {
        const text = await res.text();
        console.error(`Analytics API (${metric}) error ${res.status}:`, text);
        return { value: null, error: `${res.status}: ${text}`, pointsCount: 0 };
    }

    const json = await res.json();
    const points = json?.response?.values?.[0]?.dataPoints || [];
    if (points.length > 0) {
        const latest = points[points.length - 1];
        return { value: latest.value, error: null, pointsCount: points.length, latestDate: latest.time };
    }
    return { value: null, error: null, pointsCount: 0 };
}

export async function onRequestGet(context) {
    const apiKey = sanitizeKey(context.env.ROBLOX_API_KEY || "");

    if (!apiKey) {
        return Response.json(
            { success: false, error: "ROBLOX_API_KEY nie jest dostępny w Cloudflare." },
            { status: 500 }
        );
    }

    try {
        const response = await fetch(
            `https://games.roblox.com/v1/games?universeIds=${UNIVERSE_ID}`,
            { headers: { "Accept": "application/json" } }
        );

        if (response.status === 429) {
            return Response.json(
                { success: false, error: "Roblox API ma chwilowy limit zapytań (429). Spróbuj ponownie za chwilę." },
                { status: 429, headers: { "Cache-Control": "no-store" } }
            );
        }
        if (!response.ok) {
            const text = await response.text();
            return Response.json(
                { success: false, error: `Roblox API ${response.status}: ${text}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        const game = data.data?.[0];
        if (!game) {
            return Response.json(
                { success: false, error: "Nie znaleziono doświadczenia Roblox." },
                { status: 404 }
            );
        }

        let dailyRevenue = null;
        let dau = null;
        let analyticsError = null;
        let analyticsDebug = null;

        try {
            const [revenueResult, dauResult] = await Promise.all([
                fetchLatestMetric(UNIVERSE_ID, apiKey, "DailyRevenue"),
                fetchLatestMetric(UNIVERSE_ID, apiKey, "DailyActiveUsers")
            ]);
            dailyRevenue = revenueResult.value;
            dau = dauResult.value;
            analyticsError = revenueResult.error || dauResult.error || null;
            analyticsDebug = {
                revenuePoints: revenueResult.pointsCount,
                revenueLatestDate: revenueResult.latestDate || null,
                dauPoints: dauResult.pointsCount,
                dauLatestDate: dauResult.latestDate || null
            };
        } catch (analyticsErr) {
            console.error("Analytics fetch failed:", analyticsErr);
            analyticsError = analyticsErr.message;
        }

        return Response.json(
            {
                success: true,
                universeId: UNIVERSE_ID,
                gameName: game.name ?? null,
                ccu: game.playing ?? 0,
                dau: dau ?? 0,
                visits: game.visits ?? 0,
                maxPlayers: game.maxPlayers ?? 0,
                favorites: game.favoritedCount ?? 0,
                likes: game.upVotes ?? 0,
                dislikes: game.downVotes ?? 0,
                updated: game.updated ?? null,
                dailyRevenue: dailyRevenue ?? 0,
                analyticsError,
                analyticsDebug
            },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (error) {
        console.error("Roblox API error:", error);
        return Response.json(
            { success: false, error: error.message || "Nieznany błąd." },
            { status: 500 }
        );
    }
}
