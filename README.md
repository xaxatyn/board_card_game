# Durak — House Rules

A 2–6 player Durak prototype with private hands, online rooms, computer seats, and five RPG-style roles. The game state and legal moves are managed by `boardgame.io`; a player receives only their own hand.

## Run locally

Use Node.js 22.18 or newer.

1. Start the game server in one terminal:

   ```bash
   npm run game-server
   ```

2. Start the web app in another terminal:

   ```bash
   npm run dev
   ```

3. Open `http://localhost:3000`, create a room, and share its room code. Each player opens the same site, enters the code, and joins a free seat. The game starts when all seats are occupied.

The local web app connects to `http://localhost:3101` by default. If that port is unavailable, choose another port by setting `PORT` for the game server and `NEXT_PUBLIC_GAME_SERVER_URL` for the web app to the same address; set `CLIENT_ORIGIN` on the game server to the comma-separated list of allowed web-app origins.

## Deploy to Render

The repository includes a Render Blueprint in [`render.yaml`](./render.yaml). In Render, create a Blueprint from this repository and deploy both services:

- `durak-app` — Next.js interface.
- `durak-game-server` — `boardgame.io` lobby and WebSocket server.

The default Blueprint URLs are `https://durak-app.onrender.com` and `https://durak-game-server.onrender.com`. If Render assigns different URLs, update `NEXT_PUBLIC_GAME_SERVER_URL` on the app service and `CLIENT_ORIGIN` on the game-server service, then redeploy.

The game server currently uses `boardgame.io`'s in-memory database. On Render's free plan, services can sleep and restart; active rooms are lost when the game server restarts. Persistent rooms and uninterrupted sessions require a persistent database and an always-on server.

## Rules included

- Attacks can contain multiple cards of one rank; only the defender's two neighbouring active seats may throw in.
- The defender selects the individual attack card that each defense card covers.
- Transfers can chain before any attack card is covered. A player with no cards can be returned by a transfer if they still have a return available.
- Taking the attack moves play to the next active player after the defender.
- Paladin blocks throw-ins by the next seat; Barbarian starts with eight cards and cannot return; Thief and Necromancer abilities have per-game limits; Reverse beats same-suit cards with a lower rank.
- Computer seats run as boardgame.io clients in the room creator's browser.

## Checks

```bash
npm run test:game
npm run lint
npx tsc --noEmit
npm run build
```
