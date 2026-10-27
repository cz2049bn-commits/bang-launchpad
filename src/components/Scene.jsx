import React,{useContext,useEffect,useRef,useState} from 'react';
import {ExperienceContext} from './Experience';
import {portraitVertex,portraitFragment,dustVertex,dustFragment} from './reference-shaders';

export default function Scene({quality='high',replay=0,onPerformance,onReady}){
 const host=useRef(null),experience=useContext(ExperienceContext),settings=useRef(experience),[status,setStatus]=useState('loading');
 useEffect(()=>{settings.current=experience},[experience]);
 useEffect(()=>{
  let disposed=false,cleanup=()=>{};setStatus('loading');onReady?.(false);settings.current.setIntroProgress(5);settings.current.setIntroError(false);
  const fail=()=>{if(!disposed){setStatus('error');settings.current.setIntroError(true);settings.current.setIntroProgress(100)}};
  Promise.all([import('three'),import('three/addons/loaders/GLTFLoader.js'),import('three/addons/math/MeshSurfaceSampler.js')]).then(([T,{GLTFLoader},{MeshSurfaceSampler}])=>{
   if(disposed)return;settings.current.setIntroProgress(20);const el=host.current,reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
   const scene=new T.Scene(),camera=new T.PerspectiveCamera(50,el.clientWidth/el.clientHeight,.1,50);camera.position.z=5;
   let renderer;try{renderer=new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'})}catch{fail();return}
   renderer.setPixelRatio(Math.min(devicePixelRatio,quality==='saver'?.8:1));renderer.setSize(el.clientWidth,el.clientHeight);el.appendChild(renderer.domElement);
   const rig=new T.Group();scene.add(rig);const cursor=new T.Vector2(9999,9999),mouse=new T.Vector2(),matcap=new T.TextureLoader().load('/textures/matcap.png');
   const count=quality==='high'?32400:quality==='medium'?14400:10000,size=quality==='high'?.35:quality==='medium'?.32:.3;
   let points,loaded=0,reportedReady=false,frame,last=performance.now(),frameCount=0,fpsTime=last;
   const uniforms={uPointSize:{value:size},uColor:{value:new T.Color('#eeeeec')},uOpacity:{value:.5},uEnergy:{value:4.5},uMode:{value:0},uLow:{value:0},uMid:{value:0},uHigh:{value:0},uBeat:{value:0},uTime:{value:0},uCursorNDC:{value:cursor},uCursorVelocity:{value:new T.Vector2()},uCursorR:{value:.2},uPushDist:{value:.3},uLerpIn:{value:.28},uExplode:{value:1},uDt:{value:.016}};
   const disposeModel=model=>model.traverse(o=>{o.geometry?.dispose();if(o.material){const list=Array.isArray(o.material)?o.material:[o.material];list.forEach(m=>{for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose()})}});
   new GLTFLoader().load('/models/cz-head.glb',gltf=>{
    if(disposed){disposeModel(gltf.scene);return}
    const model=gltf.scene;model.rotation.y=-Math.PI/2;model.updateMatrixWorld(true);const box=new T.Box3().setFromObject(model),center=box.getCenter(new T.Vector3()),scale=2.3/box.getSize(new T.Vector3()).y,nodes=[];model.traverse(n=>{if(n.isMesh)nodes.push(n)});
    const positions=[],uv=[];
    for(const node of nodes){const sampler=new MeshSurfaceSampler(node).build(),p=new T.Vector3(),normal=new T.Vector3();for(let i=0;i<Math.ceil(count/nodes.length);i++){sampler.sample(p,normal);p.applyMatrix4(node.matrixWorld).sub(center).multiplyScalar(scale);positions.push(p.x,p.y,p.z);uv.push(Math.random(),Math.random())}
     const geom=node.geometry.clone();geom.applyMatrix4(node.matrixWorld);geom.translate(-center.x,-center.y,-center.z);geom.scale(scale,scale,scale);
     const material=new T.MeshMatcapMaterial({matcap,color:0xeeeeec,transparent:true,opacity:.4,depthWrite:true});
     material.wireframe=true;material.onBeforeCompile=shader=>{shader.vertexShader='varying float vBiaY;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBiaY=position.y;');shader.fragmentShader='varying float vBiaY;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','diffuseColor.a *= smoothstep(-0.9,-0.55,vBiaY);\n#include <opaque_fragment>');};
     const mesh=new T.Mesh(geom,material);mesh.userData.faceWire=true;rig.add(mesh);
    }
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('aUv',new T.Float32BufferAttribute(uv,2));
    const material=new T.ShaderMaterial({uniforms,vertexShader:portraitVertex,fragmentShader:portraitFragment,transparent:true,depthWrite:false,blending:T.AdditiveBlending});points=new T.Points(geometry,material);points.frustumCulled=false;rig.add(points);disposeModel(model);loaded=performance.now();setStatus('ready');onReady?.(true);settings.current.setIntroProgress(95);
   },event=>{if(!disposed&&event.total)settings.current.setIntroProgress(20+Math.round(event.loaded/event.total*65))},fail);
   const dustCount=reduced?0:quality==='high'?150:quality==='medium'?75:0,dustPositions=new Float32Array(dustCount*3);
   for(let i=0;i<dustCount;i++){dustPositions[i*3]=(Math.random()-.5)*8;dustPositions[i*3+1]=(Math.random()-.5)*8-.5;dustPositions[i*3+2]=(Math.random()-.5)*4-2.5}
   const dustUniforms={uTime:{value:0},uColor:{value:new T.Color('#eee')},uOpacity:{value:.6}},dustGeometry=new T.BufferGeometry();dustGeometry.setAttribute('position',new T.BufferAttribute(dustPositions,3));const dustMaterial=new T.ShaderMaterial({uniforms:dustUniforms,vertexShader:dustVertex,fragmentShader:dustFragment,transparent:true,depthWrite:false,blending:T.AdditiveBlending});scene.add(new T.Points(dustGeometry,dustMaterial));
   const move=e=>{const r=el.getBoundingClientRect();mouse.set(e.clientX/innerWidth*2-1,e.clientY/innerHeight*2-1);cursor.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1)};
   const leave=()=>cursor.set(9999,9999);window.addEventListener('pointermove',move,{passive:true});document.documentElement.addEventListener('pointerleave',leave);
   const resize=()=>{camera.aspect=el.clientWidth/el.clientHeight;camera.updateProjectionMatrix();renderer.setSize(el.clientWidth,el.clientHeight)};const ro=new ResizeObserver(resize);ro.observe(el);
   const start=performance.now(),spectrum=new Uint8Array(128),tint=new T.Color();let previousLow=0;
   const draw=now=>{frame=requestAnimationFrame(draw);const dt=Math.min((now-last)/1000,.05);last=now;if(document.hidden)return;frameCount++;if(now-fpsTime>1500){onPerformance?.({fps:Math.round(frameCount*1000/(now-fpsTime)),dpr:renderer.getPixelRatio()});fpsTime=now;frameCount=0}const t=(now-start)/1000;
    tint.set(settings.current.accent);uniforms.uColor.value.lerp(tint,.05);dustUniforms.uColor.value.copy(tint);dustUniforms.uTime.value=reduced?0:t;
    const follow=1-Math.exp(-6*dt);rig.rotation.y+=( (reduced?0:Math.sin(t/2)/6+mouse.x*.21)-rig.rotation.y)*follow;rig.rotation.x+=((reduced?0:-mouse.y*.07)-rig.rotation.x)*follow;rig.position.y=reduced?0:Math.sin(t/2.22)/15;
    const analyser=settings.current.audioRef.current;let low=0,mid=0,high=0;if(settings.current.audio&&analyser){analyser.getByteFrequencyData(spectrum);for(let i=0;i<128;i++){const n=spectrum[i]/255*2.5;if(i<43)low+=n/43;else if(i<86)mid+=n/43;else high+=n/42}}
    for(const [key,value]of [['uLow',low],['uMid',mid],['uHigh',high]]){const a=uniforms[key].value;uniforms[key].value=a*(value>a?.55:.93)+value*(value>a?.45:.07)}
    uniforms.uBeat.value=low-previousLow>.15&&low>.3?low:0;previousLow=low;uniforms.uEnergy.value=settings.current.track==='digital'?3.5+high*2.5:4.5+high*3.5;uniforms.uMode.value=settings.current.track==='digital'?3:0;uniforms.uTime.value=reduced?0:t;uniforms.uExplode.value=reduced?0:!settings.current.entered?1:uniforms.uExplode.value*Math.exp(-dt*2.4);uniforms.uDt.value=dt;
    rig.children.forEach(m=>{if(m.userData.faceWire){m.material.color.lerp(tint,.05);m.material.opacity=.4*(1-uniforms.uExplode.value)}});renderer.render(scene,camera);if(loaded&&!reportedReady){reportedReady=true;settings.current.setIntroProgress(100)}
   };frame=requestAnimationFrame(draw);
   cleanup=()=>{cancelAnimationFrame(frame);window.removeEventListener('pointermove',move);document.documentElement.removeEventListener('pointerleave',leave);ro.disconnect();scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose()});matcap.dispose();renderer.dispose();renderer.domElement.remove()};
  }).catch(fail);
  return()=>{disposed=true;cleanup()};
 },[quality,replay,onPerformance,onReady]);
 return <div className={`scene ${status==='ready'?'scene-ready':''}`} ref={host} aria-label="交互式 CZ 粒子头像"><span className={`scene-loading ${status==='ready'?'hidden':''}`}>{status==='error'?'三维场景加载失败，请在设置中重播。':'正在唤醒 BANG...'}</span></div>;
}
