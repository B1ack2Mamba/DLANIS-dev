import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Прокси для картинок с IPFS, чтобы обходить CORP/CORS.
 * Использование: /api/ipfs-proxy?src=<полный-URL>
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const src = req.query.src as string | undefined;
    if (!src) {
        res.status(400).send("Missing ?src");
        return;
    }

    try {
        const upstream = await fetch(src, { cache: "no-store" });

        if (!upstream.ok || !upstream.body) {
            res.status(upstream.status || 502).send(`Upstream error: ${upstream.statusText}`);
            return;
        }

        // Пробуем сохранить правильный content-type
        const ct = upstream.headers.get("content-type") || "image/jpeg";

        // Заголовки, дружелюбные к браузеру
        res.setHeader("Content-Type", ct);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

        // Стримим тело без буфера
        const reader = upstream.body.getReader();
        const encoder = new TextEncoder();

        // @ts-ignore — у Next есть res.write/res.end
        res.writeHead(200);

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // @ts-ignore
            res.write(value);
        }
        // @ts-ignore
        res.end();
    } catch (e: any) {
        res.status(502).send(`Proxy error: ${e?.message || e}`);
    }
}
