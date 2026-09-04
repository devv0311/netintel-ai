/**
 * P6.18 - a BOUNDED transliteration experiment over the 51 real
 * Devanagari/Latin primary-name pairs P6.17.3 collected.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/transliteration-study.ts
 *
 * THIS SCRIPT CHANGES NOTHING. It imports no resolver, runs no pipeline
 * and writes no database. It applies a deterministic Devanagari->Latin
 * table to publisher-stated Hindi labels and reports what an exact match
 * on the transliterated key WOULD have joined.
 *
 * NOTHING IS MANUFACTURED. Every Devanagari string is Wikidata's own
 * rdfs:label@hi and every Latin string is GLEIF's own legal name. The
 * table below converts script; it does not invent, translate or guess a
 * name, and it is applied to the publisher's string as collected.
 *
 * The question is narrow and worth separating from "does transliteration
 * help": a Hindi label can stand in three quite different relations to
 * an English legal name, and only ONE of them is a script problem.
 *
 *   PHONETIC   - the Hindi label spells the English name out
 *                (`फ्लिपकार्ट` = Flipkart). Script folding is
 *                the whole gap - IF the two spellings agree once folded.
 *   ACRONYM    - the Hindi label spells English LETTER NAMES
 *                (`एसबीआई` = "es-bee-aai" = SBI). Deterministically
 *                decodable from a fixed letter-name table.
 *   TRANSLATED - the Hindi label is a different name with the same
 *                meaning (`भारतीय इस्पात प्राधिकरण` = "Steel Authority
 *                of India"). NO transliteration reaches this: the
 *                strings are not the same name in two scripts.
 */
import fs from "node:fs";
import path from "node:path";

import { normalizeName } from "@/lib/resolution/name-normalization";

const ROOT = process.cwd();
const BASE = "evidence/no-identifier/devanagari-pilot";

/* ---------------- deterministic Devanagari -> Latin ---------------- */

const INDEPENDENT_VOWELS: Record<string, string> = {
  "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u",
  "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
  "ऍ": "e", "ऑ": "o",
};
const MATRAS: Record<string, string> = {
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u",
  "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
  "ॅ": "e", "ॉ": "o",
};
const CONSONANTS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v",
  "श": "sh", "ष": "sh", "स": "s", "ह": "h", "ळ": "l",
  // nukta forms, written as single code points
  "क़": "q", "ख़": "kh", "ग़": "gh", "ज़": "z", "ड़": "r",
  "ढ़": "rh", "फ़": "f", "य़": "y",
};
const VIRAMA = "्";
const NUKTA = "़";
const NUKTA_MAP: Record<string, string> = {
  "क": "q", "ख": "kh", "ग": "gh", "ज": "z", "ड": "r",
  "ढ": "rh", "फ": "f", "य": "y",
};
const ANUSVARA = "ं", CHANDRABINDU = "ँ", VISARGA = "ः";

const isDevanagari = (ch: string) => ch >= "ऀ" && ch <= "ॿ";

/**
 * Transliterates one Devanagari word, syllable by syllable.
 *
 * The inherent vowel `a` follows a consonant unless a virama or a matra
 * intervenes. Two refinements are separately switchable so each can be
 * priced on its own rather than as a bundle:
 *
 *   nasalVowel   - `ai`/`e` before anusvara is written `a`/`e`, because
 *                  Hindi spells "bank" as `बैंक`; without this the key
 *                  is `baink` and the pair misses on one letter.
 *   medialSchwa  - Hindi deletes a medial inherent `a` in V-C_C-V
 *                  context (`स्टारबक्स` = starbaks, not starabaks).
 *
 * Word-final schwa deletion is unconditional: it is not optional in
 * Hindi and every publisher string in this corpus assumes it.
 */
interface Syllable { c: string; v: string | null; inherent: boolean; nasal: string }

