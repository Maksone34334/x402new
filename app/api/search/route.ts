import { type NextRequest, NextResponse } from "next/server"
import { authenticatedUserLimiter } from "@/lib/rate-limiter"
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server"
import { x402HTTPResourceServer, decodePaymentRequiredHeader, decodePaymentSignatureHeader, type HTTPAdapter, type HTTPRequestContext } from "@x402/core/http"
import { ExactEvmScheme } from "@x402/evm/exact/server"

export const dynamic = "force-dynamic"

const API_TOKEN = process.env.OSINT_API_TOKEN
const X402_PRICE = process.env.X402_PRICE || "$0.15"
const X402_NETWORK = (process.env.X402_NETWORK || "eip155:8453") as any

function makeNextAdapter(request: NextRequest): HTTPAdapter {
  return {
    getHeader: (name: string) => request.headers.get(name) ?? undefined,
    getMethod: () => request.method,
    getPath: () => request.nextUrl.pathname,
    getUrl: () => request.url,
    getAcceptHeader: () => request.headers.get("accept") || "*/*",
    getUserAgent: () => request.headers.get("user-agent") || "",
  }
}

let httpServerPromise: Promise<x402HTTPResourceServer> | null = null
async function getHttpServer(origin: string): Promise<x402HTTPResourceServer> {
  if (httpServerPromise) return httpServerPromise

  // Receiver address for USDC on Base.
  // - Prefer correctly spelled env var: EVM_ADDRESS
  // - Support common typo: EVM_ADRESS
  // - Fall back to the default receiver address used by this project
  const payTo =
    process.env.EVM_ADDRESS ||
    process.env.EVM_ADRESS ||
    "0x69D51B18C1EfE88A9302a03A60127d98eD3D307D"

  const rawFacilitatorUrl = process.env.FACILITATOR_URL
  const originUrl = new URL(origin)
  let facilitatorBaseUrl = rawFacilitatorUrl
    ? rawFacilitatorUrl.startsWith("/") // allow relative facilitator url (recommended for dev)
      ? `${origin}${rawFacilitatorUrl}`
      : rawFacilitatorUrl
    : `${origin}/api/x402`

  // Dev-safety: if FACILITATOR_URL points to localhost on a different port than current origin,
  // prefer current origin to avoid accidental 404s (e.g. dev server moved to 3001).
  try {
    const f = new URL(facilitatorBaseUrl)
    if (
      (f.hostname === "localhost" || f.hostname === "127.0.0.1") &&
      (originUrl.hostname === "localhost" || originUrl.hostname === "127.0.0.1") &&
      f.port !== originUrl.port
    ) {
      facilitatorBaseUrl = `${origin}/api/x402`
    }
  } catch {
    // ignore parse errors for non-absolute urls
  }

  const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorBaseUrl })
  const resourceServer = new x402ResourceServer(facilitatorClient).register("eip155:*" as any, new ExactEvmScheme())

  const routes = {
    "POST /api/search": {
      accepts: {
        scheme: "exact",
        price: X402_PRICE,
        network: X402_NETWORK,
        payTo,
      },
      description: "OSINT search (paid)",
      mimeType: "application/json",
      unpaidResponseBody: () => ({
        contentType: "application/json",
        body: { error: "Payment required", price: X402_PRICE },
      }),
    },
  } as const

  const httpServer = new x402HTTPResourceServer(resourceServer, routes)
  httpServerPromise = (async () => {
    try {
      await httpServer.initialize()
      return httpServer
    } catch (err) {
      // Allow retries if initialization failed (e.g., wrong FACILITATOR_URL/port)
      httpServerPromise = null
      throw err
    }
  })()

  return httpServerPromise
}

