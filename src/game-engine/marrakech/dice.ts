import { MarrakechDiceResult } from '../../common/types';
import { DICE_FACES } from './constants';

export function rollDice(): MarrakechDiceResult {
  const index = Math.floor(Math.random() * DICE_FACES.length);
  const value = DICE_FACES[index];
  const faces: number[] = [];
  for (let i = 0; i < 10; i++) {
    faces.push(DICE_FACES[Math.floor(Math.random() * DICE_FACES.length)]);
  }
  faces.push(value);
  return { value, faces };
}
