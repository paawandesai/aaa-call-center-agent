import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Meridian automated assistant (demo)",
  description: "Prototype AI call center assistant for a fictional HVAC and plumbing company.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <aside aria-label="Demo notice" className="banner">
          <span className="label">Demo</span>
          <span>Synthetic data only. Meridian Home Comfort is a fictional company. Please don&apos;t enter real personal information.</span>
        </aside>
        {children}
      </body>
    </html>
  );
}
