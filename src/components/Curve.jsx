import React,{useMemo,useState} from 'react';
import {number,compact,price} from '../api';
import {getLocale} from '../i18n';
export default function Curve({token,quote}){
 const [metric,setMetric]=useState('reserve'),[hover,setHover]=useState(null);
 const data=useMemo(()=>token.curvePoints||[],[token]);
 if(!data.length)return null;
 const W=800,H=300,left=20,right=75,top=26,bottom=30,maxX=data.at(-1).supply,maxY=Math.max(...data.map(p=>p[metric]))*1.1||1;
 const sx=x=>left+x/maxX*(W-left-right),sy=y=>H-bottom-y/maxY*(H-top-bottom);
 const line=data.map((p,i)=>`${i?'L':'M'} ${sx(p.supply)} ${sy(p[metric])}`).join(' ');
 const area=`${line} L ${sx(maxX)} ${H-bottom} L ${left} ${H-bottom} Z`;
 const current={supply:token.sold,reserve:token.reserve,price:token.price};const point=hover===null?current:data[hover];
 return <section className="curve-module"><div className="curve-topline"><div className="segmented"><button className={metric==='reserve'?'active':''} onClick={()=>setMetric('reserve')}>累计募集</button><button className={metric==='price'?'active':''} onClick={()=>setMetric('price')}>代币价格</button></div><span>绑定曲线 <i className="legend-dot"/></span></div>
 <div className="chart-reading"><small>{hover===null?'当前位置':'曲线预览'} / {compact(point.supply)} TOKEN</small><strong>{metric==='reserve'?number(point.reserve,4):price(point.price)} <span>BNB</span></strong></div>
 <svg className="curve-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={getLocale()==='zh'?`${token.name} 绑定曲线，已售 ${compact(token.sold)} 枚，当前价格 ${price(token.price)} $BNB`:`${token.name} bonding curve. Sold ${compact(token.sold)} tokens. Price ${price(token.price)} BNB`} onMouseLeave={()=>setHover(null)} onMouseMove={e=>{const rect=e.currentTarget.getBoundingClientRect();const pos=(e.clientX-rect.left)/rect.width*W;setHover(Math.max(0,Math.min(data.length-1,Math.round((pos-left)/(W-left-right)*(data.length-1)))))}}>
 <defs><linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e7bb53" stopOpacity=".13"/><stop offset="1" stopColor="#e7bb53" stopOpacity="0"/></linearGradient></defs>
 {[0,.25,.5,.75,1].map(n=><g key={n}><line x1={left} x2={W-right} y1={sy(maxY*n)} y2={sy(maxY*n)} stroke="#252525" strokeDasharray="3 5"/><text x={W-right+14} y={sy(maxY*n)+4}>{metric==='reserve'?number(maxY*n,1):Number(maxY*n).toExponential(1)}</text></g>)}
 {[0,.25,.5,.75,1].map(n=><g key={n}><line y1={top} y2={H-bottom} x1={sx(maxX*n)} x2={sx(maxX*n)} stroke="#1c1c1c"/><text x={sx(maxX*n)} y={H-7} textAnchor={n===0?'start':n===1?'end':'middle'}>{compact(maxX*n)}</text></g>)}
 <path d={area} fill="url(#curve-fill)"/><path d={line} fill="none" stroke="#6a5d3e" strokeWidth="1.6" strokeDasharray="3 5"/>
 <clipPath id="current-curve"><rect x="0" y="0" width={sx(token.sold)} height={H}/></clipPath><path d={line} clipPath="url(#current-curve)" fill="none" stroke="#e7bb53" strokeWidth="2.4"/>
 <line x1={sx(current.supply)} x2={sx(current.supply)} y1={sy(current[metric])} y2={H-bottom} stroke="#8e784a" strokeDasharray="4 4"/><circle cx={sx(current.supply)} cy={sy(current[metric])} r="8" fill="#f0b90b" opacity=".12"/><circle cx={sx(current.supply)} cy={sy(current[metric])} r="3.5" fill="#e7bb53"/>
 {hover!==null&&<g><line x1={sx(point.supply)} x2={sx(point.supply)} y1={top} y2={H-bottom} stroke="#777" strokeDasharray="3 4"/><circle cx={sx(point.supply)} cy={sy(point[metric])} r="4" fill="#deded7"/></g>}
 </svg><div className="chart-footnote"><span>实线：已完成区间　虚线：理论区间</span><span>内盘已售数量 / TOKEN</span></div></section>
}
