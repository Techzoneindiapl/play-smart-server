# Gaming Backend & Live Sync Engine

High-performance authoritative game backend connecting **Play Smart** (Flutter Game App) and **Sk_Casino2 / FairDeal** (Next.js Admin Dashboard) with real-time WebSockets and REST APIs.

---

## 🌟 Key Features

1. **Authoritative Game Engine**:
   - Synchronized round lifecycle for:
     - `lucky12` (Lucky Card 12)
     - `lucky16` (Lucky 16 Cards)
     - `luckyTimer` (Lucky Card Timer)
   - Real-time phase progression: `betting` -> `locked` -> `revealed` -> `payout`.
   - Provably Fair commitments: SHA-256 committed hash (`serverSeed` + `clientSeed` + `roundId`) published before betting opens.

2. **Admin Real-Time Control**:
   - **Forced Outcome Control**: Admin can designate any winning card or switch modes (`fair`, `player_win`, `manual`).
   - **Custom Multipliers**: Override card multipliers dynamically (e.g., 10x, 12x, 20x).
   - **Fast Lock & Settle**: Admin can immediately lock and resolve rounds.
   - **RTP & Margin Tuning**: Dynamic house margin and rank multiplier controls.

3. **Live Sync with Flutter & Admin**:
   - Flutter player bets stream in real-time to the Admin panel's live allocations table and card heatmaps.
   - Real-time wallet deductions, balance updates, and automatic win payouts.
   - Live connected player tracking.

4. **Hierarchical Management**:
   - SuperDistributer -> Distributer -> Players hierarchy.
   - Wallet management, credit adjustments, and live turnover / transaction reporting.

---

## 🚀 Running the Services

### 1. Start the Backend Server (Port 3001)
```bash
cd backend
npm run dev
# Or production:
npm run build && npm start
```
- **HTTP Base URL**: `http://localhost:3001`
- **WebSocket URL**: `ws://localhost:3001`

### 2. Start the Admin Panel (Port 3000)
```bash
cd fairdeal-nextjs
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the Admin Dashboard.

### 3. Start the Flutter App
```bash
cd play_smart
flutter run
# Or for desktop/web:
flutter run -d macos
# or
flutter run -d chrome
```

---

## 📡 API & WebSocket Reference

### WebSocket Events (`ws://localhost:3001`)

| Event Name | Direction | Payload Description |
|---|---|---|
| `admin_subscribe` | Client -> Server | Admin joins to receive all live game events and stats |
| `join_game` | Client -> Server | `{ gameId, username }` - Player subscribes to a specific game |
| `place_bet` | Client -> Server | `{ gameId, targetIndex, points }` - Place a live bet |
| `admin_set_forced_winner`| Client -> Server | `{ gameId, index, mode, multiplier }` - Admin overrides outcome |
| `admin_force_lock` | Client -> Server | `{ gameId }` - Admin forces round lock |
| `round_start` | Server -> Clients | Published at start of every round with new round ID & hash |
| `game_timer` | Server -> Clients | 1-second countdown ticks with `secondsLeft` |
| `new_allocation` | Server -> Clients | Real-time bet allocation broadcast |
| `betting_closed` | Server -> Clients | Round locked for drawing |
| `game_result` | Server -> Clients | Winning card, server seed, and winner payouts |
| `balance_updated` | Server -> Player | Player's balance updated after bet or win |
| `online_players` | Server -> Admin | Live connected users list and count |

### Key REST Endpoints

- `POST /api/auth/login`: Player authentication
- `GET /api/wallet/balance`: Wallet summary and balance
- `GET /api/wallet/transactions`: Player transaction history
- `POST /api/wallet/transactions`: Balance deposits/withdrawals
- `GET /api/game/current/:gameId`: Current active round state
- `GET /api/game/history/:gameId`: Past round results
- `POST /api/game/bet`: Bet placement
- `GET /api/admin/users`: User management
- `POST /api/admin/wallet/adjust`: Admin wallet credit/debit
- `GET /api/admin/reports/turnover`: Aggregated turnover statistics
- `GET /api/admin/config/rtp`: RTP and margin configuration
