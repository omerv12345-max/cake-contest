// Cake contest API. Runs as a Netlify Function and stores data in Netlify Blobs.
// Every browser holds a secret token; the public id is a hash of it, so nobody can act as someone else.
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const MAX_PEOPLE = 500;
const CATS = ["taste", "looks", "creativity"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const clean = (s, max) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max);

export default async (req) => {
  const store = getStore({ name: "cake-contest", consistency: "strong" });
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const token = req.headers.get("x-token") || "";
  const me = /^[A-Za-z0-9_-]{22,64}$/.test(token)
    ? createHash("sha256").update(token).digest("hex").slice(0, 24)
    : null;

  async function readAll(prefix) {
    const { blobs } = await store.list({ prefix });
    const out = {};
    await Promise.all(
      blobs.map(async (b) => {
        const v = await store.get(b.key, { type: "json" });
        if (v) out[b.key.slice(prefix.length)] = v;
      })
    );
    return out;
  }

  try {
    if (route === "state" && req.method === "GET") {
      const [people, cakes, ratings] = await Promise.all([
        readAll("people/"),
        readAll("cakes/"),
        readAll("ratings/"),
      ]);
      return json({ me, people, cakes, ratings });
    }

    if (req.method !== "POST" && req.method !== "DELETE") return json({ error: "method" }, 405);
    if (!me) return json({ error: "no_token" }, 401);

    if (route === "register" && req.method === "POST") {
      const body = await req.json();
      const name = clean(body.name, 30);
      if (!name) return json({ error: "name_required" }, 400);
      const existing = await store.get("people/" + me, { type: "json" });
      if (!existing) {
        const { blobs } = await store.list({ prefix: "people/" });
        if (blobs.length >= MAX_PEOPLE) return json({ error: "full" }, 429);
      }
      await store.setJSON("people/" + me, { name });
      return json({ ok: true });
    }

    const registered = await store.get("people/" + me, { type: "json" });
    if (!registered) return json({ error: "not_registered" }, 403);

    if (route === "cake" && req.method === "POST") {
      const body = await req.json();
      const title = clean(body.title, 60);
      if (!title) return json({ error: "title_required" }, 400);
      await store.setJSON("cakes/" + me, { title, desc: clean(body.desc, 140) });
      return json({ ok: true });
    }

    if (route === "cake" && req.method === "DELETE") {
      await store.delete("cakes/" + me);
      return json({ ok: true });
    }

    if (route === "rate" && req.method === "POST") {
      const body = await req.json();
      const input = body && typeof body.scores === "object" && body.scores ? body.scores : {};
      const scores = {};
      for (const cakeId of Object.keys(input).slice(0, 300)) {
        if (!/^[a-f0-9]{24}$/.test(cakeId) || cakeId === me) continue;
        const row = {};
        for (const cat of CATS) {
          const v = input[cakeId] && input[cakeId][cat];
          if (Number.isInteger(v) && v >= 1 && v <= 5) row[cat] = v;
        }
        if (Object.keys(row).length) scores[cakeId] = row;
      }
      await store.setJSON("ratings/" + me, { scores });
      return json({ ok: true });
    }

    return json({ error: "not_found" }, 404);
  } catch (e) {
    return json({ error: "server_error" }, 500);
  }
};

export const config = { path: "/api/*" };
