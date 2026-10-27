import React,{useEffect,useRef,useState} from 'react';

const panels=[['L1R1',1,'1',.08,6],['L1R2',1,'2',.1,8],['L1R3',1,'3',.1,8],['L1R4',1,'4',.3,30],['L2R1',2,'1',.1,8],['L2MASTER',2,'2 / 4',.25,20],['L2R4',2,'4',.1,8],['RIGHT','3 / 5','1 / 5',.55,30]];

export default function Intro({progress,error,quality,setQuality,onEnter,accent,language}){
 const root=useRef(null),pointer=useRef(null),timer=useRef(),[leaving,setLeaving]=useState(false),[music,setMusic]=useState(false);
 const ready=progress>=100,zh=language==='zh',L=(en,cn)=>zh?cn:en;
 useEffect(()=>{root.current?.focus();return()=>clearTimeout(timer.current)},[]);
 useEffect(()=>{
  let frame;const target={x:innerWidth/2,y:innerHeight/2},current={...target};
  const move=e=>{target.x=e.clientX;target.y=e.clientY;setMusic(e.clientX<innerWidth/2)};
  const draw=()=>{current.x+=(target.x-current.x)*.12;current.y+=(target.y-current.y)*.12;if(pointer.current)pointer.current.style.transform=`translate(${current.x}px,${current.y}px) translate(-50%,-50%)`;frame=requestAnimationFrame(draw)};
  window.addEventListener('pointermove',move,{passive:true});frame=requestAnimationFrame(draw);
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('pointermove',move)};
 },[]);
 const enter=withMusic=>{if(!ready||leaving)return;setLeaving(true);onEnter(withMusic,false);timer.current=setTimeout(()=>onEnter(withMusic,true),1150)};
 const trap=e=>{if(e.key==='Enter'&&e.target===root.current){enter(music);return}if(e.key!=='Tab')return;const items=[...root.current.querySelectorAll('button:not(:disabled)')];if(!items.length){e.preventDefault();return}const first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===root.current)){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===root.current)){e.preventDefault();first.focus()}};
 const step=ready?(error?'SCENE_FALLBACK':'SYSTEM_READY'):progress<20?'INITIALIZING_ENGINE':progress<85?'FETCHING_ASSETS':'COMPILING_SHADERS';
 return <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={L('Enter BANG','进入 BANG')} onKeyDown={trap} className={`intro ${leaving?'intro-leaving':''} ${ready?'intro-ready':''}`} style={{'--gold':accent}}>
  <div className="intro-panels" aria-hidden="true">{panels.map(([id,column,row,opacity,blur],index)=><div key={id} data-id={id} className={id==='RIGHT'?'intro-panel intro-panel-right':'intro-panel'} style={{gridColumn:column,gridRow:row,background:`rgba(0,0,0,${opacity})`,backdropFilter:`blur(${blur}px)`,'--delay':`${.35+Math.abs(index-3)*.02}s`}}/>)}</div>
  <button className="intro-enter-area" disabled={!ready||leaving} onClick={e=>enter(e.detail?e.clientX<innerWidth/2:music)} aria-label={L('Enter BANG. Left side with music, right side silent.','进入 BANG。点击左半屏开启音乐，右半屏静音。')}/>
  <i className="intro-divider" aria-hidden="true"/>
  <div className="intro-percent" aria-live="polite">{Math.round(progress)}<small>%</small></div>
  <div ref={pointer} className="intro-fly" aria-hidden="true"><span>{L('Enter','进入')}</span><b className={music?'music-on':''}>{music?L('VIBES ON','音乐开启'):L('SILENT MODE','静音模式')}</b></div>
  <div className="intro-quality"><span>{L('PERFORMANCE TIER','渲染质量')}</span><div>{[['high','HIGH','精细'],['medium','MED','均衡'],['saver','SAVER','节能']].map(([value,en,cn])=><button key={value} disabled={leaving} aria-pressed={quality===value} onClick={()=>setQuality(value)}>{L(en,cn)}</button>)}</div></div>
  <div className="intro-music"><span>{L('MUSIC','音乐')}</span><button disabled={!ready||leaving} onClick={()=>enter(true)}>ON</button><i>/</i><button disabled={!ready||leaving} onClick={()=>enter(false)}>OFF</button></div>
  <div className="intro-progress"><div><span><i/>{step}</span><small>{Math.round(progress)} / 100</small></div><button disabled={!ready||leaving} onClick={()=>enter(music)}><i style={{transform:`scaleX(${progress/100})`}}/><span>{ready?(error?L('CONTINUE WITHOUT 3D','继续进入'):L('LOADED — ENTER','加载完成 · 进入')):L('LOADING','载入中')}</span></button></div>
 </div>;
}
