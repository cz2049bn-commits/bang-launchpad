import React, { useEffect, useRef, useState } from 'react';
import { tint, progress } from '../api';

export function Icon({name='arrow', size=18, ...props}) {
  const paths = {
    gear:<><path d="m9 3 1-1h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1Z" transform="translate(1 0) scale(.9)"/><circle cx="12" cy="12" r="3.2"/></>, replay:<><path d="M4 10a8 8 0 1 1 .8 7M4 4v6h6"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>, back:<path d="M20 12H4m6-6-6 6 6 6"/>,
    close:<path d="m6 6 12 12M6 18 18 6"/>, plus:<path d="M12 5v14M5 12h14"/>,
    search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    check:<path d="m5 12 4 4L19 6"/>, copy:<><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/></>,
    settings:<><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="16" cy="17" r="3" fill="currentColor"/></>,
    chevron:<path d="m8 5 7 7-7 7"/>, download:<><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/></>,
    shield:<><path d="m12 3 8 4v6c0 4-8 8-8 8s-8-4-8-8V7Z"/><path d="m8 12 3 3 5-6"/></>,
    wallet:<><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 7V5l13-3v4M16 12h5v4h-5z"/></>,
    link:<><path d="m9 15 6-6m-7 8-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4-2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.arrow}</svg>;
}
export function BNBMark({size=22}) { return <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="m16 2 6 6-3.5 3.5L16 9l-2.5 2.5L10 8zm-10.5 10.5L9 16l-3.5 3.5L2 16zm21 0L30 16l-3.5 3.5L23 16zM16 12l4 4-4 4-4-4zm-6 12 3.5-3.5L16 23l2.5-2.5L22 24l-6 6z"/></svg> }
export function TokenMark({token, large=false}) {
  const [failed,setFailed]=useState(false); const image=token?.image;
  useEffect(()=>setFailed(false),[image]);
  return <span className={`token-mark ${large?'large':''}`}>{image&&!failed?<img src={image} alt={token?.symbol||'Token'} loading="lazy" referrerPolicy="no-referrer" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'inherit'}} onError={()=>setFailed(true)}/>:<span aria-label="Image unavailable">—</span>}</span>;
}
export function ProgressBar({token, value, caption=true}) {const p=value??progress(token);return <div className="progress-group">{caption&&<div className="progress-caption"><span>绑定曲线进度</span><span>{p.toFixed(1)}%</span></div>}<div className="progress-track"><i style={{width:`${p}%`}}/></div></div>}
export function Field({label,hint,children,className=''}) {return <label className={`field ${className}`}><span className="field-label">{label}</span>{children}{hint&&<span className="field-hint">{hint}</span>}</label>}
export function Switch({checked,onChange,label}) {return <button type="button" className={`switch ${checked?'on':''}`} role="switch" aria-checked={checked} aria-label={label} onClick={()=>onChange(!checked)}><i/></button>}
export function PageTitle({index,title,english,children}) {return <div className="page-heading"><div><div className="breadcrumb"><a href="#/">发射大厅</a><span>/</span><span>{title}</span></div><h1>{title}<em>{english}</em></h1></div><div className="page-heading-side"><span>[ {index} ]</span>{children}</div></div>}
export function Modal({title,children,onClose}) {
  const ref=useRef(null);
  useEffect(()=>{const prev=document.activeElement;ref.current?.focus();const handler=e=>{if(e.key==='Escape')onClose(); if(e.key==='Tab'){const nodes=ref.current?.querySelectorAll('button, a, input, select, textarea, [tabindex="0"]');if(!nodes?.length)return; const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};document.addEventListener('keydown',handler);return()=>{document.removeEventListener('keydown',handler);prev?.focus?.()}},[onClose]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-title"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="关闭"><Icon name="close"/></button></div>{children}</section></div>
}
export function Empty({children}) {return <div className="empty-state"><span className="empty-cross">+</span><p>{children}</p></div>}
