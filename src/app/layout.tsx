import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { SideRail } from "@/components/SideRail";
import { TopBar } from "@/components/TopBar";
import { Toaster } from "@/components/Toaster";
import { ASSETS } from "@/lib/assets";
import { THEME_SCRIPT } from "@/lib/theme";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? "http://localhost:3000"),
  title: {
    default: "PuffrPay",
    template: "%s — PuffrPay",
  },
  description: "Your fun money, on a leash.",
  icons: {
    icon: [
      { url: ASSETS.logoMark, media: "(prefers-color-scheme: dark)", type: "image/svg+xml" },
      { url: ASSETS.logoMarkLight, media: "(prefers-color-scheme: light)", type: "image/svg+xml" },
      { url: ASSETS.icon192, sizes: "192x192", type: "image/png" },
      { url: ASSETS.icon512, sizes: "512x512", type: "image/png" },
    ],
    apple: ASSETS.appleTouchIcon,
  },
  openGraph: {
    title: "PuffrPay",
    description: "Your fun money, on a leash.",
    images: [{ url: ASSETS.og, width: 1200, height: 630 }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#04080F" },
    { media: "(prefers-color-scheme: light)", color: "#F3F9FD" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="dark"
      // Font variables must live on :root — --sans is a :root token, so the
      // var() chain only resolves if the font vars are defined there too.
      className={`${jakarta.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Sets data-theme from localStorage / OS before first paint — no flash */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <SideRail />
        <div className="shell">
          <TopBar />
          {children}
        </div>
        <Toaster />
      </body>
    </html>
  );
}
