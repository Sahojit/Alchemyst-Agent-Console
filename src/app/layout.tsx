import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alchemyst Agent Console",
  description: "Streaming agent console over WebSocket",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
