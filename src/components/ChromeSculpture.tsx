import {launchFlight} from '../chromeFlight';
import { useEffect, useRef } from 'react';

const fragment = `
precision highp float;
uniform float t;
uniform vec2 size;
uniform vec2 centers[2];
uniform float logo;
uniform vec2 pointer;
uniform vec2 pulls[2];
mat2 rotate(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
float ring(vec3 p,float phase,float radius,float thickness){
  p.yz*=rotate((1.-logo)*(.36+.26*sin(t*.5+phase)));
  p.xy*=rotate((1.-logo)*(.35+.21*sin(t*.34+phase)));
  float a=atan(p.y,p.x);
  float ripple=(1.-logo)*sin(3.*a+t*.48+phase);
  float weave=logo*.18*sin(a-.78)*(phase<1.?1.:-1.);
  float ridge=.23*(1.-logo)*sin(2.*a+t*.62+phase)+weave;
  return length(vec2(length(p.xy)-radius-.08*ripple,p.z-ridge))-(thickness+.065*ripple);
}
// Inverse stretch along the cursor-facing half of each ring.
vec3 pulled(vec3 p,vec2 pull){
  float strength=length(pull);
  vec2 axis=pull/max(strength,.0001);
  // Round the midpoint of the pull so the surface normal and its reflection stay continuous.
  float along=dot(p.xy,axis);
  float reach=.5*(along+sqrt(along*along+.09));
  p.xy-=axis*reach*strength/(1.+strength);
  return p;
}
float surface(vec3 p){
  float a=ring(pulled(p-vec3(centers[0],0.),pulls[0]),0.,mix(.73,.80,logo),mix(.24,.058,logo));
  float b=ring(pulled(p-vec3(centers[1],0.),pulls[1]),2.3,mix(.52,.64,logo),mix(.23,.058,logo));
  float blend=mix(.32,.006,logo);
  float h=max(blend-abs(a-b),0.)/blend;
  return min(a,b)-.25*h*h*blend;
}
vec4 shade(vec2 uv,out bool edge){
  edge=false;
  if(min(length(uv-centers[0])-1.38*(1.+length(pulls[0])),length(uv-centers[1])-1.18*(1.+length(pulls[1])))>0.){return vec4(0.);}
  vec3 eye=vec3(uv,2.),ray=vec3(0.,0.,-1.);
  float d=0.,closest=2.;vec3 p;
  for(int i=0;i<88;i++){
    p=eye+ray*d;
    float stepSize=surface(p);
    closest=min(closest,stepSize);
    if(stepSize<.0015 || d>5.)break;
    d+=stepSize*.71;
  }
  if(d>5. || surface(p)>.004){edge=closest<9.6/min(size.x,size.y);return vec4(0.);}
  vec2 e=vec2(.002,0.);
  vec3 n=normalize(vec3(surface(p+e.xyy)-surface(p-e.xyy),surface(p+e.yxy)-surface(p-e.yxy),surface(p+e.yyx)-surface(p-e.yyx)));
  edge=abs(n.z)<.48;
  vec3 r=reflect(ray,n);
  r.xy+=pointer*.12;
  float strip=smoothstep(.05,.16,r.y)* (1.-smoothstep(.58,.68,r.y));
  float rim=smoothstep(.73,.93,dot(r,normalize(vec3(-.7,.2,.7))));
  float red=smoothstep(.66,.92,dot(r,normalize(vec3(.85,-.37,.25))));
  vec3 metal=vec3(.11,.12,.14)+vec3(.76,.8,.84)*strip+vec3(.72)*rim+vec3(.58,.032,.048)*red;
  metal+=vec3(.19)*pow(1.-max(dot(n,-ray),0.),3.);
  metal=mix(metal,vec3(.68,.025,.065)+metal*vec3(.33,.10,.12),logo*.90);
  return vec4(metal,1.);
}
void main(){
  float pixel=4.8/min(size.x,size.y);
  vec2 uv=(gl_FragCoord.xy-.5*size)*pixel;
  bool edge;
  vec4 color=shade(uv,edge);
  if(edge){
    bool unused;
    vec2 offset=vec2(.30,.30)*pixel;
    color=.25*(shade(uv+offset,unused)+shade(uv-offset,unused)+shade(uv+vec2(offset.x,-offset.y),unused)+shade(uv+vec2(-offset.x,offset.y),unused));
  }
  gl_FragColor=color;
}`;

