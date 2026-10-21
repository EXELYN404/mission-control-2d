/**
 * Proxy API untuk Vercel.
 *
 * Frontend di Vercel (static) memanggil `/api/*`. Backend Python berada di
 * platform lain (Railway). File ini meneruskan semua request `/api/*` ke
 * backend, sekaligus menyalin status, header, dan body-nya.
 *
 * Catch-all: api/[...path].js menangkap /api/dashboard, /api/agents/<id>,
 * /api/office/brain, dll.
 */

const BACKEND = process.env.BACKEND_URL ||
  "https://mission-control-2d-production.up.railway.app";

export default async function handler(req, res) {
  const segments = req.query.path;
  const path = Array.isArray(segments) ? segments.join("/") : (segments || "");
  const target = `${BACKEND}/api/${path}`;

  // Body: Vercel sudah meng-parse JSON, jadi serialkan ulang.
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
  const body = hasBody ? JSON.stringify(req.body || {}) : undefined;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      body,
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "application/json"
    );
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(text);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: "Backend tidak terjangkau: " + String(err && err.message ? err.message : err),
    });
  }
}
