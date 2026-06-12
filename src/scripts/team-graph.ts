/* Evidence network for /team. Ported from the affiliations graph on
 * alex-loftus.com (loftusa.github.io: assets/js/coauthorship-affiliations.js),
 * keeping its core — force layout, hover tooltips, click-to-pin neighborhood
 * highlight, node drag — and dropping the controls that manage 50-person
 * overload (mode toggle, filters, reach slider, zoom, search, self-service
 * editing). Zoom is replaced by a fit-to-bounds pass after the layout settles.
 *
 * This module owns ALL client behavior on the page, including the bio-card
 * sync: cards are server-rendered from the same ../data/team module with
 * data-person-id hooks. This script must stay in a default processed
 * <script> tag (no is:inline / define:vars — those disable bundled imports). */

import * as d3 from "d3";
import { team, nodes, type GraphNode, type Member, type Tie } from "../data/team";

/* Keep in sync with the legend in TeamGraph.astro and the --org-* tokens in
 * global.css. Red is reserved for the team and its joint work. */
const TYPE: Record<string, { color: string; one: string }> = {
  work: { color: "#a00", one: "joint work" },
  lab: { color: "#7a5230", one: "lab" },
  university: { color: "#8a8475", one: "university" },
  community: { color: "#50796f", one: "community" },
  company: { color: "#6b5a7e", one: "company" },
  program: { color: "#4a6b87", one: "program" },
};
const PERSON_COLOR = "#a00";
const HALO = "#fffff8"; // --bg

type PersonNode = Member & d3.SimulationNodeDatum & { kind: "person" };
type OrgNode = GraphNode & d3.SimulationNodeDatum & { kind: "org"; n: number };
type Link = { source: PersonNode; target: OrgNode; tie: Tie };
type Sel = { kind: "person" | "org"; id: string } | null;

