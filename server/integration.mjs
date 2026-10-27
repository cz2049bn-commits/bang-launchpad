// Public capabilities: never expose wallet sessions, credentials or deployment .env.
export function integrationManifest() {
  return {
    schemaVersion: 1,
    product: 'BANG',
    chainId: 56,
    origin: 'https://bangxt.fun',
    authorization: {
      mode: 'browser-account-pairing',
      provider: 'Binance Agentic Wallet',
      page: '/#/wallet',
      userConfirmsIn: 'Binance App',
      sessionScope: 'current-browser-account',
      credentialsExported: false,
      developerModeRequired: true,
      expiryAndDailyLimit: 'read-from-wallet',
      perTradeConfirmation: 'website-click-within-explicit-quick-grant-or-preview',
      additionalAppConfirmation: 'when-required-by-wallet',
      revokePage: '/#/wallet',
    },
    routes: { wallet: '/#/wallet', market: '/#/market', launch: '/#/create', terminal: '/#/terminal' },
    capabilities: {
      pairing: true,
      quickTrading: true,
      graduatedDexTrading: false,
      bangFlapTrading: false,
      gangDiscovery: true,
      gangTrading: true,
      openFourDiscovery: true,
      openFourTrading: true,
      independentBangLaunchpad: true,
      ordinaryEvmIssuance: true,
      agentIdRequiredForIssuance: false,
      agentIdRequiredForInnerBuys: true,
    },
    skill: { name: 'bang-connect', version: '0.3.0', document: '/skills/bang-connect/SKILL.md', download: '/downloads/bang-connect.zip' },
  };
}