export default function ChromeSculpture() {
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const canvas=ref.current!;
    const gl=canvas.getContext('webgl',{alpha:true,antialias:false,powerPreference:'low-power'});
    if(!gl)return;
    const program=gl.createProgram()!;
    const shaders=[ [gl.VERTEX_SHADER,'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}'],[gl.FRAGMENT_SHADER,fragment] ] as const;
    for(const [kind,source] of shaders){
      const shader=gl.createShader(kind)!;
      gl.shaderSource(shader,source);gl.compileShader(shader);gl.attachShader(program,shader);gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);return;}
    gl.useProgram(program);
    const buffer=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const pos=gl.getAttribLocation(program,'position');
    gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    const time=gl.getUniformLocation(program,'t'),size=gl.getUniformLocation(program,'size');
    const centers=gl.getUniformLocation(program,'centers[0]'), logo=gl.getUniformLocation(program,'logo');
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    const pointer=gl.getUniformLocation(program,'pointer');
    const pullUniform=gl.getUniformLocation(program,'pulls[0]');
    const pulls=new Float32Array(4);
    let hovering=false;
    const target={x:0,y:0}, cursor={x:0,y:0};
    const stage=canvas.parentElement!.parentElement!;
    function track(event:PointerEvent){
      if(motion.matches || event.pointerType==='touch')return;
      hovering=true;
      const bounds=stage.getBoundingClientRect();
      target.x=2*(event.clientX-bounds.left)/bounds.width-1;
      target.y=1-2*(event.clientY-bounds.top)/bounds.height;
    }
    function reset(){hovering=false;target.x=target.y=0;}
    stage.addEventListener('pointermove',track);
    stage.addEventListener('pointerleave',reset);
    window.addEventListener('blur',reset);
    let frame=0,last=0,elapsed=0;
    function draw(now:number){
      if(!gl)return;
      if(now-last>=15 || motion.matches){
        const delta=Math.max(0,now-last)/1000;
        elapsed+=motion.matches?0:delta;
        const follow=1-Math.exp(-5*delta);
        cursor.x=motion.matches?0:cursor.x+(target.x-cursor.x)*follow;
        cursor.y=motion.matches?0:cursor.y+(target.y-cursor.y)*follow;
        last=now;
        const scale=Math.min(window.devicePixelRatio||1,2,2560/Math.max(canvas.clientWidth,canvas.clientHeight,1));
        const w=Math.max(1,Math.round(canvas.clientWidth*scale)),h=Math.max(1,Math.round(canvas.clientHeight*scale));
        if(canvas.width!==w || canvas.height!==h){canvas.width=w;canvas.height=h;}
        const xRange=Math.max(.15,2.4*w/Math.min(w,h)-1.1);
        const phase=(elapsed+22.5)%36;
        const ease=(value:number)=>{const x=Math.max(0,Math.min(1,value));return x*x*(3-2*x)};
        const pose=motion.matches?1:ease((phase-19)/4.4)*(1-ease((phase-28)/7.5));
        const mix=(a:number,b:number)=>a+(b-a)*pose;
        const x=xRange*.60;
        const y=.28;
        gl.viewport(0,0,w,h);gl.uniform2f(size,w,h);gl.uniform1f(time,elapsed);gl.uniform1f(logo,pose);
        const [ax,ay,bx,by]=launchFlight(elapsed,xRange);
        const positions=[mix(ax,x-.26),mix(ay,y-.26),mix(bx,x+.28),mix(by,y+.29)];
        const free=elapsed<5.5?0:1-pose;
        const mouseX=target.x*2.4*w/Math.min(w,h);
        const mouseY=target.y*2.4*h/Math.min(w,h);
        for(let i=0;i<2;i++){
          const j=2*i;
          const dx=mouseX-positions[j],dy=mouseY-positions[j+1];
          const distance=Math.hypot(dx,dy);
          const radius=i===0?.73:.52;
          const proximity=1-ease((Math.abs(distance-radius)-.2)/.95);
          const strength=hovering ? .82*proximity*ease(distance/.32) : 0;
          const rate=strength>Math.hypot(pulls[j],pulls[j+1])?8:2.3;
          const response=1-Math.exp(-rate*delta);
          pulls[j]+=(strength*dx/Math.max(.001,distance)-pulls[j])*response;
          pulls[j+1]+=(strength*dy/Math.max(.001,distance)-pulls[j+1])*response;
        }
        gl.uniform2fv(centers,positions);
        gl.uniform2f(pointer,cursor.x*free,cursor.y*free);
        gl.uniform2fv(pullUniform,pulls.map(value=>value*free));
        gl.drawArrays(gl.TRIANGLES,0,3);canvas.dataset.ready='true';
      }
      if(!motion.matches && !document.hidden)frame=requestAnimationFrame(draw);
    }
    function restart(){cancelAnimationFrame(frame);last=performance.now();if(!document.hidden)draw(last);}
    restart();motion.addEventListener('change',restart);document.addEventListener('visibilitychange',restart);window.addEventListener('resize',restart);
    return ()=>{window.removeEventListener('blur',reset);stage.removeEventListener('pointermove',track);stage.removeEventListener('pointerleave',reset);cancelAnimationFrame(frame);motion.removeEventListener('change',restart);document.removeEventListener('visibilitychange',restart);window.removeEventListener('resize',restart);gl.deleteBuffer(buffer);gl.deleteProgram(program);};
  },[]);
  return <div className="chrome-traveler" aria-hidden="true"><canvas ref={ref}/><img src="./pitch-logo.png" alt=""/></div>;
}

