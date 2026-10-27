// Binance CLI 1.11.0 formats settings.devMode.expiresAt as ISO text;
// the underlying API/documentation also uses Unix seconds. Normalize once.
export function walletExpiry(value) {
  let timestamp = null;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const numeric = Number(value);
    timestamp = numeric < 1e12 ? numeric * 1000 : numeric;
  } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    timestamp = Date.parse(value);
  }
  return Number.isSafeInteger(timestamp) && timestamp > 0 && Number.isFinite(new Date(timestamp).getTime()) ? timestamp : null;
}

export function developerBlocker(developer, now = Date.now()) {
  if (!developer?.enabled) return 'DEVELOPER_MODE';
  if (!Number.isFinite(developer.expiresAt) || developer.expiresAt <= 0) return 'DEVELOPER_EXPIRY_UNKNOWN';
  if (developer.expiresAt <= now) return 'DEVELOPER_EXPIRED';
  if (developer.balanceExceeded || (developer.dailyLimit != null && developer.used != null && Number(developer.used) >= Number(developer.dailyLimit))) return 'DEVELOPER_QUOTA';
  return null;
}

export function launchBlocker(wallet, protocol, now = Date.now()) {
  if (wallet?.status !== 'CONNECTED') return 'WALLET_REQUIRED';
  return developerBlocker(wallet.developer, now) || (!protocol?.ready ? 'PROTOCOL_UNAVAILABLE' : null);
}
