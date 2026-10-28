import type { Metadata } from "next";
import "./globals.css";

// Метаданные корневого сегмента отображаются браузером и поисковыми системами.
export const metadata: Metadata = {
  title: "Durak — House Rules",
  description: "A local pass-and-play Durak card game for 2–6 players.",
};

// Обязательная корневая оболочка App Router; страница игры вставляется
// внутрь body через children.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
