import { getLocale } from './i18n';
export { launchBlocker } from '../shared/wallet-authorization.mjs';
const messages = {
  WALLET_REQUIRED: ['Pair your Binance Agentic Wallet to prepare a launch.', '连接你的币安 Agent 钱包后，即可准备发射。'],
  DEVELOPER_MODE: ['Enable Developer Mode in the Binance App, then refresh here.', '请在币安 App 开启开发者模式，然后刷新授权状态。'],
  DEVELOPER_EXPIRY_UNKNOWN: ['The wallet authorization expiry is unavailable. Refresh wallet status to check it again.', '暂时无法读取钱包授权有效期，请刷新授权状态后重试。'],
  DEVELOPER_EXPIRED: ['Developer Mode authorization has expired. Renew it in the Binance App, then refresh here.', '开发者模式授权已过期，请在币安 App 续期后刷新。'],
  DEVELOPER_QUOTA: ['Developer Mode is restricted by its balance or daily limit. Review the settings in the Binance App.', '开发者模式受到余额或每日额度限制，请在币安 App 查看设置。'],
  PROTOCOL_UNAVAILABLE: ['BNB Chain protocol data is temporarily unavailable. Try refreshing again shortly.', '暂时无法读取 BNB 主网协议，请稍后刷新重试。']
};
export const walletHint = code => messages[code]?.[getLocale() === 'zh' ? 1 : 0] || '';