function syllabify(word: string): { lead: string; syllables: Syllable[] } {
  const chars = [...word];
  const syllables: Syllable[] = [];
  let lead = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (CONSONANTS[ch] !== undefined) {
      let base = CONSONANTS[ch]!;
      let j = i;
      if (chars[i + 1] === NUKTA && NUKTA_MAP[ch] !== undefined) { base = NUKTA_MAP[ch]!; j = i + 1; }
      const after = chars[j + 1];
      if (after === VIRAMA) { syllables.push({ c: base, v: null, inherent: false, nasal: "" }); i = j + 1; continue; }
      if (after !== undefined && MATRAS[after] !== undefined) {
        let v = MATRAS[after]!; let nasal = ""; let k = j + 1;
        if (chars[k + 1] === ANUSVARA || chars[k + 1] === CHANDRABINDU) { if (v === "ai") v = "a"; nasal = "n"; k++; }
        syllables.push({ c: base, v, inherent: false, nasal }); i = k; continue;
      }
      if (after === ANUSVARA || after === CHANDRABINDU) { syllables.push({ c: base, v: "a", inherent: false, nasal: "n" }); i = j + 1; continue; }
      syllables.push({ c: base, v: "a", inherent: true, nasal: "" }); i = j; continue;
    }
    if (INDEPENDENT_VOWELS[ch] !== undefined) {
      let v = INDEPENDENT_VOWELS[ch]!; let nasal = "";
      if (chars[i + 1] === ANUSVARA || chars[i + 1] === CHANDRABINDU) { if (v === "ai") v = "a"; nasal = "n"; i++; }
      if (syllables.length === 0) lead += v + nasal; else syllables.push({ c: "", v, inherent: false, nasal });
      continue;
    }
    if (ch === ANUSVARA || ch === CHANDRABINDU) { if (syllables.length) syllables[syllables.length - 1]!.nasal = "n"; continue; }
    if (ch === NUKTA || ch === VIRAMA) continue;
    if (!isDevanagari(ch) && syllables.length === 0) lead += ch;
  }
  return { lead, syllables };
}

function translitWord(word: string, medialSchwa = false): string {
  const { lead, syllables } = syllabify(word);
  const last = syllables[syllables.length - 1];
  if (last && last.inherent && last.nasal === "") last.v = null;                 // word-final schwa
  if (medialSchwa)
    for (let i = 1; i < syllables.length - 1; i++) {
      const a = syllables[i]!, n = syllables[i + 1]!;
      if (a.inherent && a.nasal === "" && n.v !== null) a.v = null;
    }
  return lead + syllables.map((s) => s.c + (s.v ?? "") + s.nasal).join("");
}

const transliterate = (s: string, medialSchwa = false) =>
  s.split(/(\s+)/).map((w) => (/\s/.test(w) ? " " : translitWord(w, medialSchwa))).join("").trim();

/* ---------------- Devanagari-rendered English letter names ---------- */
/** Longest-first so `आई` (I) is read before `आ` could be. */
const LETTER_NAMES: [string, string][] = [
  ["डब्ल्यू", "w"], ["क्यू", "q"], ["एक्स", "x"],
  ["ज़ेड", "z"], ["जेड", "z"], ["वाई", "y"], ["आई", "i"], ["एफ़", "f"], ["एफ", "f"],
  ["एच", "h"], ["एल", "l"], ["एम", "m"], ["एन", "n"], ["एस", "s"], ["आर", "r"],
  ["बी", "b"], ["सी", "c"], ["डी", "d"], ["जी", "g"], ["जे", "j"], ["के", "k"],
  ["पी", "p"], ["टी", "t"], ["यू", "u"], ["वी", "v"], ["ई", "e"], ["ओ", "o"], ["ए", "a"],
];

/**
 * Reads a token as a run of English letter names, e.g. `एसबीआई` ->
 * `sbi`. Returns null unless the WHOLE token is consumed and at least
 * two letters were read, so an ordinary Hindi word is never mistaken for
 * an initialism.
 */
function decodeAcronym(token: string): string | null {
  let i = 0, out = "";
  outer: while (i < token.length) {
    for (const [dev, lat] of LETTER_NAMES) {
      if (token.startsWith(dev, i)) { out += lat; i += dev.length; continue outer; }
    }
    return null;
  }
  return out.length >= 2 ? out : null;
}

