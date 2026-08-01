/**
 * SQ003 debug workspace — Cloudflare Worker.
 * Serves the static site (assets binding) + a tiny JSON API backed by KV:
 *   POST /api/submit   {kind, from, payload}  -> stored as KV entry
 *   GET  /api/list                            -> recent submission keys
 *   GET  /api/get?key=...                     -> one submission body
 * Same pattern as antora-factory2-gis (Workers Builds Git integration).
 */
const MAX_BYTES = 5 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return api(request, env, url).catch(
        (e) => json({ ok: false, error: String(e) }, 500));
    }
    const res = await env.ASSETS.fetch(request);
    // HTML pages must never be edge-cached: the CF edge served stale HITs
    // after deploys (owner saw old builds; verified 2026-07-31). Images are
    // inlined in the pages, so no-store costs little and guarantees fresh.
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/html")) {
      const r2 = new Response(res.body, res);
      r2.headers.set("cache-control", "no-store");
      return r2;
    }
    return res;
  },
};

async function api(request, env, url) {
  if (url.pathname === "/api/submit" && request.method === "POST") {
    const raw = await request.text();
    if (!raw || raw.length > MAX_BYTES)
      return json({ ok: false, error: "empty or oversized body" }, 413);
    let body;
    try { body = JSON.parse(raw); }
    catch { return json({ ok: false, error: "not JSON" }, 400); }
    const kind = String(body.kind || "unknown").slice(0, 40)
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const from = String(body.from || "anonymous").slice(0, 80)
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `${stamp}_${kind}_${from}`;
    await env.INBOX.put(key, raw);
    return json({ ok: true, stored: key });
  }
  if (url.pathname === "/api/list") {
    const list = await env.INBOX.list({ limit: 100 });
    return json({ ok: true,
                  keys: list.keys.map(k => k.name).sort().reverse() });
  }
  if (url.pathname === "/api/get") {
    const key = url.searchParams.get("key") || "";
    const val = await env.INBOX.get(key);
    return val === null
      ? json({ ok: false, error: "not found" }, 404)
      : new Response(val, { headers: { "content-type": "application/json" } });
  }
  return json({ ok: false, error: "unknown route" }, 404);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json" },
  });
}
