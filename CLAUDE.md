# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OSINT Mini is a Base Mini App (Farcaster mini app) providing OSINT intelligence tools with NFT-gated access. Built with Next.js 14, OnchainKit/MiniKit, and deployed on Vercel.

## Development Commands

```bash
# Install dependencies (uses pnpm)
pnpm install

# Development server
pnpm dev          # runs on http://localhost:3000

# Production build
pnpm build        # creates optimized production build
pnpm start        # starts production server

# Linting
pnpm lint
```

## Architecture

### Mini App Structure

This is a **Base Mini App** integrated with Farcaster. Key architectural patterns:

1. **Provider Setup** (`app/providers.tsx`)
   - Uses `MiniKitProvider` from `@coinbase/onchainkit/minikit`
   - Configured for Base chain with OnchainKit API key
   - Wraps entire app at root layout level

2. **Manifest & Discovery**
   - Farcaster manifest hosted by Farcaster API (not local)
   - `vercel.json` redirects `/.well-known/farcaster.json` to hosted manifest
   - `minikit.config.ts` contains account association and Base Builder config
   - Account association required for analytics and builder rewards

3. **Authentication Strategy**
   - Dual authentication: standard login + NFT-gated access
   - NFT verification checks ownership on both Base Mainnet and Monad Testnet
   - Session tokens include wallet address: `{secret}_nft_{address}_{timestamp}`
   - Rate limiting enforced per wallet address

### API Routes

**Auth Endpoints:**
- `/api/auth/login` - Standard username/password authentication
- `/api/auth/register` - User registration
- `/api/auth/nft-auth` - NFT ownership verification and authentication
- `/api/auth/verify-nft` - NFT balance checking

**Admin Endpoints:**
- `/api/admin/rate-limits` - Rate limit management
- `/api/admin/registrations` - User registration management

**Core Features:**
- `/api/search` - OSINT search functionality (rate-limited)

### NFT Access Control

**Contract Addresses:**
- Base Mainnet: `0x8cf392D33050F96cF6D0748486490d3dEae52564`
- Monad Testnet: `0xC1C4d4A5A384DE53BcFadB43D0e8b08966195757`

**NFT Verification Flow:**
1. Client signs message: `Login to OSINT HUB with wallet: {address}`
2. Server checks NFT balance via RPC calls (with fallback RPCs for Base)
3. If balance > 0 on either chain, access granted
4. Session token created with embedded wallet address

**Rate Limiting:**
- NFT holders: 30 requests/day (`nftHolderLimiter`)
- Regular users: 5 requests/day (`regularUserLimiter`)
- Implemented in `lib/rate-limiter.ts` with in-memory storage
- Automatic cleanup every 5 minutes

### Environment Variables

Required in `.env.local`:

```bash
# API Configuration
OSINT_API_TOKEN=              # OSINT service API token
OSINT_SESSION_SECRET=         # Session signing secret

# x402 / payments (USDC on Base)
# Receiver address for payments. Supports both EVM_ADDRESS and legacy typo EVM_ADRESS.
EVM_ADDRESS=0x69D51B18C1EfE88A9302a03A60127d98eD3D307D

# NFT Contract Addresses (read from .env but also hardcoded in code)
NFT_CONTRACT_ADDRESS_BASE=
NFT_CONTRACT_ADDRESS_MONAD=

# OnchainKit
NEXT_PUBLIC_ONCHAINKIT_API_KEY=   # Required for MiniKitProvider
NEXT_PUBLIC_ONCHAINKIT_PROJECT_NAME=
NEXT_PUBLIC_ICON_URL=
```

**Security Note:** Never commit `.env.local` - already in `.gitignore`

### Mini App Configuration

**`minikit.config.ts` structure:**
- `accountAssociation` - Required for Base Build integration (header, payload, signature)
- `baseBuilder.allowedAddresses` - Builder addresses for verification
- `miniapp` - App metadata (name, urls, categories, tags)

**Manifest redirect in `vercel.json`:**
- All Mini Apps must serve farcaster.json at `/.well-known/farcaster.json`
- This app redirects to Farcaster-hosted manifest
- Manifest includes frame metadata, account association, and builder config

## Key Implementation Details

### Base Mini App Integration
- Follow Base Mini App guidelines from https://docs.base.org/mini-apps/
- Defer authentication until necessary (progressive disclosure)
- Use client context for personalization
- Implement proper session management
- Verify all signed payloads server-side

### RPC Strategy for NFT Verification
- Base Mainnet uses fallback RPC array for reliability
- Monad Testnet uses single RPC endpoint
- All RPC calls have 10-second timeout
- Parallel balance checks with `Promise.all`
- Graceful degradation on RPC failures

### Token Format
Session tokens follow pattern: `{OSINT_SESSION_SECRET}_nft_{walletAddress}_{timestamp}`

Helper functions in `lib/rate-limiter.ts`:
- `extractWalletFromToken(token)` - Extracts wallet address
- `isNFTHolder(token)` - Checks if token is NFT-based

## Deployment

Deployed on Vercel with:
- Automatic deployments from `main` branch
- Environment variables configured in Vercel dashboard
- `vercel.json` for custom routing (manifest redirect)
- pnpm as package manager

## Common Patterns

**Adding new rate-limited endpoints:**
1. Import limiter from `lib/rate-limiter.ts`
2. Extract wallet from Authorization header token
3. Call `limiter.checkLimit(wallet)`
4. Return 429 if `allowed: false`
5. Include rate limit headers in response

**NFT verification for new features:**
```typescript
import { checkNFTOwnership } from '@/app/api/auth/nft-auth/route'

const { hasNFT, details } = await checkNFTOwnership(walletAddress)
if (!hasNFT) {
  return NextResponse.json({ error: 'NFT required' }, { status: 403 })
}
```