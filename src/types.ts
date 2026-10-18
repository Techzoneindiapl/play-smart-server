export type GameId = 'lucky12' | 'lucky16' | 'luckyTimer';

export interface Card {
  label: string;
  suit: string;
  rank: string;
  red: boolean;
  suitName: string;
  index: number;
}

export interface User {
  id: string;
  username: string;
  name: string;
  password?: string;
  pin?: string;
  role: 'user' | 'distributer' | 'superdistributer' | 'admin';
  distributerId?: string;
  superdistributerId?: string;
  balance: number;
  status: 'active' | 'blocked';
  createdAt: string;
  lastLogin?: string;
}

export interface SuperDistributer {
  id: string;
  name: string;
  code: string;
  commission: number;
  balance: number;
  status: 'active' | 'blocked';
  usersCount: number;
  createdAt: string;
}

export interface Distributer {
  id: string;
  superId: string;
  name: string;
  code: string;
  commission: number;
  balance: number;
  status: 'active' | 'blocked';
  usersCount: number;
  createdAt: string;
}

export interface Allocation {
  id: string;
  username: string;
  targetIndex: number;
  points: number;
  placedAt: number;
  cardLabel?: string;
}

export interface Round {
  id: string;
  gameId: GameId;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  status: 'betting' | 'locked' | 'revealed';
  secondsLeft: number;
  totalSeconds: number;
  allocations: Allocation[];
  resultIndex: number | null;
  winningCard: Card | null;
  forcedWinnerIndex: number | null;
  forcedMode: 'fair' | 'player_win' | 'manual';
  customMultipliers: Record<number, number>;
  createdAt: number;
  revealedAt?: number;
}

export interface WalletTransaction {
  id: string;
  userId: string;
  username: string;
  type: 'bet' | 'win' | 'refund' | 'credit' | 'payout' | 'deposit' | 'withdrawal' | 'commission';
  amount: number;
  description: string;
  time: string;
  balanceAfter: number;
  roundId?: string;
  gameId?: string;
}

export interface RoundHistoryEntry {
  id: string;
  roundId: string;
  gameId: GameId;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  resultIndex: number;
  winningCard: Card;
  totalBets: number;
  totalPayouts: number;
  playerCount: number;
  isOverridden: boolean;
  time: string;
  allocations?: Allocation[];
  winners?: { username: string; points: number; winAmount: number; multiplier: number }[];
}

export interface RtpConfig {
  houseMargin: number;
  playerRtp: number;
  algoStatus: string;
  riskThreshold: string;
  rankMultipliers: Record<string, number>;
  rankWeights: Record<string, number>;
  rankStatus: Record<string, string>;
}
