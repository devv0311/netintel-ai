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
