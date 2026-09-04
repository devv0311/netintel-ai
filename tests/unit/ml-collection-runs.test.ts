/**
 * The corpus builders read a DECLARED set of collection runs, not whatever
 * happens to be on disk.
 *
 * This test exists because the glob version of that loader was not a
 * theoretical hazard. The P6.25 final test was collected into the same
 * three `data/public/raw/SRC-00*` directories as the training corpus,
 * after the training corpus had been frozen. Re-running the published
 * reproduction command therefore rebuilt the v2 corpus from 31 runs
 * instead of the 20 it was frozen from — 3,290 scorable records became
 * 5,085, 1,711 positives became 2,604, and 417 of the final test's 973
 * subjects landed in TRAIN and VALIDATION. Every one of leakage checks
 * L1-L12 still passed, because a freshly-built split is internally
 * disjoint no matter which corpus it absorbed.
 *
 * So the pins are part of the frozen artifact, and they are asserted here
 * rather than trusted: if a pin is edited or a pinned run disappears, the
 * corpus that reproduces the published metrics can no longer be rebuilt,
 * and that must fail loudly at test time rather than quietly at the next
 * `npm run ml:corpus`.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

interface Pin {
  note: string;
  runs: Record<string, string[]>;
}

const readPin = (relative: string): Pin =>
  JSON.parse(readFileSync(path.join(ROOT, relative), "utf8")) as Pin;

const CORPORA = [
  {
    name: "expanded-v2 (training corpus)",
    pin: "evidence/expanded-v2/collection-runs.json",
    groundTruth: "evidence/expanded-v2/expanded-v2.ground-truth.json",
    expected: { "SRC-001": 4, "SRC-002": 14, "SRC-006": 2 },
  },
  {
    name: "final-test (frozen test corpus)",
    pin: "evidence/final-test/collection-runs.json",
    groundTruth: "evidence/final-test/final-test.ground-truth.json",
    expected: { "SRC-001": 12, "SRC-002": 16, "SRC-006": 3 },
  },
] as const;

describe("collection-run pins", () => {
  for (const corpus of CORPORA) {
    describe(corpus.name, () => {
      it("pins the exact run count the corpus was frozen from", () => {
        const pin = readPin(corpus.pin);
        for (const [src, count] of Object.entries(corpus.expected)) {
          expect(pin.runs[src], `${corpus.pin} is missing ${src}`).toBeDefined();
          expect(pin.runs[src]?.length, `${corpus.pin} ${src} run count`).toBe(count);
        }
      });

      it("pins runs that all exist on disk", () => {
        const pin = readPin(corpus.pin);
        for (const [src, runs] of Object.entries(pin.runs)) {
          const base = path.join(ROOT, "data/public/raw", src);
          const onDisk = new Set(readdirSync(base));
          for (const run of runs) {
            expect(onDisk.has(run), `${src}/${run} is pinned but not on disk`).toBe(true);
            expect(
              existsSync(path.join(base, run, "public-records.json")),
              `${src}/${run} has no public-records.json`,
            ).toBe(true);
          }
        }
      });

      it("agrees with the run set the committed ground truth records", () => {
        const pin = readPin(corpus.pin);
        const truth = JSON.parse(readFileSync(path.join(ROOT, corpus.groundTruth), "utf8")) as {
          builtFrom: Record<string, string[]>;
        };
        const byRegistry: Record<string, string> = {
          wikidata: "SRC-001",
          gleif: "SRC-002",
          edgar: "SRC-006",
        };
        for (const [registry, dirs] of Object.entries(truth.builtFrom)) {
          const src = byRegistry[registry] as string;
          expect(dirs.map((d) => path.basename(d)).sort()).toEqual([...(pin.runs[src] ?? [])].sort());
        }
      });
    });
  }

  it("keeps the training corpus strictly older than the final test's collection", () => {
    // The final test is a superset in run terms: it was collected later, and
    // it subtracts the training corpus's subjects rather than its runs. The
    // training corpus must therefore never contain a run the final test
    // added, which is precisely the containment that broke.
    const train = readPin("evidence/expanded-v2/collection-runs.json");
    const test = readPin("evidence/final-test/collection-runs.json");
    for (const [src, runs] of Object.entries(train.runs)) {
      for (const run of runs) {
        expect(test.runs[src], `final test pin is missing ${src}`).toContain(run);
      }
    }
    const added = Object.entries(test.runs).flatMap(([src, runs]) =>
      runs.filter((r) => !(train.runs[src] ?? []).includes(r)).map((r) => `${src}/${r}`),
    );
    expect(added.length, "the final test must have been collected after the training corpus").toBeGreaterThan(0);
  });
});
