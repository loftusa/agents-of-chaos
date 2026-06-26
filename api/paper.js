// api/paper.js — thin Semantic Scholar proxy, deployed by Vercel as a serverless
// function at /api/paper (root `api/` dir → zero-config Function, no Astro adapter, so
// the rest of the site stays fully static).
//
// It exists for one reason: hold SEMANTIC_SCHOLAR_API_KEY server-side. The key never
// reaches the browser; visitors hit the static papers.json and only *adding* a paper or
// expanding the discovery frontier calls this. It is a pass-through — it returns S2's
// raw JSON and lets the client map it (one toNode, in papers-core.js).
//
// Two request shapes (POST, JSON body):
//   { ids: [...] }                              → /graph/v1/paper/batch  (lookup + embeddings)
//   { positivePaperIds: [...], negativePaperIds? } → /recommendations/v1/papers/  (frontier)
//
// The client falls back to calling S2 directly (anonymous, CORS-enabled) when this
// route is absent (e.g. `astro dev`), so the feature works with or without the proxy.

const S2 = "https://api.semanticscholar.org";
// Mirror of papers-core.js BATCH_FIELDS/REC_FIELDS — kept inline on purpose so this
// root Vercel function has zero src/ imports. Keep the two in sync.
const BATCH_FIELDS =
  "title,year,authors,externalIds,citationCount,embedding.specter_v2,references.paperId,abstract,tldr";
const REC_FIELDS = "title,year,authors,externalIds,citationCount"; // rec endpoint rejects the embedding field

async function s2(path, init, key, tries = 4) {
  const headers = { ...(init.headers || {}), ...(key ? { "x-api-key": key } : {}) };
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fetch(S2 + path, { ...init, headers });
    if (last.status !== 429) return last;
    await new Promise((r) => setTimeout(r, 700 * 2 ** i)); // 0.7s, 1.4s, 2.8s, 5.6s
  }
  return last;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY || "";
  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};

  try {
    let r;
    if (Array.isArray(body.ids) && body.ids.length) {
      r = await s2(
        `/graph/v1/paper/batch?fields=${BATCH_FIELDS}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: body.ids.slice(0, 500) }) },
        key,
      );
    } else if (Array.isArray(body.positivePaperIds) && body.positivePaperIds.length) {
      const limit = Math.min(body.limit || 40, 100);
      r = await s2(
        `/recommendations/v1/papers/?fields=${REC_FIELDS}&limit=${limit}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            positivePaperIds: body.positivePaperIds.slice(0, 100),
            negativePaperIds: (body.negativePaperIds || []).slice(0, 100),
          }),
        },
        key,
      );
    } else {
      res.status(400).json({ error: "need ids[] or positivePaperIds[]" });
      return;
    }
    const data = await r.json().catch(() => ({ error: "bad upstream JSON" }));
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
