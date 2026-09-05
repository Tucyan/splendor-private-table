// Splendor base set card data, transcribed and independently verified against
// the public CSV cited in docs/card-data-sources.md. The five colors are ordered
// white, blue, green, red, black in each compact cost tuple below.
export const COLORS = ['white', 'blue', 'green', 'red', 'black'];
export const GOLD = 'gold';

const CARD_ROWS = [
  ['white-L1-01', 0, 0, 3, 0, 0, 0],
  ['white-L1-02', 1, 0, 0, 4, 0, 0],
  ['white-L1-03', 0, 0, 0, 0, 2, 1],
  ['white-L1-04', 0, 0, 2, 0, 0, 2],
  ['white-L1-05', 0, 3, 1, 0, 0, 1],
  ['white-L1-06', 0, 0, 2, 2, 0, 1],
  ['white-L1-07', 0, 0, 1, 1, 1, 1],
  ['white-L1-08', 0, 0, 1, 2, 1, 1],
  ['white-L2-01', 2, 0, 0, 0, 5, 0],
  ['white-L2-02', 3, 6, 0, 0, 0, 0],
  ['white-L2-03', 2, 0, 0, 0, 5, 3],
  ['white-L2-04', 2, 0, 0, 1, 4, 2],
  ['white-L2-05', 1, 0, 0, 3, 2, 2],
  ['white-L2-06', 1, 2, 3, 0, 3, 0],
  ['white-L3-01', 4, 0, 0, 0, 0, 7],
  ['white-L3-02', 4, 3, 0, 0, 3, 6],
  ['white-L3-03', 3, 0, 3, 3, 5, 3],
  ['white-L3-04', 5, 3, 0, 0, 0, 7],
  ['blue-L1-01', 0, 0, 0, 0, 0, 3],
  ['blue-L1-02', 1, 0, 0, 0, 4, 0],
  ['blue-L1-03', 0, 1, 0, 0, 0, 2],
  ['blue-L1-04', 0, 0, 0, 2, 0, 2],
  ['blue-L1-05', 0, 0, 1, 3, 1, 0],
  ['blue-L1-06', 0, 1, 0, 2, 2, 0],
  ['blue-L1-07', 0, 1, 0, 1, 1, 1],
  ['blue-L1-08', 0, 1, 0, 1, 2, 1],
  ['blue-L2-01', 2, 0, 5, 0, 0, 0],
  ['blue-L2-02', 3, 0, 6, 0, 0, 0],
  ['blue-L2-03', 2, 5, 3, 0, 0, 0],
  ['blue-L2-04', 2, 2, 0, 0, 1, 4],
  ['blue-L2-05', 1, 0, 2, 2, 3, 0],
  ['blue-L2-06', 1, 0, 2, 3, 0, 3],
  ['blue-L3-01', 4, 7, 0, 0, 0, 0],
  ['blue-L3-02', 4, 6, 3, 0, 0, 3],
  ['blue-L3-03', 3, 3, 0, 3, 3, 5],
  ['blue-L3-04', 5, 7, 3, 0, 0, 0],
  ['green-L1-01', 0, 0, 0, 0, 3, 0],
  ['green-L1-02', 1, 0, 0, 0, 0, 4],
  ['green-L1-03', 0, 2, 1, 0, 0, 0],
  ['green-L1-04', 0, 0, 2, 0, 2, 0],
  ['green-L1-05', 0, 1, 3, 1, 0, 0],
  ['green-L1-06', 0, 0, 1, 0, 2, 2],
  ['green-L1-07', 0, 1, 1, 0, 1, 1],
  ['green-L1-08', 0, 1, 1, 0, 1, 2],
  ['green-L2-01', 2, 0, 0, 5, 0, 0],
  ['green-L2-02', 3, 0, 0, 6, 0, 0],
  ['green-L2-03', 2, 0, 5, 3, 0, 0],
  ['green-L2-04', 2, 4, 2, 0, 0, 1],
  ['green-L2-05', 1, 2, 3, 0, 0, 2],
  ['green-L2-06', 1, 3, 0, 2, 3, 0],
  ['green-L3-01', 4, 0, 7, 0, 0, 0],
  ['green-L3-02', 4, 3, 6, 3, 0, 0],
  ['green-L3-03', 3, 5, 3, 0, 3, 3],
  ['green-L3-04', 5, 0, 7, 3, 0, 0],
  ['red-L1-01', 0, 3, 0, 0, 0, 0],
  ['red-L1-02', 1, 4, 0, 0, 0, 0],
  ['red-L1-03', 0, 0, 2, 1, 0, 0],
  ['red-L1-04', 0, 2, 0, 0, 2, 0],
  ['red-L1-05', 0, 1, 0, 0, 1, 3],
  ['red-L1-06', 0, 2, 0, 1, 0, 2],
  ['red-L1-07', 0, 1, 1, 1, 0, 1],
  ['red-L1-08', 0, 2, 1, 1, 0, 1],
  ['red-L2-01', 2, 0, 0, 0, 0, 5],
  ['red-L2-02', 3, 0, 0, 0, 6, 0],
  ['red-L2-03', 2, 3, 0, 0, 0, 5],
  ['red-L2-04', 2, 1, 4, 2, 0, 0],
  ['red-L2-05', 1, 2, 0, 0, 2, 3],
  ['red-L2-06', 1, 0, 3, 0, 2, 3],
  ['red-L3-01', 4, 0, 0, 7, 0, 0],
  ['red-L3-02', 4, 0, 3, 6, 3, 0],
  ['red-L3-03', 3, 3, 5, 3, 0, 3],
  ['red-L3-04', 5, 0, 0, 7, 3, 0],
  ['black-L1-01', 0, 0, 0, 3, 0, 0],
  ['black-L1-02', 1, 0, 4, 0, 0, 0],
  ['black-L1-03', 0, 0, 0, 2, 1, 0],
  ['black-L1-04', 0, 2, 0, 2, 0, 0],
  ['black-L1-05', 0, 0, 0, 1, 3, 1],
  ['black-L1-06', 0, 2, 2, 0, 1, 0],
  ['black-L1-07', 0, 1, 1, 1, 1, 0],
  ['black-L1-08', 0, 1, 2, 1, 1, 0],
  ['black-L2-01', 2, 5, 0, 0, 0, 0],
  ['black-L2-02', 3, 0, 0, 0, 0, 6],
  ['black-L2-03', 2, 0, 0, 5, 3, 0],
  ['black-L2-04', 2, 0, 1, 4, 2, 0],
  ['black-L2-05', 1, 3, 2, 2, 0, 0],
  ['black-L2-06', 1, 3, 0, 3, 0, 2],
  ['black-L3-01', 4, 0, 0, 0, 7, 0],
  ['black-L3-02', 4, 0, 0, 3, 6, 3],
  ['black-L3-03', 3, 3, 3, 5, 3, 0],
  ['black-L3-04', 5, 0, 0, 0, 7, 3],
];

export const CARDS = CARD_ROWS.map(([id, points, ...costValues]) => {
  const [bonus, levelText] = id.split('-');
  const level = Number(levelText.slice(1));
  const cost = Object.fromEntries(COLORS.map((color, index) => [color, costValues[index]]));
  return Object.freeze({ id, level, bonus, points, cost: Object.freeze(cost) });
});

const NOBLE_COSTS = [
  [0, 3, 3, 3, 0], [3, 3, 0, 0, 3], [4, 0, 0, 0, 4],
  [4, 4, 0, 0, 0], [0, 4, 4, 0, 0], [3, 3, 3, 0, 0],
  [3, 0, 0, 3, 3], [0, 0, 3, 3, 3], [0, 0, 0, 4, 4], [0, 0, 4, 4, 0],
];

export const NOBLES = NOBLE_COSTS.map((values, index) => Object.freeze({
  id: `noble-${String(index + 1).padStart(2, '0')}`,
  points: 3,
  cost: Object.freeze(Object.fromEntries(COLORS.map((color, i) => [color, values[i]]))),
}));

export const CARDS_BY_LEVEL = Object.fromEntries([1, 2, 3].map((level) => [level, CARDS.filter((card) => card.level === level)]));
