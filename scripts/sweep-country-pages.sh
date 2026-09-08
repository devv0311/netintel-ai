#!/usr/bin/env bash
#
# P6.28 — execute the country sweep declared in
# evidence/final-test-4/collection-declaration.json.
#
#   bash scripts/sweep-country-pages.sh <declaration.json> <log.jsonl>
#
# This script DECIDES NOTHING. The country list, the page size, the ordering,
# the page cap and the early-stop rule all come out of the declaration file,
# which was committed before any of this ran. It loops the approved collector
# and records what each page returned; it cannot add a country, raise a cap or
# reach a source the adapter set does not already allow.
#
# Early stop: a country stops being paged as soon as a page returns fewer than
# `pageSize` SPARQL ROWS — the row count, not the folded record count, because
# the row limit is what binds. A page that fails after its retries also stops
# that country, and the failure is written to the log rather than smoothed over.
set -uo pipefail

DECL="${1:-evidence/final-test-4/collection-declaration.json}"
LOG="${2:-evidence/final-test-4/sweep-log.jsonl}"

PAGE_SIZE=$(python3 -c "import json;print(json.load(open('$DECL'))['collectionRule']['pageSize'])")
MAX_PAGES=$(python3 -c "import json;print(json.load(open('$DECL'))['collectionRule']['maxPagesPerCountry'])")
COUNTRIES=$(python3 -c "import json;print(' '.join(json.load(open('$DECL'))['universe']['countries']))")

: > "$LOG"
for CC in $COUNTRIES; do
  for ((PAGE=0; PAGE<MAX_PAGES; PAGE++)); do
    OFFSET=$((PAGE * PAGE_SIZE))
    ROWS=-1
    for ATTEMPT in 1 2 3; do
      OUT=$(node --use-env-proxy --import ./scripts/eval-resolve.mjs scripts/collect-public.ts \
              --source wikidata --country "$CC" --limit "$PAGE_SIZE" --offset "$OFFSET" 2>&1)
      if grep -q "^Collected " <<<"$OUT"; then
        DIR=$(grep '^Collected ' <<<"$OUT" | sed 's/.*→ //')
        ROWS=$(python3 -c "
import json,sys
d=json.load(open('$DIR/raw/sparql-results.json'))
print(len(d.get('results',{}).get('bindings',[])))" 2>/dev/null || echo -1)
        RECS=$(grep -o '^Collected [0-9]*' <<<"$OUT" | awk '{print $2}')
        python3 -c "
import json
print(json.dumps({'country':'$CC','offset':$OFFSET,'attempt':$ATTEMPT,'rows':$ROWS,'records':int('$RECS'),'dir':'$DIR','status':'ok'}))" >> "$LOG"
        echo "  $CC offset=$OFFSET rows=$ROWS records=$RECS"
        break
      fi
      if [[ $ATTEMPT -eq 3 ]]; then
        REASON=$(tail -1 <<<"$OUT" | tr -d '"' | cut -c1-200)
        python3 -c "
import json
print(json.dumps({'country':'$CC','offset':$OFFSET,'attempt':3,'rows':-1,'status':'failed','reason':'''$REASON'''}))" >> "$LOG"
        echo "  $CC offset=$OFFSET FAILED: $REASON"
      else
        sleep 10
      fi
    done
    # stop paging this country: exhausted, or the page could not be fetched
    if [[ "$ROWS" -lt "$PAGE_SIZE" ]]; then break; fi
    sleep 2
  done
  sleep 1
done
echo "sweep complete -> $LOG"
