"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.randomHex = randomHex;
exports.sha256Hex = sha256Hex;
exports.computeResultIndex = computeResultIndex;
const crypto_1 = __importDefault(require("crypto"));
function randomHex(bytesCount) {
    return crypto_1.default.randomBytes(bytesCount).toString('hex');
}
function sha256Hex(text) {
    return crypto_1.default.createHash('sha256').update(text).digest('hex');
}
function computeResultIndex(serverSeed, clientSeed, roundId, cardCount) {
    const combined = `${serverSeed}:${clientSeed}:${roundId}`;
    const hashHex = sha256Hex(combined);
    const value = BigInt('0x' + hashHex.slice(0, 16));
    return Number(value % BigInt(cardCount));
}
