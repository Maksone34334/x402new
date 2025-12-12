"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Wallet, Shield, XCircle, Loader2, CheckCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface WalletConnectProps {
  onWalletChange?: (address: string | null) => void
}

declare global {
  interface Window {
    ethereum?: any
  }
}

export default function WalletConnect({ onWalletChange }: WalletConnectProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [isClient, setIsClient] = useState(false)

  const { toast } = useToast()

  useEffect(() => {
    setIsClient(true)
  }, [])

  const syncWallet = useCallback(async () => {
    if (!window.ethereum) return

    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" })
      if (accounts.length > 0) {
        setWalletAddress(accounts[0])
        onWalletChange?.(accounts[0])
      } else {
        setWalletAddress(null)
        onWalletChange?.(null)
      }
    } catch (err) {
      console.error("Error syncing wallet:", err)
    }
  }, [onWalletChange])

  useEffect(() => {
    if (!isClient) return
    syncWallet()
  }, [isClient, syncWallet])

  useEffect(() => {
    if (!isClient || !window.ethereum) return

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setWalletAddress(null)
        onWalletChange?.(null)
        toast({
          title: "Wallet Disconnected",
          description: "Please connect your wallet again",
        })
      } else if (accounts[0] !== walletAddress) {
        setWalletAddress(accounts[0])
        onWalletChange?.(accounts[0])
        toast({
          title: "Account Changed",
          description: `Switched to ${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)}`,
        })
      }
    }

    const handleDisconnect = () => {
      setWalletAddress(null)
      onWalletChange?.(null)
    }

    window.ethereum.on("accountsChanged", handleAccountsChanged)
    window.ethereum.on("disconnect", handleDisconnect)

    return () => {
      if (window.ethereum.removeListener) {
        window.ethereum.removeListener("accountsChanged", handleAccountsChanged)
        window.ethereum.removeListener("disconnect", handleDisconnect)
      }
    }
  }, [isClient, walletAddress, toast, onWalletChange])

  const connectWallet = async () => {
    if (!window.ethereum) {
      setError("MetaMask is not installed. Please install MetaMask to continue.")
      toast({
        title: "MetaMask Not Found",
        description: "Please install MetaMask extension",
        variant: "destructive",
      })
      return
    }

    setIsConnecting(true)
    setError("")

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      })

      if (accounts.length === 0) {
        throw new Error("No accounts found")
      }

      const account = accounts[0]
      setWalletAddress(account)
      onWalletChange?.(account)

      toast({
        title: "Wallet Connected",
        description: `Connected to ${account.slice(0, 6)}...${account.slice(-4)}`,
      })
    } catch (err: any) {
      console.error("Error connecting wallet:", err)
      const errorMessage = err.message || "Failed to connect wallet"
      setError(errorMessage)
      toast({
        title: "Connection Failed",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsConnecting(false)
    }
  }

  if (!isClient) {
    return null
  }

  return (
    <Card className="w-full max-w-md bg-card/90 border-primary/30 backdrop-blur-sm cyber-glow">
      <CardHeader>
        <CardTitle className="text-center text-primary flex items-center justify-center gap-2">
          <Shield className="w-5 h-5" />
          Wallet
        </CardTitle>
        <CardDescription className="text-center text-muted-foreground">
          Connect your wallet to pay per request with x402
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive" className="bg-red-900/50 border-red-700">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          {!walletAddress ? (
            <Button
              onClick={connectWallet}
              disabled={isConnecting}
              className="w-full bg-primary hover:bg-primary/90 text-white cyber-glow"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Wallet className="mr-2 h-4 w-4" />
                  Connect Wallet
                </>
              )}
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-background/30 rounded border border-primary/20">
                <span className="text-sm text-muted-foreground">Wallet:</span>
                <Badge variant="outline" className="border-green-500 text-green-400">
                  {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                </Badge>
              </div>
              <div className="flex items-center justify-between p-3 bg-background/30 rounded border border-primary/20">
                <span className="text-sm text-muted-foreground">Status:</span>
                <Badge variant="outline" className="border-green-500 text-green-400">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Connected
                </Badge>
              </div>
            </div>
          )}
        </div>

        {walletAddress && (
          <Alert className="bg-green-900/30 border-green-700">
            <CheckCircle className="h-4 w-4" />
            <AlertDescription className="text-green-200">
              Wallet connected. You can create a paid request below.
            </AlertDescription>
          </Alert>
        )}

        {!window.ethereum && (
          <Alert className="bg-blue-900/50 border-blue-700">
            <AlertDescription className="text-blue-200">
              MetaMask is required to connect your wallet.{" "}
              <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Install MetaMask
              </a>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
