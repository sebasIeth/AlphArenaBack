import type { MarrakechDirection, MarrakechPlayerColor, MarrakechPosition } from "@alpharena/shared";

export const MARRAKECH_BOARD_SIZE = 7;

export const PLAYER_COLORS: MarrakechPlayerColor[] = [
  { primary: "#E74C3C", light: "#FADBD8", dark: "#C0392B", name: "Rojo" },
  { primary: "#3498DB", light: "#D6EAF8", dark: "#2176AE", name: "Azul" },
  { primary: "#2ECC71", light: "#D5F5E3", dark: "#1E8449", name: "Verde" },
  { primary: "#9B59B6", light: "#E8DAEF", dark: "#7D3C98", name: "Púrpura" },
];

export const DICE_FACES = [1, 2, 2, 3, 3, 4];

export const CARPETS_PER_PLAYER: Record<number, number> = {
  2: 24,
  3: 15,
  4: 12,
};

export const STARTING_DIRHAMS = 30;

export const DIRECTION_VECTORS: Record<MarrakechDirection, MarrakechPosition> = {
  N: { row: -1, col: 0 },
  S: { row: 1, col: 0 },
  E: { row: 0, col: 1 },
  W: { row: 0, col: -1 },
};

export const TURNS: Record<
  MarrakechDirection,
  { left: MarrakechDirection; right: MarrakechDirection; straight: MarrakechDirection }
> = {
  N: { left: "W", right: "E", straight: "N" },
  S: { left: "E", right: "W", straight: "S" },
  E: { left: "N", right: "S", straight: "E" },
  W: { left: "S", right: "N", straight: "W" },
};

export const OPPOSITE_DIRECTION: Record<MarrakechDirection, MarrakechDirection> = {
  N: "S",
  S: "N",
  E: "W",
  W: "E",
};
