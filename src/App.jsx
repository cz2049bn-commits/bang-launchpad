import React,{useState,useEffect,useCallback,lazy,Suspense} from 'react';
import Shell from './components/Shell';
import Home from './pages/Home';
import {Icon} from './components/UI';
import {api} from './api';
import {getLocale,setLocale} from './i18n';
const About=lazy(()=>import('./pages/About'));
const Market=lazy(()=>import('./pages/Market'));
const Services=lazy(()=>import('./pages/Services'));
const Launch=lazy(()=>import('./pages/Launch'));
const Terminal=lazy(()=>import('./pages/Terminal'));
function readRoute(){return location.hash.replace(/^#/,'')||'/'}
export default function App(){
 const [route,setRoute]=useState(readRoute),[state,setState]=useState(null),[error,setError]=useState(''),[language,setLanguage]=useState(getLocale),[quality,setQuality]=useState('high'),[replay,setReplay]=useState(0),[toast,setToast]=useState('');
 const refresh=useCallback(async value=>{if(value?.session&&value?.tokens){setState(value);return value}try{const out=await api('/state');setState(out);setError('');return out}catch(e){setError(e.message);return null}},[]);
 useEffect(()=>{refresh();const timer=setInterval(()=>{if(!document.hidden)refresh()},20000);return()=>clearInterval(timer)},[refresh]);
 useEffect(()=>{const change=()=>setRoute(readRoute());window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[]);
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),4000);return()=>clearTimeout(timer)},[toast]);
 const changeLanguage=value=>{setLocale(value);setLanguage(value);document.title=value==='zh'?'BANG — 发射终端':'BANG — Launch Terminal'};
 const common={state,refresh,notify:setToast};let content;
 if(route==='/')content=<Home {...common} quality={quality} replay={replay}/>;
 else if(route==='/about')content=<About/>;
 else if(route==='/market')content=<Market {...common}/>;
 else if(route==='/terminal')content=<Terminal/>;
 else if(route==='/create'||route==='/live')content=state?<Launch/>:<div className="route-loading">INITIALIZING ACCOUNT…</div>;
 else if(route==='/services')content=state?<Services key="network" {...common} view="network"/>:null;
 else if(route==='/wallet'||route==='/permissions')content=state?<Services key="wallet" {...common} view="wallet"/>:null;
 else if(route.startsWith('/token/'))content=state?<Terminal key={route} initialAddress={decodeURIComponent(route.slice(7))}/>:null;
 else content=<Home {...common} quality={quality} replay={replay}/>;
 return <Shell route={route} state={state} quality={quality} setQuality={setQuality} replay={replay} setReplay={setReplay} language={language} onLanguage={changeLanguage}><Suspense fallback={<div className="route-loading"><span className="loader-line"/>INITIALIZING...</div>}>{content}</Suspense>{error&&<div className="connection-error" role="alert"><span>无法连接本地服务</span><button onClick={()=>refresh()}>重新连接</button></div>}{toast&&<div className="toast" role="status"><Icon name="check" size={17}/><span>{toast}</span></div>}</Shell>
}
