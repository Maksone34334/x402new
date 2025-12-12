import { type NextRequest, NextResponse } from "next/server"
import { getAuthHeaders } from "@coinbase/cdp-sdk/auth"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const apiKeyId = process.env.CDP_API_KEY_ID
    const apiKeySecret = process.env.CDP_API_KEY_SECRET
    const walletSecret = process.env.CDP_WALLET_SECRET

    if (!apiKeyId || !apiKeySecret || !walletSecret) {
      return NextResponse.json({ error: "CDP credentials are not configured" }, { status: 500 })
    }

    const body = await request.json()

    const headers = await getAuthHeaders({
      apiKeyId,
      apiKeySecret,
      walletSecret,
      requestMethod: "POST",
      requestHost: "api.cdp.coinbase.com",
      requestPath: "/platform/v2/x402/settle",
      requestBody: body,
    })

    const resp = await fetch("https://api.cdp.coinbase.com/platform/v2/x402/settle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    })

    const text = await resp.text()
    return new NextResponse(text, {
      status: resp.status,
      headers: {
        "Content-Type": resp.headers.get("content-type") || "application/json",
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}



