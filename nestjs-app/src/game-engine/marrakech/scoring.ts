import { MarrakechFinalScore, MarrakechGameState } from '../../common/types';
import { MARRAKECH_BOARD_SIZE } from './constants';

export function calculateFinalScores(state: MarrakechGameState): MarrakechFinalScore[] {
  return state.players
    .map((player) => {
      let visibleCells = 0;
      for (let row = 0; row < MARRAKECH_BOARD_SIZE; row++) {
        for (let col = 0; col < MARRAKECH_BOARD_SIZE; col++) {
          const cell = state.board[row][col];
          if (cell && cell.playerId === player.id) visibleCells++;
        }
      }
      return {
        playerId: player.id,
        name: player.name,
        dirhams: player.dirhams,
        visibleCells,
        total: player.dirhams + visibleCells,
      };
    })
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return b.dirhams - a.dirhams;
    });
}
