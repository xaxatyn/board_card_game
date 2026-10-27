import { createRequire } from "node:module";
import { Durak } from "./lib/durak.mts";

const require = createRequire(import.meta.url);
const { Server } = require("boardgame.io/server");
const origins = (process.env.CLIENT_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const server = Server({
  games: [Durak],
  origins,
  apiOrigins: origins,
});

await server.run(Number(process.env.PORT ?? 3101));