const esc = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function initTeamGraph(): void {
  const graphEl = document.getElementById("graph")!;
  const tooltip = document.getElementById("tooltip")!;
  const detail = document.getElementById("detail")!;
  const cardEls = [...document.querySelectorAll<HTMLElement>("[data-person-id]")];
  const coarse = matchMedia("(pointer: coarse)").matches;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- data: one pass over team.ts, then everything is static ---------- */
  const people: PersonNode[] = team.map((m) => ({ ...m, kind: "person" }));
  const membership = new Map<string, { person: PersonNode; tie: Tie }[]>();
  for (const p of people)
    for (const tie of p.ties) {
      if (!membership.has(tie.node)) membership.set(tie.node, []);
      membership.get(tie.node)!.push({ person: p, tie });
    }
  const orgs: OrgNode[] = nodes
    .filter((n) => (membership.get(n.id) ?? []).length > 0)
    .map((n) => ({ ...n, kind: "org", n: membership.get(n.id)!.length }));

  const personById = new Map(people.map((p) => [p.id, p]));
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const links: Link[] = people.flatMap((p) =>
    p.ties.flatMap((tie) => {
      const target = orgById.get(tie.node);
      return target ? [{ source: p, target, tie }] : [];
    }),
  );
  const orgFont = d3.scaleSqrt()
    .domain([1, d3.max(orgs, (o) => o.n) ?? 1])
    .range([11.5, 17]);

  /* ---------- svg scaffold (fixed viewBox; CSS scales it on resize) ---------- */
  const W = graphEl.clientWidth, H = graphEl.clientHeight;
  const svg = d3.select(graphEl).append("svg").attr("viewBox", `0 0 ${W} ${H}`);
  const root = svg.append("g");
  const linkG = root.append("g");
  const orgG = root.append("g");
  const peopleG = root.append("g");
  svg.on("click", () => select(null));

  /* Deterministic seeding: joint work center, people inner ring, rooms outer.
   * Same layout every load — no Math.random scatter. */
  const cx = W / 2, cy = H / 2, R = Math.min(W, H);
  const works = orgs.filter((o) => o.type === "work");
  const rooms = orgs.filter((o) => o.type !== "work");
  works.forEach((o, i) => { o.x = cx + (i - (works.length - 1) / 2) * 110; o.y = cy; });
  people.forEach((p, i) => {
    const a = (2 * Math.PI * i) / people.length - Math.PI / 2;
    p.x = cx + Math.cos(a) * R * 0.28;
    p.y = cy + Math.sin(a) * R * 0.28;
  });
  rooms.forEach((o, i) => {
    const a = (2 * Math.PI * (i + 0.5)) / Math.max(rooms.length, 1) - Math.PI / 2;
    o.x = cx + Math.cos(a) * R * 0.43;
    o.y = cy + Math.sin(a) * R * 0.43;
  });

  const sim = d3.forceSimulation<PersonNode | OrgNode>([...people, ...orgs])
    .force("charge", d3.forceManyBody().strength(-220))
    .force("x", d3.forceX(cx).strength(0.05))
    .force("y", d3.forceY(cy).strength(0.06))
    .force("link", d3.forceLink<PersonNode | OrgNode, Link>(links)
      .distance((l) => 38 + 4 * Math.sqrt(l.target.n || 1))
      .strength(0.4))
    .force("collide", d3.forceCollide<PersonNode | OrgNode>().radius((d) =>
      d.kind === "org" ? orgFont(d.n) * (d.label.length * 0.27) : 26))
    .on("tick", tick);

  /* ---------- build the DOM once; ticks only move it ---------- */
  const linkSel = linkG.selectAll("line").data(links).join("line")
    .attr("stroke", "#d9d4c2")
    .attr("stroke-width", 1)
    .attr("stroke-opacity", 0.75);

  const orgSel = orgG.selectAll("text").data(orgs).join("text")
    .attr("class", (o) => "olabel" + (o.type === "work" ? " work" : ""))
    .attr("fill", (o) => TYPE[o.type].color)
    .style("font-size", (o) => orgFont(o.n) + "px")
    .text((o) => o.label)
    .on("click", (ev: MouseEvent, o) => { ev.stopPropagation(); select({ kind: "org", id: o.id }); });

  const peopleSel = peopleG.selectAll<SVGGElement, PersonNode>("g.p").data(people).join("g")
    .attr("class", "p")
    .style("cursor", "pointer");
  peopleSel.append("circle").attr("r", 8.5)
    .attr("fill", PERSON_COLOR)
    .attr("stroke", HALO).attr("stroke-width", 1.5);
  peopleSel.append("text").attr("class", "plabel").attr("y", 21).text((p) => p.name);
  peopleSel.on("click", (ev: MouseEvent, p) => {
    ev.stopPropagation();
    select({ kind: "person", id: p.id }, { scrollCard: true });
  });

  let dragging = false;
  if (!coarse) {
    orgSel.on("mousemove", orgTip).on("mouseleave", leaveNode);
    peopleSel.on("mousemove", personTip).on("mouseleave", leaveNode);
    peopleSel.call(d3.drag<SVGGElement, PersonNode>()
      .on("start", (ev, d) => { dragging = true; sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on("end", (ev, d) => { dragging = false; sim.alphaTarget(0); d.fx = d.fy = null; }));
  }

  let tickCount = 0;
  function tick() {
    linkSel
      .attr("x1", (l) => l.source.x!).attr("y1", (l) => l.source.y!)
      .attr("x2", (l) => l.target.x!).attr("y2", (l) => l.target.y!);
    orgSel.attr("x", (o) => o.x!).attr("y", (o) => o.y!);
    peopleSel.attr("transform", (p) => `translate(${p.x},${p.y})`);
    // keep everything reachable while the layout is still moving — on small
    // screens the early charge explosion otherwise pushes nodes off-frame
    // (paused during drag: a moving root transform would warp the cursor math)
    if (++tickCount % 20 === 0 && !dragging) fitToBounds(false);
  }

  /* Replaces the original's d3.zoom: after the sim cools, scale the whole
   * group so nothing clips. Re-runs after drags settle, so a node dragged
   * off-canvas pulls the view out to include it. */
  function fitToBounds(animate: boolean) {
    const b = (root.node() as SVGGElement).getBBox();
    if (!b.width || !b.height) return;
    const pad = 30;
    const k = Math.min((W - 2 * pad) / b.width, (H - 2 * pad) / b.height, 1.35);
    const tx = (W - b.width * k) / 2 - b.x * k;
    const ty = (H - b.height * k) / 2 - b.y * k;
    const t = `translate(${tx},${ty}) scale(${k})`;
    if (animate) root.transition().duration(450).attr("transform", t);
    else root.attr("transform", t);
  }
  if (calm) {
    sim.stop();
    sim.tick(300);
    tick();
    fitToBounds(false);
  } else {
    sim.on("end", () => fitToBounds(true));
  }

  /* ---------- selection, highlight, card sync ---------- */
  let selected: Sel = null;
  let hover: Sel = null; // transient preview; never touches detail/hash

  function neighborhood(sel: Sel) {
    if (!sel) return null;
    const ppl = new Set<string>(), org = new Set<string>();
    if (sel.kind === "person") {
      ppl.add(sel.id);
      for (const t of personById.get(sel.id)?.ties ?? []) org.add(t.node);
    } else {
      org.add(sel.id);
      for (const { person } of membership.get(sel.id) ?? []) ppl.add(person.id);
    }
    return { ppl, org };
  }

  function applyHighlight() {
    const nb = neighborhood(hover ?? selected);
    const dim = (on: boolean) => (on ? 1 : 0.13);
    peopleSel.attr("opacity", (p) => (!nb ? 1 : dim(nb.ppl.has(p.id))));
    orgSel.attr("opacity", (o) => (!nb ? 1 : dim(nb.org.has(o.id))));
    linkSel.attr("stroke-opacity", (l) =>
      !nb ? 0.75 : nb.ppl.has(l.source.id) && nb.org.has(l.target.id) ? 0.95 : 0.05);
    for (const el of cardEls)
      el.classList.toggle("sel", !!nb && nb.ppl.has(el.dataset.personId!));
  }

  function select(sel: Sel, opts: { scrollCard?: boolean } = {}) {
    selected = sel;
    hover = null;
    renderDetail();
    applyHighlight();
    if (sel && sel.kind === "person") {
      location.hash = "p=" + encodeURIComponent(sel.id);
      if (opts.scrollCard)
        cardEls.find((el) => el.dataset.personId === sel.id)
          ?.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" });
    } else if (location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  /* ---------- detail panel: the audit surface — every row links its source ---------- */
  function renderDetail() {
    if (!selected) { detail.innerHTML = ""; return; }
    if (selected.kind === "person") {
      const p = personById.get(selected.id)!;
      const rows = p.ties.map((t) => {
        const o = orgById.get(t.node);
        if (!o) return "";
        const meta = [t.role, t.years].filter(Boolean).join(" · ");
        return `<div class="d-row"><span class="swatch" style="background:${TYPE[o.type].color}"></span>
          <div><span class="d-org">${esc(o.label)}</span>
          ${meta ? `<div class="d-meta">${esc(meta)}</div>` : ""}
          <div class="d-src">${t.source.startsWith("http")
            ? `<a href="${esc(t.source)}" target="_blank" rel="noopener">source</a>`
            : esc(t.source)}</div></div></div>`;
      });
      detail.innerHTML = `<span class="d-clear" title="clear">✕</span>
        <div class="d-title">${esc(p.name)}</div>
        <div class="d-sub">${esc(p.role)}</div>${rows.join("")}`;
    } else {
      const o = orgById.get(selected.id)!;
      const rows = (membership.get(o.id) ?? []).map(({ person, tie }) => {
        const meta = [tie.role, tie.years].filter(Boolean).join(" · ");
        return `<div class="d-row d-member" data-person="${esc(person.id)}">
          <span class="swatch" style="background:${PERSON_COLOR}"></span>
          <div><span class="d-org">${esc(person.name)}</span>
          ${meta ? `<div class="d-meta">${esc(meta)}</div>` : ""}</div></div>`;
      });
      const n = o.n;
      detail.innerHTML = `<span class="d-clear" title="clear">✕</span>
        <div class="d-title" style="color:${TYPE[o.type].color}">${esc(o.full ?? o.label)}</div>
        <div class="d-sub">${TYPE[o.type].one} · ${n} ${n === 1 ? "person" : "people"}${
          o.note ? ` · ${esc(o.note)}` : ""}</div>${rows.join("")}
        ${o.href ? `<div class="d-src" style="margin-top:4px"><a href="${esc(o.href)}"
          target="_blank" rel="noopener">→ ${esc(o.href.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a></div>` : ""}`;
      detail.querySelectorAll<HTMLElement>(".d-member").forEach((el) =>
        el.addEventListener("click", () => select({ kind: "person", id: el.dataset.person! })));
    }
    detail.querySelector(".d-clear")!.addEventListener("click", () => select(null));
  }

  /* ---------- tooltips (fine pointers; everything here is also in detail/cards) ---------- */
  function showTip(ev: MouseEvent, html: string) {
    tooltip.innerHTML = html;
    tooltip.style.opacity = "1";
    const pad = 14, w = tooltip.offsetWidth, h = tooltip.offsetHeight;
    tooltip.style.left = Math.min(ev.clientX + pad, innerWidth - w - 8) + "px";
    tooltip.style.top = Math.min(ev.clientY + pad, innerHeight - h - 8) + "px";
  }
  const hideTip = () => { tooltip.style.opacity = "0"; };
  function leaveNode() {
    hideTip();
    if (hover) { hover = null; applyHighlight(); }
  }
  function personTip(ev: MouseEvent, p: PersonNode) {
    if (!hover || hover.id !== p.id) { hover = { kind: "person", id: p.id }; applyHighlight(); }
    const items = p.ties.map((t) => {
      const o = orgById.get(t.node);
      return o ? `<li><span style="color:${TYPE[o.type].color}">●</span> ${esc(o.label)}${
        t.years ? ` <span class="t-dim">${esc(t.years)}</span>` : ""}</li>` : "";
    });
    showTip(ev, `<div class="t-name">${esc(p.name)}</div>
      <div class="t-sub">${esc(p.role)}</div><ul class="t-list">${items.join("")}</ul>`);
  }
  function orgTip(ev: MouseEvent, o: OrgNode) {
    if (!hover || hover.id !== o.id) { hover = { kind: "org", id: o.id }; applyHighlight(); }
    const ms = (membership.get(o.id) ?? []).map(({ person }) => esc(person.name));
    showTip(ev, `<div class="t-name" style="color:${TYPE[o.type].color}">${esc(o.full ?? o.label)}</div>
      <div class="t-sub">${TYPE[o.type].one} · ${o.n} ${o.n === 1 ? "person" : "people"}</div>
      <ul class="t-list"><li>${ms.join("</li><li>")}</li></ul>`);
  }

  /* ---------- cards drive the graph too ---------- */
  for (const el of cardEls) {
    const id = el.dataset.personId!;
    el.addEventListener("click", () => select({ kind: "person", id }));
    if (!coarse) {
      el.addEventListener("mouseenter", () => { hover = { kind: "person", id }; applyHighlight(); });
      el.addEventListener("mouseleave", () => { hover = null; applyHighlight(); });
    }
  }

  window.addEventListener("keydown", (ev) => { if (ev.key === "Escape") select(null); });

  /* ---------- #p= deep links ---------- */
  function selectFromHash() {
    const m = location.hash.match(/^#p=(.+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (personById.has(id)) select({ kind: "person", id }, { scrollCard: true });
    }
  }
  selectFromHash();
  window.addEventListener("hashchange", selectFromHash);
}
