import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

// Разрешает открыть dev-сервер Next.js с другого устройства в этой же
// сети Wi-Fi, используя IPv4-адрес машины-разработчика.
const lanAddresses = Object.values(networkInterfaces()).flatMap(
  (addresses) =>
    addresses
      ?.filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => address.address) ?? [],
);

const nextConfig: NextConfig = {
  allowedDevOrigins: lanAddresses,
  turbopack: {
    rules: {
      // Подключает обработчик Tailwind CSS v4 при сборке Turbopack.
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