async function runLeakOsint(request: NextRequest) {
  if (!API_TOKEN) {
    return NextResponse.json(
      {
        error: "Service temporarily unavailable",
        message: "OSINT API is not configured. Please contact administrator.",
      },
      { status: 503 },
    )
  }

  const body = await request.json()
  const { request: query, limit = 100, lang = "ru" } = body

  if (!query) {
    return NextResponse.json({ error: "Search query is required" }, { status: 400 })
  }

  // Mirror LeakOSINT reference behavior: only first line is used
  const safeQuery = String(query).split("\n")[0]

  const requestPayload = {
    token: API_TOKEN,
    request: safeQuery,
    limit,
    lang,
    type: "json",
  }

  const apiResponse = await fetch("https://leakosintapi.com/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestPayload),
  })

  if (!apiResponse.ok) {
    const errorMessage = `OSINT API returned status ${apiResponse.status}`
    throw new Error(errorMessage)
  }

  const data = await apiResponse.json()

  if (data["Error code"]) {
    const errorMessage = `OSINT API Error: ${data["Error code"]}`

    if (data["Error code"] === "bad token") {
      return NextResponse.json(
        {
          error: "Invalid API Token",
          message: "The OSINT API token is invalid or expired.",
        },
        { status: 401 },
      )
    }

    return NextResponse.json({ error: errorMessage }, { status: 400 })
  }

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  try {
    // Basic per-user-ish limit: with x402, the buyer wallet is embedded in the payment payload,
    // but for simplicity we limit per IP-ish key here. If you want per-wallet, we can parse PAYMENT-SIGNATURE.
    const rateLimitKey = request.headers.get("x-forwarded-for") || "unknown"
    const rateLimitResult = authenticatedUserLimiter.checkLimit(rateLimitKey)

    if (!rateLimitResult.allowed) {
      const resetDate = new Date(rateLimitResult.resetTime)
      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          message: `Too many requests. Limit resets at ${resetDate.toISOString()}`,
          resetTime: rateLimitResult.resetTime,
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": "30",
            "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
            "X-RateLimit-Reset": rateLimitResult.resetTime.toString(),
          },
        },
      )
    }

    const origin = request.headers.get("origin") || request.nextUrl.origin
    const httpServer = await getHttpServer(origin)

    const adapter = makeNextAdapter(request)
    const ctx: HTTPRequestContext = {
      adapter,
      path: adapter.getPath(),
      method: adapter.getMethod(),
    }

    const processResult = await httpServer.processHTTPRequest(ctx, {
      appName: "OSINT Mini",
      testnet: false,
      currentUrl: request.url,
    })

    if (processResult.type === "payment-error") {
      const r = processResult.response
      // Enrich error body with decoded x402 context (helps debug "insufficient_balance", etc.)
      const bodyObj: any = (r.body && typeof r.body === "object") ? r.body : {}
      const paymentRequiredHeader = r.headers?.["PAYMENT-REQUIRED"] || r.headers?.["payment-required"]
      if (paymentRequiredHeader) {
        try {
          bodyObj.x402_payment_required = decodePaymentRequiredHeader(paymentRequiredHeader)
        } catch {
          bodyObj.x402_payment_required = "failed_to_decode"
        }
      }
      const paymentSigHeader = request.headers.get("payment-signature") || request.headers.get("PAYMENT-SIGNATURE")
      if (paymentSigHeader) {
        try {
          bodyObj.x402_payment_signature = decodePaymentSignatureHeader(paymentSigHeader)
        } catch {
          bodyObj.x402_payment_signature = "failed_to_decode"
        }
      }

      const resp = new NextResponse(JSON.stringify(bodyObj), {
        status: r.status,
        headers: {
          ...r.headers,
          "Content-Type": r.isHtml ? "text/html" : "application/json",
        },
      })
      resp.headers.set("X-RateLimit-Limit", "30")
      resp.headers.set("X-RateLimit-Remaining", rateLimitResult.remaining.toString())
      resp.headers.set("X-RateLimit-Reset", rateLimitResult.resetTime.toString())
      return resp
    }

    // Either no-payment-required or payment-verified -> run the underlying handler.
    const apiResp = await runLeakOsint(request)

    // If payment was verified, settle and attach PAYMENT-RESPONSE headers.
    if (processResult.type === "payment-verified") {
      const settle = await httpServer.processSettlement(processResult.paymentPayload, processResult.paymentRequirements)
      if (settle.success) {
        for (const [k, v] of Object.entries(settle.headers)) {
          apiResp.headers.set(k, v)
        }
      }
    }

    apiResp.headers.set("X-RateLimit-Limit", "30")
    apiResp.headers.set("X-RateLimit-Remaining", rateLimitResult.remaining.toString())
    apiResp.headers.set("X-RateLimit-Reset", rateLimitResult.resetTime.toString())
    return apiResp
  } catch (error: any) {
    // Provide high-signal debugging info to client (safe: no secrets)
    const message = error?.message || "Internal server error"
    const name = error?.name
    const details =
      error?.errors && Array.isArray(error.errors)
        ? error.errors
        : undefined
    return NextResponse.json(
      {
        error: "Internal server error",
        message,
        name,
        debug: details,
        hint: "Failed to process search request",
      },
      { status: 500 },
    )
  }
}
