import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import { Durak } from "./lib/durak.mts";

const require = createRequire(import.meta.url);
const { Server } = require("boardgame.io/server");
const lanOrigins = Object.values(networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .filter((address) => address.family === "IPv4" && !address.internal)
  .map((address) => `http://${address.address}:3000`);
const origins = (process.env.CLIENT_ORIGIN ?? ["http://localhost:3000", ...lanOrigins].join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const server = Server({
  games: [Durak],
  origins,
  apiOrigins: origins,
});

await server.run(Number(process.env.PORT ?? 3101));
