import React,{useContext,useEffect,useRef} from 'react';
import {ExperienceContext} from './Experience';
import {gridVertex,gridFragment} from './reference-shaders';

export default function Atmosphere({quality='high'}){
 const host=useRef(null),cursor=useRef(null),experience=useContext(ExperienceContext),settings=useRef(experience);
 useEffect(()=>{settings.current=experience},[experience]);
 useEffect(()=>{
  let disposed=false,cleanup=()=>{};
  import('three').then(T=>{
   if(disposed)return;
   const el=host.current,reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
   if(reduced||quality==='saver'){el.classList.add('static-grid');return}
   let renderer;try{renderer=new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'})}catch{el.classList.add('static-grid');return}
   const scene=new T.Scene(),camera=new T.PerspectiveCamera(50,innerWidth/innerHeight,.1,50);camera.position.z=5;
   renderer.setPixelRatio(Math.min(devicePixelRatio,1));renderer.setSize(innerWidth,innerHeight);el.appendChild(renderer.domElement);
   const colors=Array.from({length:5},()=>new T.Color('#000000')),target=new T.Vector2(.5,.5),trails=[],trailPositions=Array.from({length:10},()=>new T.Vector2()),trailOpacities=new Float32Array(10);
   const noise=new T.TextureLoader().load('/textures/noise.png');noise.wrapS=noise.wrapT=T.RepeatWrapping;
   const uniforms={uTime:{value:0},uColor:{value:colors},uElevation:{value:.65},uGeometrySpeed:{value:quality==='medium'?.08:.12},uIncline:{value:.6},uTilt:{value:0},uColorSpeed:{value:quality==='medium'?.25:.35},uColorFrequencyX:{value:1},uColorFrequencyY:{value:1},uGridCells:{value:220},uMouse:{value:new T.Vector2(.5,.5)},uDistortionRadius:{value:.25},uDistortionStrength:{value:.15},uTrailCount:{value:0},uTrailPositions:{value:trailPositions},uTrailOpacities:{value:trailOpacities},uTrailColor:{value:new T.Color()},uTrailRadius:{value:.06},uNoiseTexture:{value:noise}};
   const material=new T.ShaderMaterial({vertexShader:gridVertex,fragmentShader:gridFragment,uniforms,transparent:true,depthWrite:false});
   const geometry=new T.PlaneGeometry(1,1,quality==='high'?200:160,quality==='high'?200:160),plane=new T.Mesh(geometry,material);scene.add(plane);
   let size=1,viewWidth=1,viewHeight=1,frame,lastTrail=0;
   const resize=()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);viewHeight=2*Math.tan(Math.PI*50/360)*5;viewWidth=viewHeight*camera.aspect;size=1.5*Math.max(viewWidth,viewHeight);plane.geometry.dispose();plane.geometry=new T.PlaneGeometry(size,size,quality==='high'?200:160,quality==='high'?200:160)};resize();
   const move=e=>{target.set((e.clientX/innerWidth-.5)*viewWidth/size+.5,(-e.clientY/innerHeight+.5)*viewHeight/size+.5);const now=performance.now();if(now-lastTrail>30){lastTrail=now;trails.push({pos:target.clone(),time:now});if(trails.length>10)trails.shift()}};
   const start=performance.now(),accent=new T.Color();
   const draw=now=>{frame=requestAnimationFrame(draw);if(document.hidden)return;uniforms.uTime.value=(now-start)/1000;accent.set(settings.current.accent);colors[0].copy(accent).multiplyScalar(.04);colors[2].copy(accent).multiplyScalar(.09);colors[4].set('#0d0d0d');uniforms.uTrailColor.value.copy(accent).multiplyScalar(.275);uniforms.uMouse.value.lerp(target,.05);while(trails.length&&now-trails[0].time>1500)trails.shift();uniforms.uTrailCount.value=trails.length;for(let i=0;i<10;i++){if(trails[i]){trailPositions[i].copy(trails[i].pos);trailOpacities[i]=Math.pow(1-(now-trails[i].time)/1500,2)}else trailOpacities[i]=0}renderer.render(scene,camera)};
   frame=requestAnimationFrame(draw);window.addEventListener('resize',resize);window.addEventListener('pointermove',move,{passive:true});
   cleanup=()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',resize);window.removeEventListener('pointermove',move);plane.geometry.dispose();material.dispose();noise.dispose();renderer.dispose();renderer.domElement.remove();el.classList.remove('static-grid')};
  });
  return()=>{disposed=true;cleanup();host.current?.classList.remove('static-grid')};
 },[quality]);
 useEffect(()=>{
  const el=cursor.current,ctx=el.getContext('2d'),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;let trail=[],frame=0,x=0,y=0,active=false;
  const resize=()=>{const d=Math.min(devicePixelRatio,2);el.width=innerWidth*d;el.height=innerHeight*d;el.style.width=`${innerWidth}px`;el.style.height=`${innerHeight}px`;ctx.setTransform(d,0,0,d,0,0)};
  const draw=now=>{trail=trail.filter(p=>now-p.time<400);ctx.clearRect(0,0,innerWidth,innerHeight);const c=settings.current.accent;for(let i=1;i<trail.length;i++){const a=1-(now-trail[i].time)/400;ctx.beginPath();ctx.moveTo(trail[i-1].x,trail[i-1].y);ctx.lineTo(trail[i].x,trail[i].y);ctx.lineWidth=.5+2.5*a;ctx.globalAlpha=.7*a;ctx.strokeStyle=c;ctx.stroke()}if(active){ctx.globalAlpha=.9;ctx.fillStyle=c;ctx.beginPath();ctx.arc(x,y,1.8,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;frame=trail.length?requestAnimationFrame(draw):0};
  const move=e=>{x=e.clientX;y=e.clientY;active=true;if(!reduced&&quality!=='saver')trail.push({x,y,time:performance.now()});if(!frame)frame=requestAnimationFrame(draw)};
  const leave=()=>{active=false;if(!frame)frame=requestAnimationFrame(draw)};
  resize();window.addEventListener('resize',resize);document.addEventListener('pointermove',move,{passive:true});document.documentElement.addEventListener('pointerleave',leave);
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',resize);document.removeEventListener('pointermove',move);document.documentElement.removeEventListener('pointerleave',leave)};
 },[quality]);
 return <><div className="atmosphere" ref={host} aria-hidden="true"/><canvas className="cursor-trail" ref={cursor} aria-hidden="true"/></>;
}
