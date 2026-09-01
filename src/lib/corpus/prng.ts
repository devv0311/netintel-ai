/**
 * A tiny, self-contained, deterministic pseudo-random generator
 * (mulberry32). Every stochastic choice in corpus generation draws from
 * one instance seeded by CORPUS_SEED, in a fixed call order, so the same
 * seed always reproduces the same corpus (docs/requirements.md §6).
 *
 * Not cryptographic and not meant to be — it exists purely to make
 * "random-looking but reproducible" synthetic data.
 *
 * Dependency-free on purpose (see config.ts).
 */

export interface Prng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniformly pick one element (throws on empty input). */
  pick<T>(items: readonly T[]): T;
  /** A deterministic in-place-style shuffle returning a new array. */
  shuffle<T>(items: readonly T[]): T[];
  /** Roughly-normal integer around `mean` with spread `±jitter`, clamped ≥ min. */
  around(mean: number, jitter: number, min: number): number;
}

export function makePrng(seed: number): Prng {
  let a = seed >>> 0;

  function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(min: number, max: number): number {
    if (max < min) throw new Error(`prng.int: max ${max} < min ${min}`);
    return min + Math.floor(next() * (max - min + 1));
  }

  function chance(p: number): boolean {
    return next() < p;
  }

  function pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("prng.pick: empty array");
    const value = items[int(0, items.length - 1)];
    if (value === undefined) throw new Error("prng.pick: undefined element");
    return value;
  }

  function shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      const vi = out[i];
      const vj = out[j];
      if (vi === undefined || vj === undefined) continue;
      out[i] = vj;
      out[j] = vi;
    }
    return out;
  }

  function around(mean: number, jitter: number, min: number): number {
    // Average of two draws → mild central tendency, still deterministic.
    const delta = (next() + next() - 1) * jitter;
    return Math.max(min, Math.round(mean + delta));
  }

  return { next, int, chance, pick, shuffle, around };
}
