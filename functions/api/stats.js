const UNIVERSE_ID = "10529904359";

export async function onRequestGet(context) {

    const apiKey = context.env.ROBLOX_API_KEY;

    if (!apiKey) {
        return Response.json(
            {
                error: "Brak ROBLOX_API_KEY w Cloudflare."
            },
            {
                status: 500
            }
        );
    }


    try {

        /*
         * ==========================================
         * 1. PUBLICZNE STATYSTYKI GRY
         * ==========================================
         */

        const gameResponse = await fetch(
            `https://games.roblox.com/v1/games?universeIds=${UNIVERSE_ID}`
        );


        if (!gameResponse.ok) {

            throw new Error(
                `Roblox Games API: ${gameResponse.status}`
            );

        }


        const gameData =
            await gameResponse.json();


        const game =
            gameData.data?.[0];


        if (!game) {

            throw new Error(
                "Nie znaleziono gry."
            );

        }


        /*
         * ==========================================
         * 2. DATY DO ANALYTICS API
         * ==========================================
         */

        const endDate = new Date();

        const startDate = new Date(
            endDate.getTime() -
            24 * 60 * 60 * 1000
        );


        const startTime =
            startDate.toISOString();

        const endTime =
            endDate.toISOString();


        /*
         * ==========================================
         * FUNKCJA ANALYTICS
         * ==========================================
         */

        async function analytics(metric) {

            const response = await fetch(
                `https://apis.roblox.com/analytics-query-api/v1/universes/${UNIVERSE_ID}/metrics`,
                {
                    method: "POST",

                    headers: {
                        "x-api-key": apiKey,
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify({

                        metric,

                        granularity: "OneDay",

                        startTime,

                        endTime

                    })
                }
            );


            if (!response.ok) {

                const errorText =
                    await response.text();

                throw new Error(
                    `${metric}: ${response.status} ${errorText}`
                );

            }


            const result =
                await response.json();


            /*
             * Roblox może zwrócić gotowy wynik
             * albo operację długoterminową.
             */

            if (
                result.done === false &&
                result.path
            ) {

                const operationPath =
                    result.path;

                for (
                    let i = 0;
                    i < 5;
                    i++
                ) {

                    await new Promise(
                        resolve =>
                            setTimeout(resolve, 500)
                    );


                    const operationResponse =
                        await fetch(
                            `https://apis.roblox.com/analytics-query-api/${operationPath}`,
                            {
                                headers: {
                                    "x-api-key":
                                        apiKey
                                }
                            }
                        );


                    if (!operationResponse.ok) {
                        continue;
                    }


                    const operation =
                        await operationResponse.json();


                    if (operation.done) {
                        return operation.response;
                    }

                }

                return null;
            }


            return result.response;
        }


        /*
         * ==========================================
         * 3. DAU
         * ==========================================
         */

        let dau = null;

        try {

            const response =
                await analytics(
                    "DailyActiveUsers"
                );


            dau =
                response
                    ?.values?.[0]
                    ?.dataPoints?.at(-1)
                    ?.value ?? null;

        } catch (error) {

            console.error(
                "DAU error:",
                error
            );

        }


        /*
         * ==========================================
         * 4. DAILY REVENUE
         * ==========================================
         */

        let dailyRevenue = null;

        try {

            const response =
                await analytics(
                    "DailyRevenue"
                );


            dailyRevenue =
                response
                    ?.values?.[0]
                    ?.dataPoints?.at(-1)
                    ?.value ?? null;

        } catch (error) {

            console.error(
                "Revenue error:",
                error
            );

        }


        /*
         * ==========================================
         * 5. D1 RETENTION
         * ==========================================
         */

        let retention = null;

        try {

            const response =
                await analytics(
                    "ForwardD1Retention"
                );


            retention =
                response
                    ?.values?.[0]
                    ?.dataPoints?.at(-1)
                    ?.value ?? null;

        } catch (error) {

            console.error(
                "Retention error:",
                error
            );

        }


        /*
         * ==========================================
         * 6. OSTATECZNA ODPOWIEDŹ
         * ==========================================
         */

        return Response.json({

            success: true,

            universeId: UNIVERSE_ID,

            gameName:
                game.name ?? null,

            ccu:
                game.playing ?? 0,

            visits:
                game.visits ?? 0,

            maxPlayers:
                game.maxPlayers ?? 0,

            favorites:
                game.favoritedCount ?? 0,

            likes:
                game.upVotes ?? 0,

            dislikes:
                game.downVotes ?? 0,

            dau,

            dailyRevenue,

            retention,

            updated:
                game.updated ?? null

        });

    } catch (error) {

        console.error(error);

        return Response.json(
            {
                success: false,
                error:
                    error.message ||
                    "Nieznany błąd."
            },
            {
                status: 500
            }
        );

    }
}