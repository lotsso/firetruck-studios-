const UNIVERSE_ID = "10529904359";
export async function onRequestGet(context) {
    const apiKey = context.env.ROBLOX_API_KEY;
    if (!apiKey) {
        return Response.json({
            success: false,
            error: "ROBLOX_API_KEY nie jest dostępny w Cloudflare."
        }, { status: 500 });
    }
    try {
        const response = await fetch(
            `https://games.roblox.com/v1/games?universeIds=${UNIVERSE_ID}`
        );
        const text = await response.text();
        return new Response(text, {
            status: response.status,
            headers: {
                "Content-Type": "application/json"
            }
        });
    } catch (error) {
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}