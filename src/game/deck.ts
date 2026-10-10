import { Card, GameId } from '../types';

export const DECK_12: Card[] = [
  // Column 0: Hearts
  { label: 'J', suit: '♥', rank: 'J', red: true, suitName: 'Hearts', index: 0 },
  { label: 'Q', suit: '♥', rank: 'Q', red: true, suitName: 'Hearts', index: 1 },
  { label: 'K', suit: '♥', rank: 'K', red: true, suitName: 'Hearts', index: 2 },
  // Column 1: Spades
  { label: 'J', suit: '♠', rank: 'J', red: false, suitName: 'Spades', index: 3 },
  { label: 'Q', suit: '♠', rank: 'Q', red: false, suitName: 'Spades', index: 4 },
  { label: 'K', suit: '♠', rank: 'K', red: false, suitName: 'Spades', index: 5 },
  // Column 2: Diamonds
  { label: 'J', suit: '♦', rank: 'J', red: true, suitName: 'Diamonds', index: 6 },
  { label: 'Q', suit: '♦', rank: 'Q', red: true, suitName: 'Diamonds', index: 7 },
  { label: 'K', suit: '♦', rank: 'K', red: true, suitName: 'Diamonds', index: 8 },
  // Column 3: Clubs
  { label: 'J', suit: '♣', rank: 'J', red: false, suitName: 'Clubs', index: 9 },
  { label: 'Q', suit: '♣', rank: 'Q', red: false, suitName: 'Clubs', index: 10 },
  { label: 'K', suit: '♣', rank: 'K', red: false, suitName: 'Clubs', index: 11 },
];

export const DECK_16: Card[] = [
  // Hearts
  { label: 'A', suit: '♥', rank: 'A', red: true, suitName: 'Hearts', index: 0 },
  { label: 'K', suit: '♥', rank: 'K', red: true, suitName: 'Hearts', index: 1 },
  { label: 'Q', suit: '♥', rank: 'Q', red: true, suitName: 'Hearts', index: 2 },
  { label: 'J', suit: '♥', rank: 'J', red: true, suitName: 'Hearts', index: 3 },
  // Spades
  { label: 'A', suit: '♠', rank: 'A', red: false, suitName: 'Spades', index: 4 },
  { label: 'K', suit: '♠', rank: 'K', red: false, suitName: 'Spades', index: 5 },
  { label: 'Q', suit: '♠', rank: 'Q', red: false, suitName: 'Spades', index: 6 },
  { label: 'J', suit: '♠', rank: 'J', red: false, suitName: 'Spades', index: 7 },
  // Diamonds
  { label: 'A', suit: '♦', rank: 'A', red: true, suitName: 'Diamonds', index: 8 },
  { label: 'K', suit: '♦', rank: 'K', red: true, suitName: 'Diamonds', index: 9 },
  { label: 'Q', suit: '♦', rank: 'Q', red: true, suitName: 'Diamonds', index: 10 },
  { label: 'J', suit: '♦', rank: 'J', red: true, suitName: 'Diamonds', index: 11 },
  // Clubs
  { label: 'A', suit: '♣', rank: 'A', red: false, suitName: 'Clubs', index: 12 },
  { label: 'K', suit: '♣', rank: 'K', red: false, suitName: 'Clubs', index: 13 },
  { label: 'Q', suit: '♣', rank: 'Q', red: false, suitName: 'Clubs', index: 14 },
  { label: 'J', suit: '♣', rank: 'J', red: false, suitName: 'Clubs', index: 15 },
];

export function getDeck(gameId: GameId): Card[] {
  if (gameId === 'lucky16') return DECK_16;
  return DECK_12;
}

export function getDefaultMultiplier(gameId: GameId): number {
  if (gameId === 'lucky16') return 12;
  return 10;
}
