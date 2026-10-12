import { Card, GameId } from '../types';

export const DECK_12: Card[] = [
  // Row 0: Kings (K)
  { label: 'K', suit: '♥', rank: 'K', red: true, suitName: 'Hearts', index: 0 },
  { label: 'K', suit: '♠', rank: 'K', red: false, suitName: 'Spades', index: 1 },
  { label: 'K', suit: '♦', rank: 'K', red: true, suitName: 'Diamonds', index: 2 },
  { label: 'K', suit: '♣', rank: 'K', red: false, suitName: 'Clubs', index: 3 },
  // Row 1: Queens (Q)
  { label: 'Q', suit: '♥', rank: 'Q', red: true, suitName: 'Hearts', index: 4 },
  { label: 'Q', suit: '♠', rank: 'Q', red: false, suitName: 'Spades', index: 5 },
  { label: 'Q', suit: '♦', rank: 'Q', red: true, suitName: 'Diamonds', index: 6 },
  { label: 'Q', suit: '♣', rank: 'Q', red: false, suitName: 'Clubs', index: 7 },
  // Row 2: Jacks (J)
  { label: 'J', suit: '♥', rank: 'J', red: true, suitName: 'Hearts', index: 8 },
  { label: 'J', suit: '♠', rank: 'J', red: false, suitName: 'Spades', index: 9 },
  { label: 'J', suit: '♦', rank: 'J', red: true, suitName: 'Diamonds', index: 10 },
  { label: 'J', suit: '♣', rank: 'J', red: false, suitName: 'Clubs', index: 11 },
];

export const DECK_16: Card[] = [
  // Row 0: Aces (A)
  { label: 'A', suit: '♥', rank: 'A', red: true, suitName: 'Hearts', index: 0 },
  { label: 'A', suit: '♠', rank: 'A', red: false, suitName: 'Spades', index: 1 },
  { label: 'A', suit: '♦', rank: 'A', red: true, suitName: 'Diamonds', index: 2 },
  { label: 'A', suit: '♣', rank: 'A', red: false, suitName: 'Clubs', index: 3 },
  // Row 1: Kings (K)
  { label: 'K', suit: '♥', rank: 'K', red: true, suitName: 'Hearts', index: 4 },
  { label: 'K', suit: '♠', rank: 'K', red: false, suitName: 'Spades', index: 5 },
  { label: 'K', suit: '♦', rank: 'K', red: true, suitName: 'Diamonds', index: 6 },
  { label: 'K', suit: '♣', rank: 'K', red: false, suitName: 'Clubs', index: 7 },
  // Row 2: Queens (Q)
  { label: 'Q', suit: '♥', rank: 'Q', red: true, suitName: 'Hearts', index: 8 },
  { label: 'Q', suit: '♠', rank: 'Q', red: false, suitName: 'Spades', index: 9 },
  { label: 'Q', suit: '♦', rank: 'Q', red: true, suitName: 'Diamonds', index: 10 },
  { label: 'Q', suit: '♣', rank: 'Q', red: false, suitName: 'Clubs', index: 11 },
  // Row 3: Jacks (J)
  { label: 'J', suit: '♥', rank: 'J', red: true, suitName: 'Hearts', index: 12 },
  { label: 'J', suit: '♠', rank: 'J', red: false, suitName: 'Spades', index: 13 },
  { label: 'J', suit: '♦', rank: 'J', red: true, suitName: 'Diamonds', index: 14 },
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
