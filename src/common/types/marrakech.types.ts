export type MarrakechDirection = 'N' | 'S' | 'E' | 'W';
export type MarrakechPhase = 'orient' | 'roll' | 'borderChoice' | 'tribute' | 'place' | 'gameOver';

export interface MarrakechPosition {
  row: number;
  col: number;
}

export interface MarrakechAssam {
  position: MarrakechPosition;
  direction: MarrakechDirection;
}

export interface MarrakechCarpetCell {
  playerId: number;
  carpetId: string;
}

export interface MarrakechPlayerColor {
  primary: string;
  light: string;
  dark: string;
  name: string;
}

export interface MarrakechPlayer {
  id: number;
  name: string;
  color: MarrakechPlayerColor;
  dirhams: number;
  carpetsRemaining: number;
  eliminated: boolean;
}

export interface MarrakechCarpetPlacement {
  cell1: MarrakechPosition;
  cell2: MarrakechPosition;
  playerId: number;
  carpetId: string;
}

export interface MarrakechTributeInfo {
  fromPlayerId: number;
  toPlayerId: number;
  amount: number;
  connectedCells: MarrakechPosition[];
}

export interface MarrakechDiceResult {
  value: number;
  faces: number[];
}

export interface MarrakechBorderOption {
  direction: MarrakechDirection;
  label: string;
}

export interface MarrakechBorderChoiceInfo {
  position: MarrakechPosition;
  currentDirection: MarrakechDirection;
  remainingSteps: number;
  options: MarrakechBorderOption[];
  pathSoFar: MarrakechPosition[];
  diceResult: MarrakechDiceResult;
}

export interface MarrakechFinalScore {
  playerId: number;
  name: string;
  dirhams: number;
  visibleCells: number;
  total: number;
}

export interface MarrakechGameAction {
  type: 'orient' | 'roll' | 'move' | 'tribute' | 'place' | 'eliminate' | 'gameOver';
  playerId: number;
  description: string;
  timestamp: number;
}

export interface MarrakechGameState {
  numPlayers: number;
  board: (MarrakechCarpetCell | null)[][];
  assam: MarrakechAssam;
  players: MarrakechPlayer[];
  currentPlayerIndex: number;
  phase: MarrakechPhase;
  lastDiceRoll: MarrakechDiceResult | null;
  currentTribute: MarrakechTributeInfo | null;
  validPlacements: MarrakechCarpetPlacement[];
  selectedPlacement: MarrakechCarpetPlacement | null;
  borderChoiceInfo: MarrakechBorderChoiceInfo | null;
  movePath: MarrakechPosition[];
  actionLog: MarrakechGameAction[];
  gameOver: boolean;
  winner: number | null;
  finalScores: MarrakechFinalScore[];
  turnNumber: number;
}

export interface MarrakechMoveRequest {
  matchId: string;
  gameType: 'marrakech';
  phase: 'orient' | 'borderChoice' | 'place';
  state: MarrakechGameState;
  validActions: MarrakechValidActions;
  turnNumber: number;
  timeRemainingMs: number;
  yourPlayerIndex: number;
}

export interface MarrakechValidActions {
  directions?: MarrakechDirection[];
  borderOptions?: MarrakechBorderOption[];
  placements?: MarrakechCarpetPlacement[];
}

export interface MarrakechMoveResponse {
  action: MarrakechAction;
}

export type MarrakechAction =
  | { type: 'orient'; direction: MarrakechDirection }
  | { type: 'borderChoice'; direction: MarrakechDirection }
  | { type: 'place'; placement: { cell1: MarrakechPosition; cell2: MarrakechPosition } }
  | { type: 'skip' };
