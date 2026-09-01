import Graph from "graphology";

/**
 * The graph processing boundary. Per docs/architecture/technology-stack.md,
 * the case graph is an in-memory graphology instance rebuilt from SQLite.
 * Graph synthesis (Workstream D) and analytics (Workstream E) are not
 * implemented yet — this module only proves the dependency is wired
 * correctly.
 */
export function createEmptyGraph(): Graph {
  return new Graph({ type: "directed", multi: true, allowSelfLoops: false });
}
