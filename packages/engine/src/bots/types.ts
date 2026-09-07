import type { GameState } from '../model/state';
import type { Action } from '../engine';

export interface Bot {
  chooseAction(state: GameState, playerId: string): Action;
}
