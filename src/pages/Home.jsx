import React,{lazy,Suspense,useState,useCallback,useEffect,useRef} from 'react';
import {BNBMark,Icon} from '../components/UI';
import {number,progress} from '../api';
const Scene=lazy(()=>import('../components/Scene'));
export default function Home({state,quality,replay}){
 const tokens=state?.tokens||[],featured=tokens[0],reserve=tokens.every(t=>t.quoteAvailable)?tokens.filter(t=>t.quoteSymbol==='BNB').reduce((s,t)=>s+Number(t.reserve),0):null,active=tokens.filter(t=>t.status===1).length;
 const [performance,setPerformance]=useState({fps:0,dpr:1}),[coreReady,setCoreReady]=useState(false);
 const onPerformance=useCallback(value=>setPerformance(value),[]),onReady=useCallback(value=>setCoreReady(value),[]);
 const tickerRef=useRef(null);
 useEffect(()=>{const el=tickerRef.current;if(!el)return;const resize=()=>el.style.setProperty('--ticker-duration',`${el.scrollWidth/2/50}s`);const ro=new ResizeObserver(resize);ro.observe(el);resize();return()=>ro.disconnect()},[]);
 const ticker=[['CORE_ID','BANG'],['NETWORK','BNB CHAIN'],['PRICING','BONDING CURVE'],['EXECUTION','USER AUTHORIZED']];
 return <main className="home-page"><div className="home-left-panel"><i className="panel-scan"/></div>
  <div className="top-ticker" aria-label="平台信息带"><div ref={tickerRef}>{[0,1,2,3].map(i=><span className="ticker-group" key={i}>{ticker.map(([label,text])=><span key={label}><small>{label}</small><strong>{text}</strong><i/></span>)}</span>)}</div></div>
  <div className="home-content"><h1 className="scanning-title"><span>BANG</span><span>LAUNCHPAD</span></h1><div className="home-copy"><span className="info-line"/><div><small>[ INFO_LOG ]</small><p>把一次发射，做清楚。<br/><span>从参数、签名，到链上记录。</span></p></div></div><div className="hero-actions"><a href="#/create" className="hero-primary">发射代币 <Icon name="arrow" size={15}/></a><a href="#/market" className="hero-secondary">探索内盘 <Icon name="arrow" size={15}/></a></div></div>
  <Suspense fallback={<div className="scene-loading">正在载入三维场景...</div>}><Scene quality={quality} replay={replay} onPerformance={onPerformance} onReady={onReady}/></Suspense>
  <aside className="home-stats"><div className="section-code"><span>发射台状态</span></div><p className="system-ready"><span className="status-dot"/>{coreReady?'系统就绪':'载入中'}</p>
   <div className="hud-metrics"><div className="hud-metric"><div><span>VERIFIED_LAUNCHES</span><span>{state?String(tokens.length).padStart(2,'0'):'—'}</span></div><div className="hud-track"><i style={{width:`${tokens.length?100:0}%`}}/></div></div><div className="hud-metric"><div><span>CURVE_RESERVE</span><span>{state&&reserve!==null?number(reserve,2):'—'} BNB</span></div><div className="hud-track"><i style={{width:`${tokens.length?active/tokens.length*100:0}%`}}/></div></div></div>
   <div className="terminal-lines"><p>&gt; NETWORK: BNB_SMART_CHAIN</p><p>&gt; EXECUTION: USER_AUTHORIZED</p><p>&gt; MARKET: BANG_ORIGIN_ONLY</p><p>&gt; SYSTEM_PERF: [{quality.toUpperCase()}] {performance.fps||'—'} FPS @ {performance.dpr} DPR</p></div>
   {featured&&<a href={`#/token/${featured.address}`} className="featured-agent"><div><span>探索曲线</span><b>{featured.symbol}<Icon name="arrow" size={12}/></b></div><div className="featured-track"><i style={{width:`${progress(featured)}%`}}/></div></a>}
  </aside>
  <div className="hero-identity"><div><span>钱包接入</span><a href="#/wallet">{'Binance Agentic Wallet'}</a></div><div><span>从这里，开始创造。</span><a href="#/about"><BNBMark size={15}/>了解 BANG</a></div></div>
 </main>
}
