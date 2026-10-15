/** Current time in epoch milliseconds. Injected so tests control time. */
export type Clock = () => number;

export const systemClock: Clock = () => Date.now();
