"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Wallet, Shield, CheckCircle, XCircle, Loader2, ExternalLink } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface WalletConnectProps {
  onAuthSuccess: (user: any, token: string) => void
}

declare global {
  interface Window {
    ethereum?: any
  }
}

export default function WalletConnect({ onAuthSuccess }: WalletConnectProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [nftStatus, setNftStatus] = useState<{
    hasNFT: boolean
    balance: number
    checked: boolean
    networks: Array<{ name: string; balance: number; contractAddress: string }>
    details: any
  }>({ hasNFT: false, balance: 0, checked: false, networks: [], details: null })
  const [error, setError] = useState("")
  const [isClient, setIsClient] = useState(false)

  const { toast } = useToast()

  const NFT_CONTRACT_MONAD = "0xC1C4d4A5A384DE53BcFadB43D0e8b08966195757"
  const NFT_CONTRACT_BASE = "0x8cf392D33050F96cF6D0748486490d3dEae52564"
  const MONAD_TESTNET_CHAIN_ID = "0x15B3"

  useEffect(() => {
    setIsClient(true)
  }, [])

  const verifyNFTOwnership = useCallback(
    async (address: string) => {
      setIsVerifying(true)
      try {
        const response = await fetch("/api/auth/verify-nft", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ walletAddress: address }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || "Failed to verify NFT ownership")
        }

        setNftStatus({
          hasNFT: data.hasNFT,
          balance: data.balance,
          checked: true,
          networks: data.networks || [],
          details: data.details,
        })

        if (data.hasNFT) {
          const networksList = data.networks?.map((n: any) => `${n.name} (${n.balance})`).join(", ") || ""
          toast({
            title: "NFT Verified ✅",
            description: `Found ${data.balance} NFT(s) on: ${networksList}`,
          })
        } else {
          toast({
            title: "No NFT Found ❌",
            description: "You need to own an NFT from the authorized collections",
            variant: "destructive",
          })
        }
      } catch (error: any) {
        console.error("Error verifying NFT:", error)
        setError(error.message)
        setNftStatus({ hasNFT: false, balance: 0, checked: true, networks: [], details: null })
      } finally {
        setIsVerifying(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    if (!isClient) return

    const checkWalletConnection = async () => {
      if (window.ethereum) {
        try {
          const accounts = await window.ethereum.request({ method: "eth_accounts" })
          if (accounts.length > 0) {
            setWalletAddress(accounts[0])
            await verifyNFTOwnership(accounts[0])
          }
        } catch (error) {
          console.error("Error checking wallet connection:", error)
        }
      }
    }

    checkWalletConnection()
  }, [isClient, verifyNFTOwnership])

  useEffect(() => {
    if (!isClient || !window.ethereum) return

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setWalletAddress(null)
        setNftStatus({ hasNFT: false, balance: 0, checked: false, networks: [], details: null })
        toast({
          title: "Wallet Disconnected",
          description: "Please connect your wallet again",
        })
      } else if (accounts[0] !== walletAddress) {
        setWalletAddress(accounts[0])
        verifyNFTOwnership(accounts[0])
        toast({
          title: "Account Changed",
          description: `Switched to ${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)}`,
        })
      }
    }

    const handleChainChanged = () => {
      window.location.reload()
    }

    const handleDisconnect = () => {
      setWalletAddress(null)
      setNftStatus({ hasNFT: false, balance: 0, checked: false, networks: [], details: null })
    }

    window.ethereum.on("accountsChanged", handleAccountsChanged)
    window.ethereum.on("chainChanged", handleChainChanged)
    window.ethereum.on("disconnect", handleDisconnect)

    return () => {
      if (window.ethereum.removeListener) {
        window.ethereum.removeListener("accountsChanged", handleAccountsChanged)
        window.ethereum.removeListener("chainChanged", handleChainChanged)
        window.ethereum.removeListener("disconnect", handleDisconnect)
      }
    }
  }, [isClient, walletAddress, verifyNFTOwnership, toast])

  const switchToMonadTestnet = async () => {
    if (!window.ethereum) {
      throw new Error("MetaMask is not available")
    }

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: MONAD_TESTNET_CHAIN_ID }],
      })
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: MONAD_TESTNET_CHAIN_ID,
                chainName: "Monad Testnet",
                nativeCurrency: {
                  name: "MON",
                  symbol: "MON",
                  decimals: 18,
                },
                rpcUrls: ["https://testnet-rpc.monad.xyz"],
                blockExplorerUrls: ["https://testnet-explorer.monad.xyz"],
              },
            ],
          })
        } catch (addError) {
          throw new Error("Failed to add Monad Testnet to MetaMask")
        }
      } else if (switchError.code === 4001) {
        throw new Error("User rejected network switch")
      } else {
        throw new Error("Failed to switch to Monad Testnet")
      }
    }
  }

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

      await switchToMonadTestnet()
      await verifyNFTOwnership(account)

      toast({
        title: "Wallet Connected",
        description: `Connected to ${account.slice(0, 6)}...${account.slice(-4)}`,
      })
    } catch (error: any) {
      console.error("Error connecting wallet:", error)
      const errorMessage = error.message || "Failed to connect wallet"
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

  const authenticateWithNFT = async () => {
    if (!walletAddress || !nftStatus.hasNFT) {
      setError("Wallet not connected or NFT not found")
      return
    }

    if (!window.ethereum) {
      setError("MetaMask is not available")
      return
    }

    setIsVerifying(true)
    setError("")

    try {
      const message = `Login to OSINT HUB with wallet: ${walletAddress}`

      const signature = await window.ethereum.request({
        method: "personal_sign",
        params: [message, walletAddress],
      })

      const response = await fetch("/api/auth/nft-auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          walletAddress,
          signature,
          message,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Authentication failed")
      }

      onAuthSuccess(data.user, data.token)

      toast({
        title: "Access Granted 🎉",
        description: "Welcome to OSINT HUB, NFT holder!",
      })
    } catch (error: any) {
      console.error("Authentication error:", error)
      const errorMessage = error.message || "Authentication failed"
      setError(errorMessage)
      toast({
        title: "Authentication Failed",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsVerifying(false)
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
          NFT ACCESS CONTROL
        </CardTitle>
        <CardDescription className="text-center text-muted-foreground">
          Connect your wallet to verify NFT ownership
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
            </div>
          )}
        </div>

        {walletAddress && (
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-background/30 rounded border border-primary/20">
              <span className="text-sm text-muted-foreground">NFT Status:</span>
              {isVerifying ? (
                <Badge variant="outline" className="border-yellow-500 text-yellow-400">
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Checking...
                </Badge>
              ) : nftStatus.checked ? (
                nftStatus.hasNFT ? (
                  <Badge variant="outline" className="border-green-500 text-green-400">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Verified ({nftStatus.balance})
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-red-500 text-red-400">
                    <XCircle className="w-3 h-3 mr-1" />
                    Not Found
                  </Badge>
                )
              ) : (
                <Badge variant="outline" className="border-gray-500 text-gray-400">
                  Not Checked
                </Badge>
              )}
            </div>

            <div className="text-xs text-muted-foreground bg-background/30 p-3 rounded border border-primary/20">
              <p className="mb-3">
                <strong>Required NFT Contracts:</strong>
              </p>

              <div className="mb-3 pb-2 border-b border-primary/10">
                <div className="flex items-center justify-between mb-1">
                  <code className="text-primary text-xs">
                    {NFT_CONTRACT_MONAD.slice(0, 10)}...{NFT_CONTRACT_MONAD.slice(-8)}
                  </code>
                  <a
                    href={`https://testnet-explorer.monad.xyz/address/${NFT_CONTRACT_MONAD}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/80"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-xs">Network: Monad Testnet</p>
                {nftStatus.details?.monad && (
                  <p className="text-xs text-green-400">Balance: {nftStatus.details.monad.balance} NFT(s)</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <code className="text-primary text-xs">
                    {NFT_CONTRACT_BASE.slice(0, 10)}...{NFT_CONTRACT_BASE.slice(-8)}
                  </code>
                  <a
                    href={`https://basescan.org/address/${NFT_CONTRACT_BASE}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/80"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-xs">Network: Base Mainnet</p>
                {nftStatus.details?.base && (
                  <p className="text-xs text-green-400">Balance: {nftStatus.details.base.balance} NFT(s)</p>
                )}
              </div>
            </div>

            {nftStatus.hasNFT && (
              <Button
                onClick={authenticateWithNFT}
                disabled={isVerifying}
                className="w-full bg-green-600 hover:bg-green-700 text-white cyber-glow"
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  <>
                    <Shield className="mr-2 h-4 w-4" />
                    Access OSINT HUB
                  </>
                )}
              </Button>
            )}

            {nftStatus.checked && !nftStatus.hasNFT && (
              <Alert className="bg-yellow-900/50 border-yellow-700">
                <AlertDescription className="text-yellow-200">
                  You need to own an NFT from one of the authorized collections (Monad Testnet or Base Mainnet) to
                  access this service. Please acquire an NFT and try again.
                </AlertDescription>
              </Alert>
            )}
          </div>
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
