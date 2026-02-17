export { GameEngine } from "./engine.js";
export { getGame, type GameImplementation } from "./games/registry.js";
export {
  EMPTY,
  BLACK,
  WHITE,
  BOARD_SIZE,
  createBoard,
  cloneBoard,
  getOpponent,
  getLegalMoves,
  isValidMove,
  getFlippedPieces,
  getScore,
  isGameOver,
  getWinner,
} from "./games/reversi/index.js";
