import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Durak — House Rules",
  description: "A local pass-and-play Durak card game for 2–6 players.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
