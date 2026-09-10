import { Barlow, IBM_Plex_Mono, JetBrains_Mono } from "next/font/google";

const jetBrainsMono = JetBrains_Mono({
  // Next's adjusted Arial fallback widens uppercase controls enough to wrap
  // the mobile header. Use fixed-width fallback advances like the loaded face.
  adjustFontFallback: false,
  fallback: ["Courier New", "Courier", "monospace"],
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains",
});

const barlow = Barlow({
  fallback: ["Arial Narrow", "Arial", "sans-serif"],
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-barlow",
});

const plexMono = IBM_Plex_Mono({
  adjustFontFallback: false,
  fallback: ["Courier New", "Courier", "monospace"],
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

/* The root keeps JetBrains Mono for the operator console. The collector shell
 * opts into Barlow through its scoped token map in foundations.css. */
export const applicationFontVariables = `${jetBrainsMono.variable} ${barlow.variable} ${plexMono.variable}`;
