import mongoose, { Schema, Document } from 'mongoose';
import { User, SuperDistributer, Distributer, WalletTransaction, RoundHistoryEntry, RtpConfig } from '../types';

export interface IUserDoc extends Document, Omit<User, 'id'> {
  id: string;
}

export const UserSchema = new Schema<IUserDoc>({
  id: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  password: { type: String, default: '123' },
  role: { type: String, default: 'user' },
  balance: { type: Number, default: 50000 },
  status: { type: String, default: 'active' },
  distributerId: { type: String, default: 'D-201' },
  superdistributerId: { type: String, default: 'SD-101' },
  createdAt: { type: String, default: () => new Date().toISOString() },
  lastLogin: { type: String },
});

export const UserModel = mongoose.models.User || mongoose.model<IUserDoc>('User', UserSchema);

export interface ISuperDistDoc extends Document, Omit<SuperDistributer, 'id'> {
  id: string;
}

export const SuperDistributerSchema = new Schema<ISuperDistDoc>({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  code: { type: String, required: true },
  commission: { type: Number, default: 2.5 },
  balance: { type: Number, default: 125000 },
  status: { type: String, default: 'active' },
  usersCount: { type: Number, default: 0 },
  createdAt: { type: String, default: () => new Date().toISOString().slice(0, 10) },
});

export const SuperDistributerModel =
  mongoose.models.SuperDistributer ||
  mongoose.model<ISuperDistDoc>('SuperDistributer', SuperDistributerSchema);

export interface IDistDoc extends Document, Omit<Distributer, 'id'> {
  id: string;
}

export const DistributerSchema = new Schema<IDistDoc>({
  id: { type: String, required: true, unique: true },
  superId: { type: String, default: 'SD-101' },
  name: { type: String, required: true },
  code: { type: String, required: true },
  commission: { type: Number, default: 1.5 },
  balance: { type: Number, default: 42000 },
  status: { type: String, default: 'active' },
  usersCount: { type: Number, default: 0 },
  createdAt: { type: String, default: () => new Date().toISOString().slice(0, 10) },
});

export const DistributerModel =
  mongoose.models.Distributer ||
  mongoose.model<IDistDoc>('Distributer', DistributerSchema);

export interface IRoundHistoryDoc extends Document, Omit<RoundHistoryEntry, 'id'> {
  id: string;
}

export const RoundHistorySchema = new Schema<IRoundHistoryDoc>({
  id: { type: String, required: true, unique: true },
  roundId: { type: String, required: true },
  gameId: { type: String, required: true },
  serverSeed: { type: String, required: true },
  serverSeedHash: { type: String, required: true },
  clientSeed: { type: String, required: true },
  resultIndex: { type: Number, required: true },
  winningCard: { type: Schema.Types.Mixed, required: true },
  totalBets: { type: Number, default: 0 },
  totalPayouts: { type: Number, default: 0 },
  playerCount: { type: Number, default: 0 },
  isOverridden: { type: Boolean, default: false },
  time: { type: String, default: () => new Date().toISOString() },
  allocations: { type: Schema.Types.Mixed, default: [] },
  winners: { type: Schema.Types.Mixed, default: [] },
});

export const RoundHistoryModel =
  mongoose.models.RoundHistory ||
  mongoose.model<IRoundHistoryDoc>('RoundHistory', RoundHistorySchema);

export interface ITransactionDoc extends Document, Omit<WalletTransaction, 'id'> {
  id: string;
}

export const TransactionSchema = new Schema<ITransactionDoc>({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  username: { type: String, required: true },
  type: { type: String, required: true },
  amount: { type: Number, required: true },
  description: { type: String, default: '' },
  time: { type: String, default: () => new Date().toISOString() },
  balanceAfter: { type: Number, required: true },
  roundId: { type: String },
  gameId: { type: String },
});

export const TransactionModel =
  mongoose.models.Transaction ||
  mongoose.model<ITransactionDoc>('Transaction', TransactionSchema);

export interface IRtpConfigDoc extends Document {
  key: string;
  config: RtpConfig;
}

export const RtpConfigSchema = new Schema<IRtpConfigDoc>({
  key: { type: String, default: 'global', unique: true },
  config: { type: Schema.Types.Mixed, required: true },
});

export const RtpConfigModel =
  mongoose.models.RtpConfig ||
  mongoose.model<IRtpConfigDoc>('RtpConfig', RtpConfigSchema);
