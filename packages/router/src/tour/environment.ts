// The search's only links to the outside world, injectable so runs can be made reproducible
// (tests use a fake clock and a seeded random source).

/** Returns the current time in milliseconds, like Date.now. */
export type Clock = () => number;

/** Returns a uniformly distributed number in [0, 1), like Math.random. */
export type RandomSource = () => number;

export const systemClock: Clock = () => Date.now();
export const systemRandom: RandomSource = () => Math.random();
