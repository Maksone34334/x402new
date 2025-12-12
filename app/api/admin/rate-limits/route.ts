import { type NextRequest, NextResponse } from "next/server"
import { authenticatedUserLimiter, regularUserLimiter } from "@/lib/rate-limiter"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Authorization required" }, { status: 401 })
    }

    const token = authHeader.substring(7)

    const sessionSecret = process.env.OSINT_SESSION_SECRET
    if (!sessionSecret) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    }

    if (!token || !token.startsWith(sessionSecret)) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    }

    if (!token.includes("admin") && !token.includes("jaguar")) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    const nftStats = authenticatedUserLimiter.getStats()
    const regularStats = regularUserLimiter.getStats()

    return NextResponse.json({
      success: true,
      rateLimits: {
        authenticatedUsers: {
          maxRequests: 200,
          windowMs: 3600000,
          activeWallets: nftStats.totalWallets,
          ...nftStats,
        },
        regularUsers: {
          maxRequests: 50,
          windowMs: 3600000,
          activeUsers: regularStats.totalWallets,
          ...regularStats,
        },
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
