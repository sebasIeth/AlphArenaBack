const K_FACTOR = 32;

export interface RatingResult {
  newRatingA: number;
  newRatingB: number;
  changeA: number;
  changeB: number;
}

export function calculateEloChange(ratingA: number, ratingB: number, scoreA: number) {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const changeA = K_FACTOR * (scoreA - expectedA);
  return {
    changeA: Math.round(changeA * 100) / 100,
    changeB: Math.round(-changeA * 100) / 100,
  };
}

export function updateRatings(ratingA: number, ratingB: number, result: 'a' | 'b' | 'draw'): RatingResult {
  let scoreA: number;
  switch (result) {
    case 'a': scoreA = 1; break;
    case 'b': scoreA = 0; break;
    case 'draw': scoreA = 0.5; break;
  }
  const { changeA, changeB } = calculateEloChange(ratingA, ratingB, scoreA);
  return {
    newRatingA: Math.round(ratingA + changeA),
    newRatingB: Math.round(ratingB + changeB),
    changeA,
    changeB,
  };
}
