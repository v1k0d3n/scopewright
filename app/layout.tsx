import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scopewright",
  description: "Scopewright: scope, estimate, and document proof-of-concept engagements.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
