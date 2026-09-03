/**
 * Deterministic ForceAtlas2-style spatialization — no external layout
 * package (M10.4: no new dependencies). Nodes repel each other, edges
 * pull their endpoints together, and a mild gravity term keeps
 * low-degree/disconnected nodes from drifting away — the same forces
 * ForceAtlas2 combines, scaled by each node's "mass" (1 + degree) so
 * hubs behave like hubs. Positions are seeded from each node's own id
 * (never from array order or `Math.random`), so the same snapshot
 * produces the same layout on every load, computed once and handed to
 * sigma as static coordinates — never recomputed per frame.
 */

export interface LayoutNode {
  id: string;
  degree: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface Point {
  x: number;
  y: number;
}

const ITERATIONS = 200;
// Tuned so the resulting inter-node spacing (k) comfortably exceeds the
// canvas's largest node radius (~18 graph units, see graph-view.tsx) —
// otherwise a force-directed layout for a dense graph converges into an
// unreadable overlapping blob rather than a legibly spread-out one.
const AREA = 400000;

/** FNV-1a string hash, folded into [0, 1). Deterministic per id, independent of array position. */
function hashUnit(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** mulberry32 — a small, fast, deterministic PRNG seeded per node id. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeLayout(nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, Point> {
  const positions = new Map<string, Point>();
  if (nodes.length === 0) return positions;

  const mass = new Map<string, number>();
  for (const node of nodes) mass.set(node.id, 1 + node.degree);

  const k = Math.sqrt(AREA / Math.max(1, nodes.length));
  for (const node of nodes) {
    const rng = mulberry32(Math.floor(hashUnit(node.id) * 4294967295));
    const angle = rng() * 2 * Math.PI;
    const radius = k * Math.sqrt(nodes.length) * (0.3 + 0.7 * rng());
    positions.set(node.id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  }

  const ids = nodes.map((n) => n.id);
  const edgeList = edges.filter(
    (e) => positions.has(e.source) && positions.has(e.target) && e.source !== e.target,
  );

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const disp = new Map<string, Point>();
    for (const id of ids) disp.set(id, { x: 0, y: 0 });

    // Repulsion — every pair, scaled by mass (like FA2's node "repulsion").
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i]!;
      const pa = positions.get(a)!;
      for (let j = i + 1; j < ids.length; j++) {
        const b = ids[j]!;
        const pb = positions.get(b)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 < 1e-4) {
          dx = 0.01;
          dy = 0.01;
          dist2 = 2e-4;
        }
        const dist = Math.sqrt(dist2);
        const force = (k * k * mass.get(a)! * mass.get(b)!) / dist2;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const da = disp.get(a)!;
        da.x += fx;
        da.y += fy;
        const db = disp.get(b)!;
        db.x -= fx;
        db.y -= fy;
      }
    }

    // Attraction — spring force along real edges only. Scaled down from
    // the textbook Fruchterman-Reingold `dist^2/k`: with ~196 edges over
    // only 68 nodes (avg degree ~5.8), unscaled attraction compounds
    // across every node's several simultaneous edges and overwhelms
    // repulsion, collapsing the whole layout into a dense, unreadable
    // core regardless of how large `k`/AREA is set.
    const ATTRACTION_SCALE = 0.22;
    for (const e of edgeList) {
      const pa = positions.get(e.source)!;
      const pb = positions.get(e.target)!;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      const force = ATTRACTION_SCALE * ((dist * dist) / k);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const da = disp.get(e.source)!;
      da.x -= fx;
      da.y -= fy;
      const db = disp.get(e.target)!;
      db.x += fx;
      db.y += fy;
    }

    // Gravity — a constant-magnitude pull toward the origin (scaled only
    // by mass, never by distance, matching FA2's default — not "strong"
    // — gravity mode), so low-degree/disconnected nodes settle near the
    // graph instead of drifting away, without growing large enough at
    // scale to out-pull repulsion and collapse the whole layout back
    // into a tight ball.
    const GRAVITY = 12;
    for (const id of ids) {
      const p = positions.get(id)!;
      const m = mass.get(id)!;
      const d = disp.get(id)!;
      const distFromCenter = Math.max(0.01, Math.sqrt(p.x * p.x + p.y * p.y));
      d.x -= (p.x / distFromCenter) * GRAVITY * m;
      d.y -= (p.y / distFromCenter) * GRAVITY * m;
    }

    // Linear cooling schedule for deterministic convergence.
    const temperature = k * (1 - iter / ITERATIONS);
    for (const id of ids) {
      const p = positions.get(id)!;
      const d = disp.get(id)!;
      const dlen = Math.max(0.01, Math.sqrt(d.x * d.x + d.y * d.y));
      const limited = Math.min(dlen, temperature);
      p.x += (d.x / dlen) * limited;
      p.y += (d.y / dlen) * limited;
    }
  }

  return positions;
}
