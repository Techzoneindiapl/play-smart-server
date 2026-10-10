import crypto from 'crypto';

export function randomHex(bytesCount: number): string {
  return crypto.randomBytes(bytesCount).toString('hex');
}

export function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function computeResultIndex(
  serverSeed: string,
  clientSeed: string,
  roundId: string,
  cardCount: number
): number {
  const combined = `${serverSeed}:${clientSeed}:${roundId}`;
  const hashHex = sha256Hex(combined);
  const value = BigInt('0x' + hashHex.slice(0, 16));
  return Number(value % BigInt(cardCount));
}
