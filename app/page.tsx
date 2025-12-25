"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Loader2,
  Search,
  Shield,
  Globe,
  Zap,
  Lock,
  AlertCircle,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import dynamic from "next/dynamic"
import type { ClientEvmSigner } from "@x402/evm"
import { x402Client, x402HTTPClient } from "@x402/fetch"
import { registerExactEvmScheme } from "@x402/evm/exact/client"

const WalletConnect = dynamic(() => import("@/components/wallet-connect"), {
  ssr: false,
})

interface ApiResponse {
  List: Record<
    string,
    {
      InfoLeak: string
      Data: Record<string, any>[]
    }
  >
}

interface OsintUser {
  id: string
  address: string
  role: string
  status: "active" | "pending" | "blocked"
  createdAt: string
}

export default function OSINTMini() {
  const [query, setQuery] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [apiResponse, setApiResponse] = useState<ApiResponse | null>(null)
  const [error, setError] = useState("")
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [chainIdHex, setChainIdHex] = useState<string | null>(null)
  const [baseUsdcBalance, setBaseUsdcBalance] = useState<string | null>(null)

  const { toast } = useToast()

  const PRICE_USD = 0.05
  const PRICE_STR = `$${PRICE_USD.toFixed(2)}`

  // Show actual connected chainId (to avoid confusion with wallet UI)
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return

    const refresh = async () => {
      try {
        const cid = (await window.ethereum.request({ method: "eth_chainId" })) as string
        setChainIdHex(cid)
      } catch {
        setChainIdHex(null)
      }
    }

    refresh()
    const handler = () => refresh()
    window.ethereum.on?.("chainChanged", handler)
    return () => window.ethereum.removeListener?.("chainChanged", handler)
  }, [])

  // Fetch USDC balance on Base MAINNET for the connected address (contract: 0x833589f...02913)
  useEffect(() => {
    const addr = walletAddress
    if (!addr) {
      setBaseUsdcBalance(null)
      return
    }

    const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    const BALANCE_OF_SELECTOR = "0x70a08231"
    const rpcUrls = [
      "https://mainnet.base.org",
      "https://base.gateway.tenderly.co",
      "https://base-rpc.publicnode.com",
    ]
    let rpcIndex = 0
    let backoffMs = 0

    const fetchBalance = async () => {
      try {
        if (backoffMs > 0) return
        const paddedAddress = addr.toLowerCase().replace(/^0x/, "").padStart(64, "0")
        const data = BALANCE_OF_SELECTOR + paddedAddress
        const rpcUrl = rpcUrls[rpcIndex % rpcUrls.length]
        rpcIndex++
        const resp = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_call",
            params: [{ to: USDC_BASE, data }, "latest"],
          }),
        })
        if (resp.status === 429) {
          backoffMs = 30000
          setTimeout(() => {
            backoffMs = 0
            fetchBalance()
          }, backoffMs)
          return
        }
        const json = await resp.json()
        if (!json?.result) {
          setBaseUsdcBalance(null)
          return
        }
        const raw = BigInt(json.result)
        // USDC has 6 decimals
        const denom = BigInt("1000000")
        const whole = raw / denom
        const frac = raw % denom
        const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "")
        setBaseUsdcBalance(fracStr ? `${whole.toString()}.${fracStr}` : whole.toString())
      } catch {
        setBaseUsdcBalance(null)
      }
    }

    fetchBalance()
    const t = setInterval(fetchBalance, 15000)
    return () => clearInterval(t)
  }, [walletAddress])

  const x402Fetch = useMemo(() => {
    if (!walletAddress) return null
    if (typeof window === "undefined") return null
    if (!window.ethereum) return null

    // Make BigInt JSON-safe for any downstream stringify operations
    if (typeof BigInt !== "undefined" && !(BigInt.prototype as any).toJSON) {
      ;(BigInt.prototype as any).toJSON = function () {
        return this.toString()
      }
    }

    type X402TypedData = {
      domain: Record<string, unknown>
      types: Record<string, unknown>
      primaryType: string
      message: Record<string, unknown>
    }

    const buildEip712DomainTypes = (domain: Record<string, unknown>) => {
      const fields: Array<{ name: string; type: string }> = []
      if (domain.name != null) fields.push({ name: "name", type: "string" })
      if (domain.version != null) fields.push({ name: "version", type: "string" })
      if (domain.chainId != null) fields.push({ name: "chainId", type: "uint256" })
      if (domain.verifyingContract != null) fields.push({ name: "verifyingContract", type: "address" })
      if (domain.salt != null) fields.push({ name: "salt", type: "bytes32" })
      return fields
    }

    const signer: ClientEvmSigner = {
      address: walletAddress as `0x${string}`,
      signTypedData: async (typedData: X402TypedData) => {
        // Some wallets require EIP712Domain to be explicitly present in types for v4.
        const domainTypes = buildEip712DomainTypes(typedData.domain)
        const types =
          "EIP712Domain" in typedData.types
            ? typedData.types
            : { EIP712Domain: domainTypes, ...typedData.types }

        // Normalize chainId to number where possible (avoids inconsistent signing)
        const domain: any = { ...typedData.domain }
        if (domain.chainId != null && typeof domain.chainId === "string" && /^0x[0-9a-f]+$/i.test(domain.chainId)) {
          domain.chainId = Number.parseInt(domain.chainId, 16)
        }

        const payload = {
          domain,
          types,
          primaryType: typedData.primaryType,
          message: typedData.message,
        }

        const signature = await window.ethereum.request({
          method: "eth_signTypedData_v4",
          params: [walletAddress, JSON.stringify(payload)],
        })
        return signature as `0x${string}`
      },
    }

    const client = new x402Client()
    registerExactEvmScheme(client, { signer })
    const httpClient = new x402HTTPClient(client)

    // Same flow as wrapFetchWithPayment, but we keep it inline for clearer errors
    return async (input: RequestInfo, init?: RequestInit) => {
      const response = await fetch(input, init)
      if (response.status !== 402) return response

      const getHeader = (name: string) => response.headers.get(name)
      let body: any = undefined
      try {
        const responseText = await response.text()
        if (responseText) body = JSON.parse(responseText)
      } catch {
        body = undefined
      }

      const paymentRequired = httpClient.getPaymentRequiredResponse(getHeader, body)
      const paymentPayload = await client.createPaymentPayload(paymentRequired)
      const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload)

      if (!init) throw new Error("Missing fetch request configuration")
      if ((init as any).__is402Retry) throw new Error("Payment already attempted")

      const newInit: any = {
        ...init,
        headers: {
          ...(init.headers || {}),
          ...paymentHeaders,
          "Access-Control-Expose-Headers": "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE",
        },
        __is402Retry: true,
      }

      return await fetch(input, newInit)
    }
  }, [walletAddress])

  const makeSearch = async () => {
    if (!query.trim()) {
      setError("Enter a query (name / phone / email)")
      return
    }

    if (!walletAddress) {
      setError("Connect your wallet to pay for the request")
      return
    }

    if (!x402Fetch) {
      setError("Failed to initialize x402 payment (check your wallet connection)")
      return
    }

    setError("")
    setIsLoading(true)

    try {
      // Ensure wallet is on Base mainnet (8453 / 0x2105) for EIP-712 signing
      const expectedChainIdHex = "0x2105"
      const currentChainIdHex = (await window.ethereum?.request?.({ method: "eth_chainId" })) as string | undefined
      if (currentChainIdHex && currentChainIdHex.toLowerCase() !== expectedChainIdHex) {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: expectedChainIdHex }],
        })
      }

      const response = await x402Fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          request: query, // "Zapros"
          limit: 1000,
          lang: "en",
        }),
      })
      const rawText = await response.text()
      let data: any = null
      try {
        data = rawText ? JSON.parse(rawText) : null
      } catch {
        // non-JSON response
        data = null
      }

      if (!response.ok) {
        const details = data?.message || data?.error || rawText || ""
        throw new Error(details ? `${details}` : `HTTP ${response.status}`)
      }

      setApiResponse(data)

      toast({
        title: "Done",
        description: `Sources found: ${Object.keys(data.List || {}).length}`,
      })
    } catch (error: any) {
      const errorMsg = error.message
      setError(errorMsg)

      toast({
        title: "Error",
        description: errorMsg,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-[#2d6bff] relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 cyber-grid opacity-25" />
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,rgba(45,107,255,0.20),transparent_55%)]" />

      {/* Top-left brand */}
      <div className="relative z-10 px-10 pt-8 text-xs tracking-widest opacity-80">
        OSINTMINI
      </div>

      <div className="relative z-10 px-6 pb-10 pt-6">
        <div className="mx-auto w-full max-w-3xl">
          {/* Title */}
          <div className="text-center mb-6">
            <h1 className="text-5xl md:text-6xl font-bold tracking-[0.2em] drop-shadow-[0_0_12px_rgba(45,107,255,0.65)]">
              OSINT MINI
            </h1>
            <p className="mt-2 text-[11px] opacity-80 tracking-widest">
              PAYMENT FOR A REQUEST USING THE x402 PROTOCOL (COINBASE) IS {PRICE_STR} PER REQUEST
            </p>
          </div>

          {/* Main frame */}
          <div className="rounded-2xl border border-[#2d6bff]/60 bg-black/60 backdrop-blur-md shadow-[0_0_0_2px_rgba(45,107,255,0.20),0_0_50px_rgba(45,107,255,0.25)] overflow-hidden">
            {/* Wallet */}
            <div className="p-6 border-b border-[#2d6bff]/40">
              <div className="flex items-center justify-center gap-2 text-2xl font-bold">
                <Shield className="h-6 w-6" />
                <span>Wallet</span>
              </div>
              <div className="mt-1 text-center text-xs opacity-80">
                Connect your wallet to pay per request with x402
              </div>

              <div className="mt-4 max-w-md mx-auto">
                <WalletConnect onWalletChange={setWalletAddress} />
              </div>

              <div className="mt-4 max-w-md mx-auto">
                <Alert className="bg-black/40 border-[#2d6bff]/40 text-[#2d6bff]">
                  <AlertDescription className="text-[11px] leading-relaxed">
                    <div>
                      <span className="opacity-80">Wallet chainId:</span> {chainIdHex || "unknown"} (Base Mainnet ={" "}
                      <code>0x2105</code>)
                    </div>
                    <div>
                      <span className="opacity-80">USDC on Base (0x8335…):</span> {baseUsdcBalance ?? "unknown"}
                    </div>
                    <div className="opacity-75">
                      If USDC is 0 or chainId isn’t <code>0x2105</code>, the facilitator may return{" "}
                      <code>insufficient_balance</code>.
                    </div>
                  </AlertDescription>
                </Alert>
              </div>
            </div>

            {/* Disclaimer */}
            <div className="p-6 border-b border-[#2d6bff]/40">
              <div className="text-center text-xs font-bold tracking-widest text-red-500 mb-2">
                DISCLAIMER
              </div>
              <div className="mx-auto max-w-2xl text-[10px] leading-snug text-red-500/90">
                THIS APPLICATION ACTS SOLELY AS A TECHNICAL INTERFACE BETWEEN THE USER AND THIRD‑PARTY OPEN‑SOURCE
                INTELLIGENCE CONTENT/SERVICES. IT DOES NOT CREATE, HOST, OR CONTROL THE DATA PROVIDED BY THOSE EXTERNAL
                SOURCES AND CANNOT GUARANTEE THE ACCURACY, COMPLETENESS, OR LEGALITY OF ANY INFORMATION OBTAINED THROUGH
                THEM.
                <br />
                <br />
                THE SOLE PURPOSE OF THIS APPLICATION IS TO HELP USERS PROTECT THEMSELVES FROM POTENTIAL FRAUD, SCAMS,
                AND OTHER SECURITY RISKS BY SIMPLIFYING ACCESS TO INFORMATION THAT IS ALREADY AVAILABLE IN PUBLIC
                SOURCES. THE APPLICATION DOES NOT INTEND, PROMOTE, OR AUTHORIZE ILLEGAL, EXCESSIVE, OR HARMFUL USE OF
                SECURITY MEASURES, OR ANY OTHER UNLAWFUL ACTIVITY, AND MUST NOT BE USED FOR SUCH PURPOSES.
                <br />
                <br />
                USERS REMAIN FULLY RESPONSIBLE FOR HOW THEY SEARCH, ACCESS, INTERPRET, AND USE ANY INFORMATION OBTAINED
                THROUGH THIS APPLICATION, INCLUDING COMPLIANCE WITH ALL APPLICABLE LAWS (SUCH AS DATA PROTECTION,
                PRIVACY, AND INTELLECTUAL PROPERTY LAWS).
              </div>
            </div>

            {/* Request */}
            <div className="p-6">
              <div className="flex items-center gap-2 text-xl font-bold tracking-widest">
                <span className="opacity-80">○</span> REQUEST
              </div>
              <div className="mt-1 text-[11px] opacity-80">
                Enter your name/phone/email and click OSINT. The system will request payment of {PRICE_STR} via x402.
              </div>

              <div className="mt-4 flex gap-3 items-center">
                <Input
                  placeholder="ENTER YOUR NAME/PHONE/E‑MAIL"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="bg-black/40 border-[#2d6bff]/40 text-[#2d6bff] placeholder:text-[#2d6bff]/50"
                  onKeyPress={(e) => e.key === "Enter" && makeSearch()}
                  disabled={false}
                />
                <Button
                  onClick={makeSearch}
                  disabled={isLoading}
                  className="bg-transparent border border-[#2d6bff]/60 text-[#2d6bff] hover:bg-[#2d6bff]/10 px-6"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      OSINT
                    </>
                  )}
                </Button>
              </div>

              <div className="mt-3 text-[11px] opacity-80">
                EXAMPLE
                <div className="flex flex-wrap gap-2 mt-2">
                  {["example@email.com", "google.com", "8.8.8.8", "@username"].map((example) => (
                    <Badge
                      key={example}
                      variant="outline"
                      className="border-[#2d6bff]/40 text-[#2d6bff] cursor-pointer hover:bg-[#2d6bff]/10"
                      onClick={() => setQuery(example)}
                    >
                      {example}
                    </Badge>
                  ))}
                </div>
              </div>

              {error && (
                <Alert variant="destructive" className="mt-4 bg-black/50 border-red-500/60 text-red-400">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {apiResponse && (
                <div className="mt-6">
                  <Card className="bg-black/40 border-[#2d6bff]/30 backdrop-blur-sm">
                    <CardHeader>
                      <CardTitle className="text-[#2d6bff]">RESULT</CardTitle>
                      <CardDescription className="text-[#2d6bff]/70">
                        Sources: {Object.keys(apiResponse.List).length}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {Object.entries(apiResponse.List).map(([dbName, dbData]) => (
                          <Card key={dbName} className="bg-black/30 border-[#2d6bff]/20">
                            <CardHeader>
                              <CardTitle className="text-lg text-[#2d6bff]">{dbName}</CardTitle>
                              <CardDescription className="text-[#2d6bff]/70">{dbData.InfoLeak}</CardDescription>
                            </CardHeader>
                            <CardContent>
                              {dbData.Data && dbData.Data.length > 0 ? (
                                <div className="space-y-2">
                                  {dbData.Data.slice(0, 5).map((item, index) => (
                                    <div key={index} className="p-3 bg-black/40 rounded border border-[#2d6bff]/10">
                                      {Object.entries(item).map(([key, value]) => (
                                        <div key={key} className="flex justify-between gap-4 py-1">
                                          <span className="font-medium text-[#2d6bff]">{key}:</span>
                                          <span className="text-[#2d6bff]/90 break-all">{String(value)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ))}
                                  {dbData.Data.length > 5 && (
                                    <p className="text-[11px] text-[#2d6bff]/70 text-center">
                                      … and {dbData.Data.length - 5} more records
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <p className="text-[#2d6bff]/70">No intelligence found in this source</p>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
