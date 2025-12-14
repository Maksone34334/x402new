"use client"

import { useEffect } from "react"
import { sdk } from "@farcaster/miniapp-sdk"

export function MiniAppReady() {
  useEffect(() => {
    // Base Mini App requirement: hide splash screen as soon as app is ready to display.
    sdk.actions.ready().catch(() => {
      // Ignore: in non-miniapp contexts this may fail.
    })
  }, [])

  return null
}


