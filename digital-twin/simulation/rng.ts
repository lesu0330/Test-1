import type { SimulationState } from "./types";

export function nextRandom(state: SimulationState): number {
  state.rngState = (Math.imul(1664525, state.rngState) + 1013904223) >>> 0;
  return state.rngState / 4294967296;
}
