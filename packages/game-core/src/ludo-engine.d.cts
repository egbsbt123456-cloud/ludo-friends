import type { LudoState } from '@board/contracts';
declare const engine: {
  createInitialState(players: string[]): LudoState;
  movablePieces(state: LudoState): number[];
  safeRoll(state: LudoState, dice: number): { ok: true; state: LudoState } | { ok: false; code: string };
  safePass(state: LudoState): { ok: true; state: LudoState } | { ok: false; code: string };
  safeMove(state: LudoState, piece: number): { ok: true; state: LudoState } | { ok: false; code: string };
  stepsToEntry(color: string, position: number): number;
  finishIndex(color: string, position: number): number;
};
export = engine;
