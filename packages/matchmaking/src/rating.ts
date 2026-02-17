/**
 * K-factor used in the ELO calculation.
 * A higher K-factor means ratings change more per match.
 * 32 is the standard value used for most competitive systems.
 */
const K_FACTOR = 32;

export interface EloChange {
  changeA: number;
  changeB: number;
}

export interface RatingResult {
  newRatingA: number;
  newRatingB: number;
  changeA: number;
  changeB: number;
}

/**
 * Calculate the ELO rating change for a match between two players.
 *
 * Uses the standard ELO formula:
 *   expectedA = 1 / (1 + 10^((ratingB - ratingA) / 400))
 *   changeA = K * (scoreA - expectedA)
 *   changeB = -changeA
 *
 * @param ratingA - Current ELO rating of player A
 * @param ratingB - Current ELO rating of player B
 * @param scoreA  - Actual score for player A: 1 = win, 0 = loss, 0.5 = draw
 * @returns The ELO change for both players
 */
export function calculateEloChange(
  ratingA: number,
  ratingB: number,
  scoreA: number
): EloChange {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const changeA = K_FACTOR * (scoreA - expectedA);

  return {
    changeA: Math.round(changeA * 100) / 100,
    changeB: Math.round(-changeA * 100) / 100,
  };
}

/**
 * Calculate updated ratings for both players after a match.
 *
 * @param ratingA - Current ELO rating of player A
 * @param ratingB - Current ELO rating of player B
 * @param result  - Match result: "a" = player A wins, "b" = player B wins, "draw" = draw
 * @returns New ratings and changes for both players
 */
export function updateRatings(
  ratingA: number,
  ratingB: number,
  result: "a" | "b" | "draw"
): RatingResult {
  let scoreA: number;

  switch (result) {
    case "a":
      scoreA = 1;
      break;
    case "b":
      scoreA = 0;
      break;
    case "draw":
      scoreA = 0.5;
      break;
  }

  const { changeA, changeB } = calculateEloChange(ratingA, ratingB, scoreA);

  return {
    newRatingA: Math.round(ratingA + changeA),
    newRatingB: Math.round(ratingB + changeB),
    changeA,
    changeB,
  };
}
