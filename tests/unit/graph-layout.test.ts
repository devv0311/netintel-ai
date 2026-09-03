import { describe, expect, it } from "vitest";

import { computeLayout } from "@/lib/graph/layout";

const nodes = [
  { id: "a", degree: 3 },
  { id: "b", degree: 1 },
  { id: "c", degree: 2 },
  { id: "d", degree: 0 },
];
const edges = [
  { source: "a", target: "b" },
  { source: "a", target: "c" },
  { source: "c", target: "d" },
];

describe("computeLayout", () => {
  it("is deterministic across repeated calls with identical input", () => {
    const first = computeLayout(nodes, edges);
    const second = computeLayout(nodes, edges);
    for (const n of nodes) {
      expect(second.get(n.id)).toEqual(first.get(n.id));
    }
  });

  it("places every node at a finite, distinct position", () => {
    const positions = computeLayout(nodes, edges);
    expect(positions.size).toBe(nodes.length);
    const seen = new Set<string>();
    for (const n of nodes) {
      const p = positions.get(n.id)!;
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      const key = `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("returns an empty map for an empty node list", () => {
    expect(computeLayout([], []).size).toBe(0);
  });

  it("pulls directly connected nodes closer than distant, unconnected ones", () => {
    const positions = computeLayout(nodes, edges);
    const dist = (x: string, y: string) => {
      const p1 = positions.get(x)!;
      const p2 = positions.get(y)!;
      return Math.hypot(p1.x - p2.x, p1.y - p2.y);
    };
    // "a"-"b" is a direct edge; "b"-"d" are three hops apart with no edge.
    expect(dist("a", "b")).toBeLessThan(dist("b", "d"));
  });
});
