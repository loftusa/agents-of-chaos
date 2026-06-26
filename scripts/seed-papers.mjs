// scripts/seed-papers.mjs — generate public/papers.json from a handful of seed papers.
// One throttled batch call to Semantic Scholar → node objects (via the shared toNode).
// Run:  node scripts/seed-papers.mjs            (anonymous; the batch endpoint tolerates it)
//       SEMANTIC_SCHOLAR_API_KEY=… node scripts/seed-papers.mjs   (faster / more reliable)
//
// This is the curator's "refresh the canonical graph" path; the in-page "export" button
// produces the same shape from a live-grown graph. Edit SEEDS and re-run to reseed.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toNode, BATCH_FIELDS } from "../src/scripts/papers-core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "public", "papers.json");
const KEY = process.env.SEMANTIC_SCHOLAR_API_KEY || "";

// Themed to the Agents of Chaos lane: multi-agent safety / red-teaming, an
// interpretability anchor, the network-statistics method world this graph is built on,
// and the embedding method behind the relevance metric itself.
const SEEDS = [
  "ARXIV:2312.06942", // AI Control: Improving Safety Despite Intentional Subversion (Redwood)
  "ARXIV:2401.05566", // Sleeper Agents: Training Deceptive LLMs that Persist Through Safety Training (Anthropic)
  "ARXIV:2202.05262", // Locating and Editing Factual Associations in GPT — ROME (Bau lab)
  "ARXIV:1709.05454", // Statistical Inference on Random Dot Product Graphs: a Survey (Priebe/Athreya)
  "ARXIV:2004.07180", // SPECTER: Document-level Representation Learning using Citation-informed Transformers
];

async function batch(ids) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/batch?fields=${BATCH_FIELDS}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(KEY ? { "x-api-key": KEY } : {}) },
        body: JSON.stringify({ ids }),
      },
    );
    if (r.status === 429) {
      const wait = 1000 * 2 ** i;
      console.error(`  429, backing off ${wait}ms…`);
      await new Promise((s) => setTimeout(s, wait));
      continue;
    }
    const d = await r.json();
    if (Array.isArray(d)) return d;
    throw new Error("unexpected response: " + JSON.stringify(d).slice(0, 200));
  }
  throw new Error("rate limited after retries — try again or set SEMANTIC_SCHOLAR_API_KEY");
}

const raw = await batch(SEEDS);
const nodes = raw.map(toNode).filter(Boolean);
const withVec = nodes.filter((n) => n.vec).length;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({ nodes, seededFrom: SEEDS, builtAt: new Date().toISOString() }),
);

console.log(`wrote ${nodes.length} nodes (${withVec} with embeddings) → ${OUT}`);
for (const n of nodes) {
  console.log(`  ${n.year}  ${String(n.refs.length).padStart(3)} refs  vec=${n.vec ? "y" : "n"}  ${n.title.slice(0, 58)}`);
}
