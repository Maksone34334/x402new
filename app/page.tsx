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
      setError("Введите запрос (имя / телефон / email)")
      return
    }

    if (!walletAddress) {
      setError("Подключите кошелёк, чтобы оплатить запрос")
      return
    }

    if (!x402Fetch) {
      setError("Не удалось инициализировать x402 оплату (проверьте подключение кошелька)")
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
        title: "Готово",
        description: `Найдено источников: ${Object.keys(data.List || {}).length}`,
      })
    } catch (error: any) {
      const errorMsg = error.message
      setError(errorMsg)

      toast({
        title: "Ошибка",
        description: errorMsg,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Background Grid */}
      <div className="absolute inset-0 cyber-grid opacity-30"></div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between p-6 border-b border-primary/20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold">
            OSINT<span className="text-primary">MINI</span>
          </span>
        </div>

        {walletAddress && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-primary text-primary">
              {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </Badge>
            <Badge className="bg-green-600 text-white">connected</Badge>
          </div>
        )}
      </header>

      {/* Main Content */}
      <div className="relative z-10 p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="text-center mb-8">
            <h1 className="text-4xl md:text-6xl font-bold mb-4">
              OSINT <span className="text-primary">MINI</span>
            </h1>
            <p className="text-gray-400 text-lg">
              Оплата за запрос по протоколу x402 (Coinbase) — $0.30 за запрос
            </p>
          </div>

          <div className="max-w-md mx-auto">
            <WalletConnect onWalletChange={setWalletAddress} />
          </div>

          <div className="max-w-md mx-auto">
            <Alert className="bg-background/30 border-primary/20">
              <AlertDescription className="text-muted-foreground">
                <div className="text-xs space-y-1">
                  <div>
                    <span className="text-primary">Wallet chainId:</span>{" "}
                    <span>{chainIdHex || "unknown"}</span> (Base Mainnet = <code>0x2105</code>)
                  </div>
                  <div>
                    <span className="text-primary">USDC on Base (0x8335…):</span>{" "}
                    <span>{baseUsdcBalance ?? "unknown"}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Если тут USDC = 0 или chainId не <code>0x2105</code>, facilitator вернёт{" "}
                    <code>insufficient_balance</code>.
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          </div>

          {/* OSINT Terminal */}
          <Card className="bg-card/90 border-primary/30 backdrop-blur-sm cyber-glow">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2 text-primary">
                <Shield className="w-5 h-5" />
                <CardTitle className="text-lg">ЗАПРОС</CardTitle>
              </div>
              <CardDescription className="text-muted-foreground">
                Введите имя / телефон / email и нажмите “Отправить”. Система запросит оплату $0.30 через x402.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    placeholder="Введите имя, телефон или email..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="bg-input border-primary/30 text-foreground placeholder-muted-foreground"
                    onKeyPress={(e) => e.key === "Enter" && makeSearch()}
                    disabled={false}
                  />
                </div>
                <Button
                  onClick={makeSearch}
                  disabled={isLoading}
                  className="bg-primary hover:bg-primary/90 text-white cyber-glow px-8"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      Отправить
                    </>
                  )}
                </Button>
              </div>

              <div className="text-sm text-muted-foreground">
                <span className="text-primary">Примеры:</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {["example@email.com", "google.com", "8.8.8.8", "@username"].map((example) => (
                    <Badge
                      key={example}
                      variant="outline"
                      className="border-primary/30 text-primary cursor-pointer hover:bg-primary/10"
                      onClick={() => setQuery(example)}
                    >
                      {example}
                    </Badge>
                  ))}
                </div>
              </div>

              {error && (
                <Alert variant="destructive" className="bg-blue-900/50 border-blue-700">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* x402/wallet gating disabled for MVP */}
            </CardContent>
          </Card>

              {/* Results */}
              {apiResponse && (
                <Card className="bg-card/90 border-primary/30 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-primary">Результат</CardTitle>
                    <CardDescription className="text-muted-foreground">
                      Источников: {Object.keys(apiResponse.List).length}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {Object.entries(apiResponse.List).map(([dbName, dbData]) => (
                        <Card key={dbName} className="bg-secondary/50 border-primary/20">
                          <CardHeader>
                            <CardTitle className="text-lg text-primary">{dbName}</CardTitle>
                            <CardDescription className="text-muted-foreground">{dbData.InfoLeak}</CardDescription>
                          </CardHeader>
                          <CardContent>
                            {dbData.Data && dbData.Data.length > 0 ? (
                              <div className="space-y-2">
                                {dbData.Data.slice(0, 5).map((item, index) => (
                                  <div key={index} className="p-3 bg-background/50 rounded border border-primary/10">
                                    {Object.entries(item).map(([key, value]) => (
                                      <div key={key} className="flex justify-between py-1">
                                        <span className="font-medium text-primary">{key}:</span>
                                        <span className="text-foreground break-all">{String(value)}</span>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                                {dbData.Data.length > 5 && (
                                  <p className="text-sm text-muted-foreground text-center">
                                    ... and {dbData.Data.length - 5} more records
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-muted-foreground">No intelligence found in this source</p>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
                {[
                  {
                    icon: Globe,
                    title: "Live OSINT API",
                    desc: "Real intelligence database access",
                  },
                  {
                    icon: Zap,
                    title: "x402 Payments",
                    desc: "$0.30 per request (USDC on Base)",
                  },
                  {
                    icon: Lock,
                    title: "Secure Platform",
                    desc: "Professional OSINT capabilities",
                  },
                ].map((feature, index) => (
                  <Card
                    key={feature.title}
                    className="bg-card/80 border-primary/20 backdrop-blur-sm hover:border-primary/40 transition-all"
                  >
                    <CardContent className="p-6 text-center">
                      <feature.icon className="w-12 h-12 text-primary mx-auto mb-4" />
                      <h3 className="text-xl font-bold mb-2 text-white">{feature.title}</h3>
                      <p className="text-gray-400 text-sm">{feature.desc}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 text-center py-6 text-xs text-gray-500">
        © 2025 OSINT MINI • x402 PAY-PER-QUERY
      </footer>
    </div>
  )
}
