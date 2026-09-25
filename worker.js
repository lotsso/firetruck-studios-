const ACCESS_CODE = "200192";

const MAX_ATTEMPTS = 5;
const LOCK_TIME = 5 * 60 * 1000;

const attempts = new Map();

export default {
    async fetch(request) {

        const url = new URL(request.url);

        if (url.pathname !== "/api/login") {
            return new Response("Not Found", {
                status: 404
            });
        }

        if (request.method !== "POST") {
            return Response.json(
                {
                    success: false,
                    message: "Method not allowed."
                },
                {
                    status: 405
                }
            );
        }

        let body;

        try {
            body = await request.json();
        } catch {
            return Response.json({
                success: false,
                message: "Nieprawidłowe żądanie."
            }, {
                status: 400
            });
        }

        const code = String(body.code || "");

        /*
         * Identyfikator klienta.
         * Cloudflare przekazuje prawdziwy adres IP
         * w nagłówku CF-Connecting-IP.
         */
        const ip =
            request.headers.get("CF-Connecting-IP") ||
            "unknown";

        const now = Date.now();

        let data = attempts.get(ip);

        if (!data) {
            data = {
                count: 0,
                lockedUntil: 0
            };
        }

        if (data.lockedUntil > now) {

            const seconds =
                Math.ceil(
                    (data.lockedUntil - now) / 1000
                );

            return Response.json({
                success: false,
                message:
                    `Za dużo prób. Spróbuj ponownie za ${seconds} sekund.`
            }, {
                status: 429
            });
        }

        if (code === ACCESS_CODE) {

            attempts.delete(ip);

            return Response.json({
                success: true
            });
        }

        data.count++;

        if (data.count >= MAX_ATTEMPTS) {

            data.count = 0;
            data.lockedUntil = now + LOCK_TIME;

            attempts.set(ip, data);

            return Response.json({
                success: false,
                message:
                    "Za dużo błędnych prób. Dostęp zablokowany na 5 minut."
            }, {
                status: 429
            });
        }

        attempts.set(ip, data);

        return Response.json({
            success: false,
            message:
                `Nieprawidłowy kod. Pozostało prób: ${MAX_ATTEMPTS - data.count}.`
        }, {
            status: 401
        });
    }
};