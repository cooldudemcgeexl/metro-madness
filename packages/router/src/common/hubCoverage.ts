// The set of hubs a tour has covered so far.
//
// This is a plain Set<number> of hub indices with one addition: a *fingerprint* that is the same
// for any two coverages holding the same hubs, whatever order they were added in. Beam search
// uses it to spot partial tours that have covered the same hubs without comparing whole sets,
// which matters because it checks millions of candidate extensions per search.
//
// The fingerprint is the sum of a fixed pseudo-random weight per hub (a form of Zobrist hashing).
// Sums are exact in floating point up to 2^53, and weights are below 2^40, so up to 8192 hubs
// can be summed without rounding. Two different sets sharing a fingerprint is possible but
// vanishingly unlikely (about 1 in 2^40 per comparison), and the only effect would be beam
// search discarding one of two otherwise-equal partial tours.

/** The fixed fingerprint weight of a hub. Deterministic, so searches are reproducible. */
export function hubWeight(hub: number): number {
  // Two rounds of an integer hash (from MurmurHash3's finalizer) give well-spread 32-bit halves.
  const high = mix32(hub * 2 + 1);
  const low = mix32(hub * 2 + 2);
  // 8 bits from one half and 32 from the other: a 40-bit weight.
  return (high & 0xff) * 2 ** 32 + low;
}

function mix32(seed: number): number {
  let value = seed >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}

export class HubCoverage implements Iterable<number> {
  private readonly hubs: Set<number>;
  private fingerprintSum: number;

  constructor(hubs: Iterable<number> = []) {
    this.hubs = new Set();
    this.fingerprintSum = 0;
    for (const hub of hubs) this.add(hub);
  }

  /** Same value for any two coverages with the same hubs. */
  get fingerprint(): number {
    return this.fingerprintSum;
  }

  get size(): number {
    return this.hubs.size;
  }

  has(hub: number): boolean {
    return this.hubs.has(hub);
  }

  /** Add a hub. Returns true if it was not covered before. */
  add(hub: number): boolean {
    if (this.hubs.has(hub)) return false;
    this.hubs.add(hub);
    this.fingerprintSum += hubWeight(hub);
    return true;
  }

  /** True when every hub in `required` is covered. */
  coversAll(required: Iterable<number>): boolean {
    for (const hub of required) if (!this.hubs.has(hub)) return false;
    return true;
  }

  clone(): HubCoverage {
    const copy = new HubCoverage();
    for (const hub of this.hubs) copy.hubs.add(hub);
    copy.fingerprintSum = this.fingerprintSum;
    return copy;
  }

  [Symbol.iterator](): Iterator<number> {
    return this.hubs[Symbol.iterator]();
  }
}
