export async function api(path, body, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    ...(body !== undefined ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {}),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {const error = new Error(value.error?.message || value.message || (typeof value.error === 'string' ? value.error : '请求未完成，请重试'));error.code=value.code;error.status=response.status;throw error;}
  return value;
}
export const number = (n, max = 2) => new Intl.NumberFormat('en-US', {maximumFractionDigits: max}).format(Number(n) || 0);
export const price = n => Number(n || 0).toFixed(9);
export const compact = n => Number(n) >= 1e6 ? `${number(n / 1e6, 2)}M` : Number(n) >= 1e3 ? `${number(n / 1e3, 1)}K` : number(n, 2);
export const progress = token => Math.max(0, Math.min(100, Number(token?.progress || 0)));
export const colors = ['#e9c454', '#aabbee', '#a4c6bb', '#bdacd6', '#dca388', '#b9bdb2'];
export const tint = token => colors[[...(token?.address||token?.symbol||'BIA')].reduce((n,c)=>n+c.charCodeAt(0),0) % colors.length];
