import { describe, expect, it } from "vitest";

import { createEmptyGraph } from "@/lib/graph";

describe("createEmptyGraph", () => {
  it("creates a directed, empty graphology graph", () => {
    const graph = createEmptyGraph();

    expect(graph.order).toBe(0);
    expect(graph.size).toBe(0);
    expect(graph.type).toBe("directed");
  });
});
