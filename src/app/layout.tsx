import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NetIntel AI",
  description:
    "A synthetic-data investigative intelligence platform for demonstrating evidence ingestion, entity resolution, relationship analysis, spatial/temporal corroboration, grounded investigation assistance, and report generation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
