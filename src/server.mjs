import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import { Durak } from "./lib/durak.mts";

// Сервер запускается обычным Node.js; createRequire позволяет загрузить
// CommonJS-модуль boardgame.io/server из ES-модуля.
const require = createRequire(import.meta.url);
const { Server } = require("boardgame.io/server");
// В локальной сети браузер может открыть сайт через IPv4-адрес компьютера.
// Добавляем такие адреса к разрешённым источникам, если список не задан
// явно через CLIENT_ORIGIN.
const lanOrigins = Object.values(networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .filter((address) => address.family === "IPv4" && !address.internal)
  .map((address) => `http://${address.address}:3000`);
const origins = (process.env.CLIENT_ORIGIN ?? ["http://localhost:3000", ...lanOrigins].join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
// boardgame.io хранит матчи в памяти процесса и обслуживает как лобби API,
// так и игровые подключения; PORT задаётся платформой или равен 3101.
const server = Server({
  games: [Durak],
  origins,
  apiOrigins: origins,
});

await server.run(Number(process.env.PORT ?? 3101));
