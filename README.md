# BANG — Agent ID Launch Terminal

Website: **https://bangxt.fun** · BNB Smart Chain, chain ID **56** · Desktop web application, English / 中文.

BANG is an independent token launchpad and trading terminal. Any EVM wallet can create a token. Inner-market purchases require a Binance `.ai` Agent ID; the buyer's **current holding** is capped at 1% of total supply. Selling restores capacity. BANG is not affiliated with or endorsed by Binance, Gang, Flap or PancakeSwap.

## Current protocol

- Fixed token supply: 1,000,000,000; 80% bonding curve, 20% graduation liquidity.
- Creation is open to ordinary EVM wallets; no Agentic Wallet pairing is required to create.
- Supported quote assets: BNB/WBNB, USDT and the configured NVDAB, TSLAB, SPCXB and QQQB tokenized assets. Asset contracts and fixed price pools are listed in `contracts/native/mainnet-config.json`.
- Creators choose a graduation target from **1–100 BNB equivalent**. An immutable oracle quotes non-BNB targets from configured 30-minute TWAP pools at creation. This does not give BANG control over the underlying asset issuers.
- Inner-market fee: **1%**; BANG tokens have no transfer tax. Inner transfers are restricted; sells remain available after losing Agent ID.
- Graduation creates actual PancakeSwap V2 liquidity. LP tokens go to the burn address.
- The deployed launchpad and quote oracle have no owner, upgrade or rescue entry points. The immutable fee recipient receives earned protocol fees only.

## Mainnet deployment — 27 October 2026

| Contract | Address |
| --- | --- |
| BANGLaunchpad | `0xB300F0cbc8044346fC0C054f8EEC4f3455C8dDcC` |
| BANGQuoteOracle | `0x64c9Dc1768EE0D166858648a23A94374A87fE424` |
| BANG token | `0x3e80D6cf2Efe889fDa9Ef4C9F5c1737Cc3553Ea0` |
| GB token | `0x4dA83A037b83e07D7EF5c7ffd9Ed49Aba5A47897` |

BANG and GB were issued with a 13.5 BNB graduation target and **zero initial buy**. Four deployment/issuance transactions consumed **0.0007004652 BNB** in gas. Full hashes and block numbers are in [`artifacts/native/deployment.json`](artifacts/native/deployment.json). Publication of this repository is not a new deployment.

The active source is [`contracts/native/`](contracts/native). The flattened verification file is [`artifacts/native/BANGNative.sol`](artifacts/native/BANGNative.sol); exact standard JSON input, ABIs, bytecode and compiler settings are in the same directory. Compiler: Solidity 0.8.30, optimizer 200, viaIR enabled, EVM Paris. Source hash and settings are authoritative in `artifacts/native/build.json`.

## Terminal and wallet integration

The terminal combines the native BANG catalog, paginated Gang main/stocks markets and the OpenFour Agent ID feed. It shows issuer images where the source provides them. Discovery is not an exhaustive BSC scan; contract eligibility is verified before trading.

- New: inner-market progress below 20%.
- Hot / near graduation: progress at least 20%, or the external source's near-graduation classification.
- Graduated: the protocol reports graduation. The 20% label does not change on-chain graduation conditions.

Real 5m / 15m / 1h candles use actual fills. Gang uses its public candle/trade index. Native BANG and OpenFour chart reads use isolated public BSC endpoints, never `BSC_RPC_URL` or `BIA_RPC_URL`. Their current window is the latest 12,000 blocks, up to 300 fills, and only inner-market history. Empty windows stay empty; failures do not fabricate prices.

Each browser user pairs their own Binance Agentic Wallet and may grant bounded quick trading with an amount limit, daily limit, slippage and expiry. Official Binance approval and risk checks still apply. Exact token approvals and transaction receipt recovery are handled in the terminal; an approval receipt is not a completed buy.

Installable connection skill: [`skills/bang-connect/SKILL.md`](skills/bang-connect/SKILL.md). The skill pairs the user's wallet for terminal use; it never asks users to submit their private keys to the site.

## Local run

Node.js **22.12+** (production uses Node 22). From the repository root:

```sh
npm ci
cp .env.example .env.local
npm run admin:password
npm run build
npm run serve
```

Open `http://127.0.0.1:5210/#/terminal`. Other routes: `/#/create`, `/#/market`, `/#/wallet`, `/#/about`, `/admin`. Choose your own admin password; no production password is included. On a server, inject `.env.local` or environment variables privately, set `PUBLIC_HOSTS`, and preserve the `data/` volume across releases.

`BSC_RPC_URL` is backend-only transaction/state configuration. It must never be a Vite variable or bundled frontend constant. The chart service explicitly uses separate public endpoints. No production keys, private RPC URL, server login, wallet sessions, runtime data, or signed deployment journal are included.

## Development and verification

```sh
npm test
node scripts/compile-native.mjs
npm run build
```

Fork scripts in `scripts/test-native-fork.mjs`, `scripts/test-native-terminal.mjs` and `scripts/test-terminal-fork.mjs` require Anvil and a suitable read-only fork RPC. Earlier project validation covered Agent ID gating, the holding cap, sell/approval flows, and BNB/RWA graduation on a local mainnet fork. Wallet transport in the terminal fork checks was mocked. These checks are not an independent security audit or evidence of a real user mainnet purchase. Mainnet activity for this release is the four recorded deployment/issuance transactions only.

`scripts/deploy-native.mjs` is the historical deployment/recovery tool. It expects a separate private sibling `../bang-deploy/.env` and a reviewed plan; those files and keys are intentionally excluded. Do not rerun it merely to start the website.

## Repository layout and legacy compatibility

`src/` — frontend; `server/` — API and per-user wallet integration; `shared/` — shared checks; `contracts/native/` — active protocol; `artifacts/native/` — build and deployment evidence; `public/` — runtime assets and public downloads; `skills/` — user connection skill.

`contracts/BANG.sol`, `contracts/flap/`, top-level `artifacts/BANGV3.sol`, legacy server ABI files and corresponding Flap tests are retained as historical/runtime compatibility dependencies. **They are not the deployed native BANG launchpad.** Their rescue/Guardian logic does not describe the contracts in the mainnet table above. New website issuance uses the native launchpad.

## Licenses and assets

BANG-authored source is GPL-2.0-or-later unless a file states otherwise. Preserve per-file SPDX identifiers and third-party notices. OpenZeppelin and the vendored Binance helper retain their original licenses; helper provenance and pinned hash are in `server/vendor/SOURCE.txt`.

Visual/audio assets and third-party portraits are not relicensed under the source-code license. Their respective rights and authorizations remain with their owners; public source availability does not grant additional asset redistribution rights.
