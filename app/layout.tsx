import type React from "react"
import type { Metadata } from "next"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import { Providers } from "./providers"
import { MiniAppReady } from "@/components/miniapp-ready"

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
  "https://base-mini-app-flame.vercel.app"
const APP_NAME = "OSINT Mini"

export const metadata: Metadata = {
  title: "OSINT Mini - Base App",
  description: "Professional OSINT intelligence platform built on Base",
  generator: "Base Mini App",
  metadataBase: new URL(APP_URL),
  openGraph: {
    title: "OSINT Mini - Base App",
    description: "Professional OSINT intelligence platform built on Base",
    images: [`${APP_URL}/images/osint-identity-card.png`],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "OSINT Mini - Base App",
    description: "Professional OSINT intelligence platform built on Base",
    images: [`${APP_URL}/images/osint-identity-card.png`],
  },
  other: {
    // Base verify
    "base:app_id": "693b26d88a7c4e55fec73e9e",
    // Required for Mini App rich embeds + launch
    "fc:miniapp": JSON.stringify({
      version: "next",
      imageUrl: `${APP_URL}/images/osint-identity-card.png`,
      button: {
        title: `Launch ${APP_NAME}`,
        action: {
          type: "launch_miniapp",
          name: APP_NAME,
          url: APP_URL,
          splashImageUrl: `${APP_URL}/images/osint-identity-card.png`,
          splashBackgroundColor: "#000000",
        },
      },
    }),
    "fc:frame": JSON.stringify({
      version: "next",
      imageUrl: `${APP_URL}/images/osint-identity-card.png`,
      button: {
        title: `Launch ${APP_NAME}`,
        action: {
          type: "launch_frame",
          name: APP_NAME,
          url: APP_URL,
        },
      },
    }),
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon.png" />
        <meta name="theme-color" content="#0052FF" />
        <meta name="base-mini-app" content="true" />
        <meta name="base:app_id" content="693b26d88a7c4e55fec73e9e" />
      </head>
      <body>
        <MiniAppReady />
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  )
}
