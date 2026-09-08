#!/usr/bin/env bash
#
# P6.28 — resolve the counterpart side of every FRESH subject the country
# sweep found.
#
#   bash scripts/resolve-fresh-counterparts.sh <sweep-log.jsonl> <work-dir>
#
# Positives in this project are cross-source: a GLEIF record and a Wikidata
# record carrying the same LEI, or an EDGAR record and a Wikidata record
# carrying the same CIK. The sweep collects the Wikidata side; this resolves
# the other one.
#
# It resolves ONLY subjects that survive the freshness filter — every subject
# in any partition of the seven prior datasets is dropped first. That is the
# same rule the corpus builder applies at build time, applied earlier here so
# the collection does not spend bounded requests re-fetching entities the test
# is going to discard anyway.
#
# The identifier set is DERIVED from already-collected approved records and
# passed through the collector's own --leis-from / --ciks-from. Nothing is
# hand-typed, nothing is crawled, and the chunk size is the adapter's MAX_LIMIT.
set -uo pipefail

LOG="${1:-evidence/final-test-4/sweep-log.jsonl}"
WORK="${2:-evidence/final-test-4/linkage}"
mkdir -p "$WORK"

python3 - "$LOG" "$WORK" <<'PY'
import json, os, sys
log_path, work = sys.argv[1], sys.argv[2]

consumed = set()
for p in ["pair-dataset.json","pair-dataset-v2.json","pair-dataset-v3.json","pair-dataset-final-test.json",
          "pair-dataset-final-test-2.json","pair-dataset-final-test-3.json","pair-dataset-v4.json"]:
    d = json.load(open(os.path.join("evidence/ml", p)))
    for pair in d["pairs"]:
        for k in ("subject","subjectA","subjectB"):
            v = pair.get(k)
            if v: consumed.add(v)

dirs = []
for line in open(log_path):
    row = json.loads(line)
    if row.get("status") == "ok" and row.get("dir"): dirs.append(row["dir"])

records, seen_ref = [], set()
for d in dirs:
    p = os.path.join(d, "public-records.json")
    if not os.path.exists(p): continue
    for r in json.load(open(p)):
        if r["recordRef"] in seen_ref: continue
        seen_ref.add(r["recordRef"]); records.append(r)

def ids(r, scheme):
    return [i["value"] for i in (r.get("identifiers") or []) if i["scheme"] == scheme]

fresh_lei, fresh_cik = {}, {}
for r in records:
    for v in ids(r, "LEI"):
        if f"LEI:{v}" not in consumed: fresh_lei.setdefault(v, r)
    for v in ids(r, "CIK"):
        if f"CIK:{v}" not in consumed: fresh_cik.setdefault(v, r)

def chunk(values, size, scheme, prefix):
    values = sorted(values)                      # deterministic order
    paths = []
    for i in range(0, len(values), size):
        batch = values[i:i+size]
        path = os.path.join(work, f"{prefix}-{i//size+1:03d}.json")
        json.dump([{"recordRef": f"linkage:{v}", "identifiers": [{"scheme": scheme, "value": v}]} for v in batch],
                  open(path, "w"), indent=0)
        paths.append(path)
    return paths

lei_files = chunk(fresh_lei, 500, "LEI", "lei-chunk")
cik_files = chunk(fresh_cik, 100, "CIK", "cik-chunk")
json.dump({"wikidataRunDirs": len(dirs), "wikidataRecords": len(records),
           "consumedSubjects": len(consumed),
           "freshLeis": len(fresh_lei), "freshCiks": len(fresh_cik),
           "leiChunks": lei_files, "cikChunks": cik_files},
          open(os.path.join(work, "linkage-manifest.json"), "w"), indent=2)
print(f"{len(records)} wikidata records from {len(dirs)} runs; "
      f"fresh LEIs {len(fresh_lei)} in {len(lei_files)} chunk(s); "
      f"fresh CIKs {len(fresh_cik)} in {len(cik_files)} chunk(s)")
PY

for F in "$WORK"/lei-chunk-*.json; do
  [[ -e "$F" ]] || continue
  echo "GLEIF <- $F"
  for ATTEMPT in 1 2 3; do
    if node --use-env-proxy --import ./scripts/eval-resolve.mjs scripts/collect-public.ts \
         --source gleif --leis-from "$F" --limit 500 2>&1 | tail -3; then break; fi
    sleep 15
  done
  sleep 2
done

for F in "$WORK"/cik-chunk-*.json; do
  [[ -e "$F" ]] || continue
  echo "EDGAR <- $F"
  for ATTEMPT in 1 2 3; do
    if node --use-env-proxy --import ./scripts/eval-resolve.mjs scripts/collect-public.ts \
         --source edgar --ciks-from "$F" --limit 100 2>&1 | tail -3; then break; fi
    sleep 15
  done
  sleep 2
done
echo "counterpart resolution complete"
