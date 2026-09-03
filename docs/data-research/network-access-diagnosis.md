# Network access to the public registers — diagnosis

**Date:** 2026-09-03
**Supersedes:** the "egress is blocked, full stop" conclusion recorded in P6.5/P6.6

## Summary

| Publisher | Direct socket (`fetch`/`curl`) | Operator web tool | Usable for the pilot |
|---|---|---|---|
| `api.gleif.org` | **BLOCKED** — HTTP 403 at CONNECT | **REACHABLE** | Yes, via relay |
| `query.wikidata.org` | **BLOCKED** — HTTP 403 at CONNECT | **BLOCKED** — proxy rejected (403) | **No** |
| `www.wikidata.org` | **BLOCKED** — HTTP 403 at CONNECT | **BLOCKED** — domain is cache-only | **No** |
| `api.wikimedia.org` | not attempted | **BLOCKED** — domain is cache-only | **No** |

## What the 403 actually is

The previous session recorded "HTTP 403 CONNECT" and stopped, which was the correct
call but an incomplete diagnosis. The cause is an **egress allowlist**, not a publisher
refusal and not a transient fault:

```
$ curl -v https://api.gleif.org/api/v1/lei-records
* Uses proxy env variable https_proxy == 'http://127.0.0.1:35087'
> CONNECT api.gleif.org:443 HTTP/1.1
< HTTP/1.1 403 Forbidden
* CONNECT tunnel failed, response 403
```

The refusal is issued by the *local* agent proxy before the connection leaves the
machine. Neither publisher ever sees the request, so nothing about GLEIF's or
Wikimedia's own terms, rate limits or robots policy is implicated. The allowlist
(`no_proxy`) contains package registries and the Anthropic API and nothing else;
`registry.npmjs.org`, `pypi.org` and `api.github.com` all return 200 through the same
proxy, which is what establishes that the proxy works and the denial is selective.

The same 403 occurs from the operator's own machine, because that shell inherits the
same session egress policy. This is an environment policy, and it was **not** worked
around: no proxy setting was altered, no alternate transport was used to reach a
blocked host, and no mirror, cache or third-party copy of either dataset was
substituted.

## The relay channel, and why it is weaker

GLEIF is reachable through the operator-side web-fetch tool, which is a sanctioned
first-party network path with its own policy — not a circumvention of the one above.
That tool is what supplied the pilot's records.

It is **not equivalent to a direct socket**, and the collector records the difference
rather than smoothing it over (`retrievalChannel` in `src/lib/adapters/public/types.ts`):

- `direct-https` — this process opened the socket. `rawSha256` is a hash of the bytes
  the publisher sent.
- `agent-relay` — the payload was relayed and written to disk, then transformed from
  there. The *content* is the publisher's; the *bytes* are not proven to be, because a
  relay may normalise insignificant whitespace. `rawSha256` therefore hashes the stored
  payload, and `manifest.json` carries `rawSha256Caveat` saying so in words.

**Consequence for governance.** The pilot's provenance chain is complete and auditable
— source id, endpoint, retrieval timestamp, hash, licence, licence URL, per-payload
hashes and transformation history are all recorded — but its hash is a *custody* hash,
not a *wire* hash. Any claim that these bytes are byte-identical to GLEIF's output
requires re-running `npm run collect:public --source gleif` over `direct-https` from an
unrestricted network. That re-run needs no new code: it is the adapter's default path.

## Wikidata

All three official Wikimedia endpoints are blocked on every available channel. Per the
project's own stop conditions this is a **hard stop for SRC-001**, not a problem to
route around. No Wikidata record was collected, no Wikidata substitute was used, and
the Wikidata adapter is untouched and still unexercised against live data.

This matters more than losing one source. GLEIF and Wikidata were chosen together
precisely because a subject appearing in *both* is the only thing in the approved
Tier-A set that produces cross-source co-reference — the measurement entity resolution
actually needs. Losing Wikidata does not shrink the pilot; it removes the pilot's
ability to test the resolver's central function. See
`docs/evaluation/real-data-pilot.md`.

---

## Re-diagnosis — 2026-09-03, second session

Re-tested before attempting the GLEIF × Wikidata cross-source experiment. **Wikidata is
still unreachable on every approved path.** The result is unchanged; the *shape* of the
refusal is now clearer.

| Host | Direct socket (cloud) | Direct socket (operator machine) | Operator web tool |
|---|---|---|---|
| `query.wikidata.org` | 403 at CONNECT | 403 / DNS unreachable | `This domain is cache-only and cannot be fetched` |
| `www.wikidata.org` | 403 at CONNECT | 403 / DNS unreachable | same |
| `api.wikimedia.org` | 403 at CONNECT | 403 / DNS unreachable | same |
| `api.gleif.org` | 403 at CONNECT | 403 / DNS unreachable | **reachable — returned live data during this test** |

Four URL shapes were tried on the web tool, covering every official read interface
Wikimedia publishes:

- `query.wikidata.org/sparql?format=json&query=…` (WDQS)
- `www.wikidata.org/w/api.php?action=wbgetentities&…` (Action API)
- `www.wikidata.org/w/rest.php/wikibase/v1/entities/items/Q95` (Wikibase REST)
- `api.wikimedia.org/core/v1/wikidata/wikidata/page/Q95/bare` (Wikimedia API Gateway)

All four returned the identical domain-level message. The refusal is **path-independent
and host-family-wide**, which distinguishes it from the earlier `PROXY_REJECTED` seen on
WDQS: this is a deliberate content policy covering the Wikimedia domains, not an
incidental allowlist gap.

That GLEIF returned live data through the same tool in the same session is what makes
this conclusive. The web tool is not broken and does not refuse arbitrary public APIs;
it refuses these domains specifically.

**No further channel was tried.** Routing Wikidata through a different transport in
order to get around a tool that names these domains as out of scope would be
circumventing an access restriction, not diagnosing one, and no mirror, cache, dump
copy or third-party redistribution of Wikidata was considered as a substitute. The
project's rule is fail-closed, and this is what failing closed looks like.

### What is ready, and what is missing

Nothing is missing but access. `npm run collect:public --source wikidata --query
indian-companies-with-lei --limit 30 --dry-run` plans cleanly against the approved
source (SRC-001, CC0 1.0, APPROVED) and prints the query it would send. That query is
already the right instrument for the cross-source experiment:

```sparql
SELECT ?item ?itemLabel ?itemLabelHi ?lei WHERE {
  ?item wdt:P31/wdt:P279* wd:Q4830453 ; wdt:P17 wd:Q668 ; wdt:P1278 ?lei .
  OPTIONAL { ?item rdfs:label ?itemLabelHi FILTER(LANG(?itemLabelHi) = "hi") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

`?lei` is the Tier-A join key into the collected GLEIF set; `?itemLabel` supplies an
independently-authored English name for the same legal entity; `?itemLabelHi` supplies a
Devanagari label, which is the transliteration case the P6.6 fixture only simulated.
One request, 30 records, is enough to measure all of it.

**Minimum action required:** add `query.wikidata.org` (or the Wikimedia domains
generally) to the environment's permitted fetch scope, or run
`npm run collect:public --source wikidata --query indian-companies-with-lei --limit 30`
on an unrestricted network and commit the resulting `data/public/raw/SRC-001/…`
directory. Either unblocks the experiment with no code change.

