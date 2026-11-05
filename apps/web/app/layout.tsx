import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../styles/app.css";
import "../styles/landing.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "TAME",
  description: "Teach Agents My Examples",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
