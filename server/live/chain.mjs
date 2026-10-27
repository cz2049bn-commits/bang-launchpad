import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { createPublicClient, http, getAddress, isAddress, zeroAddress, zeroHash, parseEther, formatEther,
  encodeFunctionData, getContractAddress, keccak256, erc20Abi, decodeEventLog } from 'viem';
import { bsc } from 'viem/chains';
import { AppError } from '../../shared/errors.mjs';

export const PORTAL = '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0';
export const IMPLEMENTATION = '0x024f18294970b5c76c0691b87f138a0317156422';
export const ABI = JSON.parse(await readFile(new URL('./portal.abi.json', import.meta.url), 'utf8'));
const CLONE_HASH = keccak256(`0x3d602d80600a3d3981f3363d3d373d3d3d363d73${IMPLEMENTATION.slice(2)}5af43d82803e903d91602b57fd5bf3`);
const DECIMALS = 10n ** 18n;
export function address(value) { if (typeof value !== 'string' || !isAddress(value, { strict: false })) throw new AppError('Enter a valid BNB Chain address.'); return getAddress(value.toLowerCase()); }
export function amount(value, allowZero = false) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,30})(\.\d{1,18})?$/.test(value)) throw new AppError('Use a decimal amount with at most 18 decimal places.');
  const n = parseEther(value); if (n === 0n && !allowZero) throw new AppError('Amount must be greater than zero.'); return n;
}
export function cid(value) { if (typeof value !== 'string' || !/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{20,120})$/.test(value)) throw new AppError('Enter the IPFS CID returned by Flap metadata upload.'); return value; }
export function taxBps(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw new AppError(`${label} must be a whole number from 0 to 1000 (0%–10%).`);
  return n;
}
export function taxParams({ name, symbol, metadataCid, salt, walletAddress, initialBuyWei, buyTaxBps, sellTaxBps }) {
  const buyTaxRate = taxBps(buyTaxBps, 'Buy tax'), sellTaxRate = taxBps(sellTaxBps, 'Sell tax');
  if (buyTaxRate + sellTaxRate === 0) throw new AppError('Enter a buy tax or a sell tax. Tax-token launches cannot both be zero.');
  return { name, symbol, meta: cid(metadataCid), dexThresh: 1, salt, migratorType: 1, quoteToken: zeroAddress,
    quoteAmt: initialBuyWei, beneficiary: walletAddress, permitData: '0x', extensionID: zeroHash, extensionData: '0x',
    dexId: 0, lpFeeProfile: 0, buyTaxRate, sellTaxRate, taxDuration: 3153600000n, antiFarmerDuration: 2592000n,
    mktBps: 10000, deflationBps: 0, dividendBps: 0, lpBps: 0, minimumShareBalance: 0n,
    dividendToken: zeroAddress, commissionReceiver: zeroAddress, tokenVersion: 6 };
}
export async function mineSalt() {
  for (let i = 0; i < 2_000_000; i++) {
    const salt = `0x${randomBytes(32).toString('hex')}`;
    const predicted = getContractAddress({ opcode: 'CREATE2', from: PORTAL, salt, bytecodeHash: CLONE_HASH });
    if (predicted.toLowerCase().endsWith('7777')) return { salt, predicted };
    if (i % 512 === 0) await yieldLoop();
  }
  throw new AppError('Address preparation timed out. Please try again.', 503);
}
export function curvePoints(state) {
  // Floating point is used only for SVG coordinates. Transaction amounts always use bigint.
  const r = Number(formatEther(state.r)), h = Number(formatEther(state.h)), k = Number(formatEther(state.k));
  const max = Number(formatEther(state.dexSupplyThresh));
  if (!(max > 0) || !(k > 0) || 1e9 + h <= max) return [];
  return Array.from({ length: 61 }, (_, i) => { const supply = max * i / 60, d = 1e9 + h - supply;
    return { supply, reserve: Math.max(0, k / d - r), price: k / (d * d) }; });
}
export class ChainService {
  constructor({ client, rpcUrl = process.env.BSC_RPC_URL || process.env.BIA_RPC_URL || 'https://bsc-dataseed.bnbchain.org' } = {}) {
    if (!rpcUrl.startsWith('https://')) throw new Error('BIA_RPC_URL must use HTTPS');
    this.client = client || createPublicClient({ chain: bsc, transport: http(rpcUrl, { timeout: 12_000, retryCount: 1 }) });
    this.cached = null; this.check = null;
  }
  read(functionName, args = [], blockNumber) { return this.client.readContract({ address: PORTAL, abi: ABI, functionName, args, ...(blockNumber != null ? { blockNumber } : {}) }); }
  async status(force = false) {
    if (!force && this.cached && Date.now() - this.cached.checkedAt < 30_000) return this.cached;
    if (this.check) return this.check;
    this.check = (async () => {
      const chainId = await this.client.getChainId();
      if (chainId !== 56) throw new AppError('RPC network mismatch. BNB Chain 56 is required.', 503);
      const [code, version, fees, config, block] = await Promise.all([
        this.client.getCode({ address: PORTAL }), this.read('version'), this.read('getFeeRate'),
        this.read('getQuoteTokenConfiguration', [zeroAddress]), this.client.getBlockNumber()]);
      if (!code || code === '0x') throw new AppError('The official Flap Portal is unavailable on this RPC.', 503);
      this.cached = { ready: true, chainId, chainName: 'BNB Smart Chain', portal: PORTAL, version,
        buyFeeBps: Number(fees[0]), sellFeeBps: Number(fees[1]), nativeEnabled: Number(config.enabled) === 1,
        curveId: Number(config.defaultCurve), block: block.toString(), checkedAt: Date.now() };
      return this.cached;
    })();
    try { return await this.check; } finally { this.check = null; }
  }
  async token(rawAddress, owner) {
    const tokenAddress = address(rawAddress);
    await this.status();
    const blockNumber = await this.client.getBlockNumber();
    const state = await this.read('getTokenV8Safe', [tokenAddress], blockNumber);
    if (Number(state.status) === 0) throw new AppError('This address is not a recognized Flap token.', 404, 'TOKEN_NOT_FOUND');
    if (state.quoteTokenAddress.toLowerCase() !== zeroAddress) throw new AppError('This terminal currently supports native BNB curves only.');
    const read = (functionName, args = []) => this.client.readContract({ address: tokenAddress, abi: erc20Abi, functionName, args, blockNumber });
    const [name, symbol, decimals, supply, balance, allowance, bnb] = await Promise.all([
      read('name'), read('symbol'), read('decimals'), read('totalSupply'),
      owner ? read('balanceOf', [owner]) : 0n, owner ? read('allowance', [owner, PORTAL]) : 0n,
      owner ? this.client.getBalance({ address: owner, blockNumber }) : 0n]);
    if (decimals !== 18) throw new AppError('Unsupported token decimals.');
    return { address: tokenAddress, name, symbol, decimals, mode: 'live', status: Number(state.status),
      reserve: Number(formatEther(state.reserve)), price: Number(formatEther(state.price)), sold: Number(formatEther(state.circulatingSupply)),
      curveSupply: Number(formatEther(state.dexSupplyThresh)), totalSupply: formatEther(supply),
      progress: Number(state.progress * 10000n / DECIMALS) / 100, curvePoints: curvePoints(state),
      balance: formatEther(balance), allowance: allowance.toString(), bnbBalance: formatEther(bnb),
      buyTaxBps: Number(state.buyTaxRate), sellTaxBps: Number(state.sellTaxRate),
      block: blockNumber.toString(), checkedAt: Date.now() };
  }
  async launch(body, owner) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
    if (!name || [...name].length > 32 || /[\x00-\x1f]/.test(name)) throw new AppError('Use a token name between 1 and 32 characters.');
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(symbol)) throw new AppError('Use a symbol of 2–10 letters or digits, starting with a letter.');
    const initialBuyWei = amount(body.initialBuy ?? '0', true), metadataCid = cid(body.metadataCid);
    const protocol = await this.status(true);
    if (!protocol.nativeEnabled) throw new AppError('BNB launches are currently disabled by the protocol.', 503);
    const { salt, predicted } = await mineSalt();
    const code = await this.client.getCode({ address: predicted });
    if (code && code !== '0x') throw new AppError('The generated address is already occupied. Request a fresh preview.', 409);
    const params = taxParams({ name, symbol, metadataCid, salt, walletAddress: owner, initialBuyWei,
      buyTaxBps: body.buyTaxBps, sellTaxBps: body.sellTaxBps });
    const data = encodeFunctionData({ abi: ABI, functionName: 'newTokenV6', args: [params] });
    return { kind: 'launch', from: owner, to: PORTAL, data, value: initialBuyWei.toString(),
      summary: { name, symbol, metadataCid, predicted, initialBuy: formatEther(initialBuyWei),
        totalSupply: '1000000000', curveSupply: '800000000', tokenVersion: 6,
        buyTaxBps: params.buyTaxRate, sellTaxBps: params.sellTaxRate, taxReceiver: owner,
        taxSplit: '100% to your launch wallet', platformShareBps: 0 } };
  }
  async trade(body, owner) {
    const token = await this.token(body.token, owner), inputAmount = amount(body.amount);
    if (token.status !== 1) throw new AppError('This token is no longer trading on its internal curve.', 409, 'CURVE_CLOSED');
    if (!['buy','sell','approve'].includes(body.kind)) throw new AppError('Invalid trade type.');
    if (body.kind !== 'buy' && inputAmount > parseEther(token.balance)) throw new AppError('Insufficient token balance.');
    if (body.kind === 'approve') return { kind: 'approve', from: owner, to: token.address, value: '0',
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [PORTAL, inputAmount] }),
      summary: { token: token.address, symbol: token.symbol, amount: body.amount, spender: PORTAL, allowanceType: 'EXACT_AMOUNT' } };
    if (body.kind === 'sell' && BigInt(token.allowance) < inputAmount) throw new AppError('Approve this exact token amount first, then request a new sell preview.', 409, 'APPROVAL_REQUIRED');
    if (!Number.isInteger(body.slippageBps) || body.slippageBps < 1 || body.slippageBps > 500) throw new AppError('Slippage must be between 0.01% and 5%.');
    const inputToken = body.kind === 'buy' ? zeroAddress : token.address;
    const outputToken = body.kind === 'buy' ? token.address : zeroAddress;
    const { result: outputAmount } = await this.client.simulateContract({ address: PORTAL, abi: ABI,
      functionName: 'quoteExactInput', args: [{ inputToken, outputToken, inputAmount }], account: owner });
    const minOutputAmount = outputAmount * BigInt(10000 - body.slippageBps) / 10000n;
    if (minOutputAmount <= 0n) throw new AppError('The quoted output is too small.');
    return { kind: body.kind, from: owner, to: PORTAL, value: body.kind === 'buy' ? inputAmount.toString() : '0',
      data: encodeFunctionData({ abi: ABI, functionName: 'swapExactInput', args: [{ inputToken, outputToken, inputAmount, minOutputAmount, permitData: '0x' }] }),
      summary: { token: token.address, symbol: token.symbol, amount: body.amount, output: formatEther(outputAmount), minimum: formatEther(minOutputAmount),
        inputUnit: body.kind === 'buy' ? 'BNB' : token.symbol, outputUnit: body.kind === 'buy' ? token.symbol : 'BNB', slippageBps: body.slippageBps,
        buyTaxBps: token.buyTaxBps, sellTaxBps: token.sellTaxBps, quoteIncludesTax: true } };
  }
  async simulate(tx) {
    if(tx.summary?.source){const block=await this.client.getBlock();if(await this.client.getChainId()!==56||Math.abs(Date.now()/1000-Number(block.timestamp))>120)throw new AppError('BNB RPC network or freshness check failed.',503)}
    else await this.status(true);
    const request = { account: tx.from, to: tx.to, data: tx.data, value: BigInt(tx.value) };
    try {
      await this.client.call(request);
      const [gas, gasPrice, balance, block] = await Promise.all([
        this.client.estimateGas(request), this.client.getGasPrice(), this.client.getBalance({ address: tx.from }), this.client.getBlockNumber()]);
      if (BigInt(tx.value) + gas * gasPrice > balance) throw new AppError('Insufficient BNB for this transaction and estimated network gas.');
      return { gas: gas.toString(), gasCost: formatEther(gas * gasPrice), balance: formatEther(balance), block: block.toString() };
    } catch (e) {
      if (e instanceof AppError) throw e;
      const reason = e.shortMessage || e.details || e.message || e.cause?.message || '';
      throw new AppError(`On-chain simulation failed. Check balance, token parameters and protocol availability.${reason ? ` ${String(reason).replace(/\s+/g,' ').slice(0,220)}` : ''}`, 422, 'SIMULATION_FAILED');
    }
  }
  async receipt(hash, intent, verifyExternal=null) {
    if (!/^0x[\da-fA-F]{64}$/.test(hash || '')) throw new AppError('Enter a valid transaction hash.');
    const tx = await this.client.getTransaction({ hash });
    if (tx.from.toLowerCase() !== intent.tx.from.toLowerCase() || tx.to?.toLowerCase() !== intent.tx.to.toLowerCase() ||
      tx.input.toLowerCase() !== intent.tx.data.toLowerCase() || tx.value.toString() !== intent.tx.value ||
      (tx.blockNumber != null && tx.blockNumber < BigInt(intent.simulation.block)))
      throw new AppError('This transaction does not match the confirmed operation.', 409, 'TRANSACTION_MISMATCH');
    if (tx.blockNumber == null) return { status: 'BROADCASTED', txHash: hash };
    const receipt = await this.client.getTransactionReceipt({ hash });
    const canonical=await this.client.getBlock({blockNumber:receipt.blockNumber});
    if(canonical.hash!==receipt.blockHash||tx.blockHash!==receipt.blockHash)return {status:'CONFIRMING',txHash:hash,confirmations:0};
    if (receipt.status === 'reverted') return { status: 'REVERTED', txHash: hash, block: receipt.blockNumber.toString() };
    const latest = await this.client.getBlockNumber({cacheTime:0}), confirmations = Math.max(0,Number(latest - receipt.blockNumber + 1n));
    let token = null;
    const received=verifyExternal?verifyExternal(receipt):null;
    if(verifyExternal&&!received)return {status:'RECEIPT_REVIEW',txHash:hash,block:receipt.blockNumber.toString()};
    if (intent.tx.kind === 'launch'&&!intent.tx.summary.source) {
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== PORTAL.toLowerCase()) continue;
        try { const decoded = decodeEventLog({ abi: ABI, eventName: 'TokenCreated', data: log.data, topics: log.topics });
          if (decoded.args.creator.toLowerCase() === intent.tx.from.toLowerCase()) token = decoded.args.token;
        } catch { /* other Portal events */ }
      }
      if (!token || token.toLowerCase() !== intent.tx.summary.predicted.toLowerCase())
        return { status: 'RECEIPT_REVIEW', txHash: hash, block: receipt.blockNumber.toString() };
    }
    return { status: confirmations >= 2 ? 'CONFIRMED' : 'CONFIRMING', txHash: hash, confirmations, block: receipt.blockNumber.toString(), token:token||received?.token||null,received,
      gasCost:receipt.effectiveGasPrice!=null?formatEther(receipt.gasUsed*receipt.effectiveGasPrice):null };
  }
}
