import type { Metadata } from "next";
import "./globals.css";
import { DEFAULT_THEME, THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "CIPHER",
  description:
    "A synthetic-data investigative intelligence platform for demonstrating evidence ingestion, entity resolution, relationship analysis, spatial/temporal corroboration, grounded investigation assistance, and report generation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        {/*
          Applies the viewer's stored theme before first paint. Without it
          the document renders once in the default palette and then swaps,
          which on a dark-first operational UI reads as a flash of white.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
