// worker.js
export default {
  async fetch(req) {
    const u = new URL(req.url);
    const orig = u.searchParams.get("url");
    if (!orig) return new Response("Passe ?url=", { status: 400 });
    const r = await fetch(orig, { headers: { "Accept": "text/html" } });
    const buf = await r.arrayBuffer();
    const h = new Headers(r.headers);
    h.set("Access-Control-Allow-Origin", "*");
    h.set("Access-Control-Expose-Headers", "*");
    return new Response(buf, { status: r.status, headers: h });
  }
};
