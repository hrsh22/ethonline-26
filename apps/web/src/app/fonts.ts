import { JetBrains_Mono } from "next/font/google";

/* One face for both applications: JetBrains Mono carries headings, labels,
 * numerals and body alike, so a column of values and the label above it share
 * a rhythm. The semantic variables (`--font-sans`, `--font-mono`,
 * `--font-display`) are bound in foundations.css; this is only the loaded
 * family. */
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains",
});

export const applicationFontVariables = jetBrainsMono.variable;