const acronymFold = (s: string, medialSchwa = false) => {
  const toks = s.split(/\s+/).filter(Boolean);
  const decoded = toks.map((t) => decodeAcronym(t));
  if (decoded.every((d) => d !== null) && toks.length > 0) return decoded.join("");     // "आई टी सी" -> "itc"
  return toks.map((t, i) => decoded[i] ?? translitWord(t, medialSchwa)).join(" ");      // mixed: "आईसीआईसीआई बैंक"
};

const key = (s: string) => normalizeName(s).normalized;
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

interface Truth {
  positives: { pairId: string; lei: string; gleifSurrogate: string; wikidataSurrogate: string; gleifName: string; wikidataName: string }[];
  hardNegatives: { pairId: string; a: { surrogate: string; name: string; lei: string }; b: { surrogate: string; name: string; lei: string } }[];
  surrogateMap: Record<string, { registry: string; name: string; leis: string[] }>;
}

function main(): void {
  const truth = JSON.parse(fs.readFileSync(path.join(ROOT, `${BASE}.ground-truth.json`), "utf8")) as Truth;
  const hasDev = (s: string) => [...s].some(isDevanagari);
  const devPairs = truth.positives.filter((p) => hasDev(p.wikidataName));

  const STRATEGIES: { id: string; label: string; fold: (s: string) => string }[] = [
    { id: "S0_baseline", label: "shipped normalisation only (no script folding)", fold: (s) => s },
    { id: "S1_translit", label: "+ deterministic Devanagari->Latin transliteration", fold: (s) => transliterate(s) },
    { id: "S2_translit_acronym", label: "+ transliteration AND English-letter-name decoding", fold: (s) => acronymFold(s) },
    { id: "S3_medial_schwa", label: "+ S2 AND Hindi medial schwa deletion", fold: (s) => acronymFold(s, true) },
  ];

  // Every record, so a proposed key can be checked against the WHOLE corpus.
  const recs = Object.entries(truth.surrogateMap).map(([sur, r]) => ({ sur, registry: r.registry, name: r.name, leis: r.leis }));
  const shareLei = (a: typeof recs[number], b: typeof recs[number]) => a.leis.some((l) => b.leis.includes(l));

  const results = STRATEGIES.map((st) => {
    const keyed = recs.map((r) => ({ ...r, k: key(hasDev(r.name) ? st.fold(r.name) : r.name) }));
    const byKey = new Map<string, typeof keyed>();
    for (const r of keyed) { if (!r.k) continue; if (!byKey.has(r.k)) byKey.set(r.k, []); byKey.get(r.k)!.push(r); }

    const joined: string[] = [];
    for (const p of devPairs) {
      const g = keyed.find((r) => r.sur === p.gleifSurrogate), w = keyed.find((r) => r.sur === p.wikidataSurrogate);
      if (g && w && g.k && g.k === w.k) joined.push(p.pairId);
    }
    let falseEdges = 0; const falseCases: string[] = [];
    for (const group of byKey.values()) {
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++)
        if (!shareLei(group[i]!, group[j]!)) { falseEdges++; falseCases.push(`${group[i]!.name} || ${group[j]!.name}`); }
    }
    const hnMerged = truth.hardNegatives.filter((n) => {
      const a = keyed.find((r) => r.sur === n.a.surrogate), b = keyed.find((r) => r.sur === n.b.surrogate);
      return !!a && !!b && !!a.k && a.k === b.k;
    }).map((n) => n.pairId);
    return { ...st, joined, falseEdges, falseCases, hnMerged };
  });

  console.log("=".repeat(78));
  console.log("P6.18  TRANSLITERATION STUDY - measurement only, nothing enabled");
  console.log("=".repeat(78));
  console.log(`corpus        ${BASE}-anchored.corpus.json`);
  console.log(`real Devanagari/Latin primary-name pairs: ${devPairs.length}`);
  console.log();
  for (const r of results) {
    console.log("-".repeat(78));
    console.log(`${r.id}  ${r.label}`);
    console.log(`  pairs joined            ${r.joined.length}/${devPairs.length}  (${pct(r.joined.length, devPairs.length)})`);
    if (r.joined.length) console.log(`  joined                  ${r.joined.join(", ")}`);
    console.log(`  hard negatives merged   ${r.hnMerged.length}/${truth.hardNegatives.length}`);
    console.log(`  false merges corpus-wide ${r.falseEdges}${r.falseCases.length ? `  <-- ${r.falseCases.slice(0, 3).join("; ")}` : ""}`);
  }
  console.log("-".repeat(78));
  console.log("\nWHY THE REST DO NOT JOIN - the transliterated key beside the Latin key:\n");
  const best = results[results.length - 1]!;
  const rows = devPairs.map((p) => {
    const t = key(best.fold(p.wikidataName)), g = key(p.gleifName);
    return { pairId: p.pairId, hindi: p.wikidataName, translit: t, gleif: g, joined: best.joined.includes(p.pairId) };
  });
  for (const r of rows) console.log(`  ${r.joined ? "JOIN" : "MISS"}  ${r.pairId}  "${r.hindi}" -> "${r.translit}"   vs GLEIF "${r.gleif}"`);

  // Characterises the RESIDUAL gap. Edit distance is reported as a
  // description of how far apart the two strings are; it is NOT proposed
  // as a matching rule, and nothing in this study merges on it.
  const editDistance = (a: string, b: string): number => {
    const m: number[][] = [...Array(a.length + 1)].map((_, i) => [i, ...Array(b.length).fill(0)]);
    for (let y = 1; y <= b.length; y++) m[0]![y] = y;
    for (let x = 1; x <= a.length; x++)
      for (let y = 1; y <= b.length; y++)
        m[x]![y] = Math.min(m[x - 1]![y]! + 1, m[x]![y - 1]! + 1, m[x - 1]![y - 1]! + (a[x - 1] === b[y - 1] ? 0 : 1));
    return m[a.length]![b.length]!;
  };
  const residual = rows.filter((r) => !r.joined).map((r) => ({ ...r, editDistance: editDistance(r.translit, r.gleif) }))
    .sort((a, b) => a.editDistance - b.editDistance);
  const near = residual.filter((r) => r.editDistance <= 3);
  console.log(`\nRESIDUAL after the best deterministic strategy: ${residual.length} pairs unjoined`);
  console.log(`  within edit distance 3 of the Latin key (a SPELLING gap, not a script gap): ${near.length}`);
  near.forEach((r) => console.log(`     d=${r.editDistance}  ${r.pairId}  "${r.translit}" vs "${r.gleif}"`));
  console.log(`  beyond edit distance 3 (a DIFFERENT NAME, which no transliteration reaches): ${residual.length - near.length}`);

  const out = {
    experiment: "P6.18 transliteration study",
    dataClass: "REAL - Wikidata rdfs:label@hi + GLEIF legal names, CC0 1.0",
    disclaimer: "Measurement only. No resolver imported, no pipeline run, no database written, no ground truth modified. Script conversion only - no name was translated, invented or guessed.",
    corpus: `${BASE}-anchored.corpus.json`, groundTruth: `${BASE}.ground-truth.json`,
    ranAt: new Date().toISOString(),
    devanagariPairs: devPairs.length,
    strategies: results.map((r) => ({
      id: r.id, label: r.label,
      pairsJoined: { n: r.joined.length, d: devPairs.length, pct: pct(r.joined.length, devPairs.length) },
      joined: r.joined,
      hardNegativeFalseMerges: { n: r.hnMerged.length, d: truth.hardNegatives.length, cases: r.hnMerged },
      corpusWideFalseMerges: { n: r.falseEdges, cases: r.falseCases },
    })),
    perPair: rows,
    residualCharacterisation: {
      note: "Edit distance DESCRIBES how far the residual pairs are from matching. It is not a proposed rule and nothing here merges on it.",
      unjoined: residual.length,
      withinEditDistance3: near.length,
      beyondEditDistance3: residual.length - near.length,
      cases: residual,
    },
  };
  const dest = path.join(ROOT, "reports/no-identifier/transliteration-study.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwritten: ${path.relative(ROOT, dest)}`);
}

main();
