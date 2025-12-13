import type React from "react"
import type { Metadata } from "next"
import "./globals.css"
import { Providers } from "./providers"

const APP_URL = "https://base-mini-app-flame.vercel.app"
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
    // BASE VERIFY
    "base:app_id": "693b26d88a7c4e55fec73e9e",
  },
}

 
