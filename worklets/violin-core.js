// Compact browser interpretation: eight held captures, delay and stereo reverb.
export const PATCH = Object.freeze({ voices: 8, loopMin: 10, loopMax: 15, retireThreshold: .003,
  layers: [[.03, .1, .255, .51], [.5, 2, .34, .6375], [3, 8, .4675, .7225]] });
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const softclip = x => Math.abs(x) <= .5 ? x : (Math.abs(x) - .25) / x;
const sineFade = x => .5 - .5 * Math.cos(Math.PI * clamp(x, 0, 1));
class Wander {
  constructor(random, hz) { this.random = random; this.hz = hz; this.a = random(); this.b = random(); this.phase = 0; }
  next(dt) { this.phase += dt * this.hz; while (this.phase >= 1) { this.phase--; this.a = this.b; this.b = this.random(); } const p = this.phase; return this.a + (this.b - this.a) * p * p * (3 - 2 * p); }
}
class Filter {
  constructor(rate, kind, hz, gain = 0) { this.rate = rate; this.kind = kind; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.tune(hz, gain); }
  tune(hz, gain = 0) {
    const w = TAU * clamp(hz, 1, this.rate * .45) / this.rate, c = Math.cos(w), s = Math.sin(w), a = s / Math.SQRT2;
    let b0, b1, b2, a0, a1, a2;
    if (this.kind === 'shelf') {
      const A = 10 ** (gain / 40), t = 2 * Math.sqrt(A) * a;
      b0 = A * ((A+1)-(A-1)*c+t); b1 = 2*A*((A-1)-(A+1)*c); b2 = A*((A+1)-(A-1)*c-t);
      a0 = (A+1)+(A-1)*c+t; a1 = -2*((A-1)+(A+1)*c); a2 = (A+1)+(A-1)*c-t;
    } else {
      const h = this.kind === 'high'; b0 = (1 + (h ? c : -c)) / 2; b1 = h ? -2*b0 : 2*b0; b2 = b0;
      a0 = 1+a; a1 = -2*c; a2 = 1-a;
    }
    this.b0=b0/a0; this.b1=b1/a0; this.b2=b2/a0; this.a1=a1/a0; this.a2=a2/a0;
  }
  tick(x) { const y = this.b0*x+this.b1*this.x1+this.b2*this.x2-this.a1*this.y1-this.a2*this.y2; this.x2=this.x1; this.x1=x; this.y2=this.y1; this.y1=y; return y; }
  clear() { this.x1=this.x2=this.y1=this.y2=0; }
}
class Delay {
  constructor(samples) { this.data = new Float32Array(Math.ceil(samples)+4); this.pos = 0; }
  read(delay) {
    const a=this.data, n=a.length, p=(this.pos-delay+n*2)%n, i=Math.floor(p), f=p-i;
    const y0=a[(i+n-1)%n],y1=a[i],y2=a[(i+1)%n],y3=a[(i+2)%n];
    return y1 + .5*f*(y2-y0+f*(2*y0-5*y1+4*y2-y3+f*(3*(y1-y2)+y3-y0)));
  }
  write(x) { this.data[this.pos]=x; this.pos=(this.pos+1)%this.data.length; }
  clear() { this.data.fill(0); this.pos=0; }
}
// Damped parallel combs followed by allpass diffusion; a compact browser room.
// The performance patch uses JPverb instead.
class Reverb {
  constructor(rate, offset) {
    this.rate=rate;
    this.combs=[.0297,.0371,.0411,.0437].map(seconds=>({line:new Delay(Math.round((seconds+offset)*rate)),damp:0,feedback:.82}));
    this.diffusers=[.005,.0017].map(seconds=>new Delay(Math.round(seconds*rate)));
  }
  setDecay(seconds) {
    for(const c of this.combs)c.feedback=Math.min(.995,Math.pow(.001,c.line.data.length/this.rate/seconds));
  }
  tick(input) {
    let sum=0;
    for(const c of this.combs){const y=c.line.data[c.line.pos];c.damp+=.35*(y-c.damp);c.line.write(input+c.damp*c.feedback);sum+=y*.25;}
    for(const d of this.diffusers){const y=d.data[d.pos],x=sum;sum=y-x;d.write(x+y*.5);}
    return sum;
  }
  clear(){for(const c of this.combs){c.line.clear();c.damp=0;}for(const d of this.diffusers)d.clear();}
}
export class ViolinEngine {
  constructor(rate, random = Math.random) {
    this.rate=rate; this.random=random; this.time=0; this.voices=Array(PATCH.voices).fill(null);
    this.inputLevel=0; this.outputLevel=0;
    this.effects={delay:true,reverb:false};this.delayMix=1;this.reverbMix=0;
    this.parameters={delayIntensity:.65,reverbSeconds:2.5};this.delayIntensity=.65;this.reverbSeconds=2.5;
    this.effectSlew=1-Math.exp(-1/(rate*.03));
    this.reverbs=[new Reverb(rate,0),new Reverb(rate,.0013)];
    this.taps=PATCH.layers.flatMap((spec, layer)=>Array.from({length:2},(_,channel)=>{
      const seconds=this.exp(spec[0],spec[1]);
      return {layer,channel,seconds,samples:Math.round(seconds*rate),line:new Delay(seconds*rate),
        low:new Filter(rate,'low',4800),high:new Filter(rate,'high',120),
        selfMod:this.wander(.02,.2),crossMod:this.wander(.015,.08),self:0,cross:0,value:0,feedback:0};
    }));
  }
  exp(a,b) { return a*(b/a)**this.random(); }
  wander(a,b) { return new Wander(this.random,this.exp(a,b)); }
  slot() { const empty=this.voices.indexOf(null); return empty>=0?empty:this.voices.reduce((id,v,i)=>v.energy<this.voices[id].energy?i:id,0); }
  record() {
    this.closeRecording();
    const id=this.slot(),samples=Math.round(this.exp(PATCH.loopMin,PATCH.loopMax)*this.rate);
    this.voices[id]={seconds:samples/this.rate,samples,data:new Float32Array(samples),pos:0,captured:0,recording:true,cycles:0,energy:0,retirePeak:0,retireFrames:0,
      peaks:new Float32Array(192),lastBin:-1,pan:0,feedback:.93+this.random()*.03,
      low:new Filter(this.rate,'low',4800),high:new Filter(this.rate,'high',120),
      panMod:this.wander(.01,.06),cutoffMod:this.wander(.02,.15),cutoff:4800};
    return id;
  }
  closeRecording() {
    for(const v of this.voices)if(v?.recording){
      v.recording=false;
      v.retirePeak=0;v.retireFrames=0;
      // Fade only already-captured samples; never admit new input after release.
      const end=Math.min(v.captured,Math.round(this.rate*.005));
      for(let i=0;i<end;i++)v.data[(v.pos-1-i+v.samples)%v.samples]*=sineFade(i/end);
    }
  }
  setEffects({delay,reverb}) {
    if(typeof delay==='boolean')this.effects.delay=delay;
    if(typeof reverb==='boolean')this.effects.reverb=reverb;
  }
  setParameters({delayIntensity,reverbSeconds}) {
    if(Number.isFinite(delayIntensity))this.parameters.delayIntensity=clamp(delayIntensity,0,1);
    if(Number.isFinite(reverbSeconds))this.parameters.reverbSeconds=clamp(reverbSeconds,.5,8);
  }
  remove(id) {
    if(!Number.isInteger(id)||id<0||id>=PATCH.voices)return;
    this.voices[id]=null;
  }
  clear() {
    this.voices.fill(null);this.inputLevel=this.outputLevel=0;
    for(const t of this.taps){t.line.clear();t.low.clear();t.high.clear();t.feedback=t.value=0;}
    for(const reverb of this.reverbs)reverb.clear();
  }
  process(input,left,right) {
    const sr=this.rate,dt=left.length/sr;
    this.reverbSeconds+=(this.parameters.reverbSeconds-this.reverbSeconds)*(1-Math.exp(-dt/.08));
    for(const reverb of this.reverbs)reverb.setDecay(this.reverbSeconds);
    for(const t of this.taps){const s=PATCH.layers[t.layer];t.self=s[2]+(s[3]-s[2])*t.selfMod.next(dt);t.cross=.03+.17*t.crossMod.next(dt);}
    for(const v of this.voices)if(v){
      v.pan=Math.cos(v.panMod.next(dt)*TAU);
      v.left=Math.sqrt((1-v.pan)/2);v.right=Math.sqrt((1+v.pan)/2);
      v.cutoff=1800*(4800/1800)**v.cutoffMod.next(dt);v.low.tune(v.cutoff);
    }
    const recording=this.voices.some(v=>v?.recording);
    for(let n=0;n<left.length;n++){
      this.delayMix+=(Number(this.effects.delay)-this.delayMix)*this.effectSlew;
      this.reverbMix+=(Number(this.effects.reverb)-this.reverbMix)*this.effectSlew;
      this.delayIntensity+=(this.parameters.delayIntensity-this.delayIntensity)*this.effectSlew;
      const raw=clamp(Number.isFinite(input[n])?input[n]:0,-2,2),live=recording?raw:0;
      this.inputLevel=Math.max(Math.abs(live),this.inputLevel*.998);
      let l=0,r=0;
      for(let id=0;id<PATCH.voices;id++){
        const v=this.voices[id];if(!v)continue;
        const value=v.high.tick(v.low.tick(v.data[v.pos]));
        const captured=v.recording?live*sineFade(v.captured/(sr*.005)):0;
        v.data[v.pos]=softclip(captured+value*v.feedback);
        l+=value*v.left;r+=value*v.right;
        const bin=Math.min(191,Math.floor(v.pos/v.samples*192));
        if(bin!==v.lastBin){v.peaks[bin]=0;v.lastBin=bin;}
        v.peaks[bin]=Math.max(v.peaks[bin],Math.abs(v.recording?captured:value));
        v.energy=Math.max(Math.abs(value),v.energy*.998);
        if(v.recording)v.captured++;
        else {
          // Inspect a complete pass after capture closes, including its recorded
          // phrase. Silence before a phrase's first return must not retire it.
          v.retirePeak=Math.max(v.retirePeak,Math.abs(value));
          if(++v.retireFrames>=v.samples){
            if(v.retirePeak<PATCH.retireThreshold)this.voices[id]=null;
            v.retirePeak=0;v.retireFrames=0;
          }
        }
        if(++v.pos===v.samples){v.pos=0;v.cycles++;}
      }
      const feed=live+(l+r)*.65;let dl=0,dr=0;
      // All reads precede writes. Only partners in the same layer cross-feed.
      for(const t of this.taps)t.value=t.line.read(t.samples);
      for(let j=0;j<this.taps.length;j++){
        const t=this.taps[j],other=this.taps[j^1];
        t.line.write(softclip((feed+t.feedback*t.self+other.feedback*t.cross)*this.delayMix));
        if(t.channel)dr+=t.value/3;else dl+=t.value/3;
      }
      for(const t of this.taps)t.feedback=t.high.tick(t.low.tick(t.value));
      const delayGain=1.8*this.delayIntensity*this.delayMix;
      const wetL=l+dl*delayGain,wetR=r+dr*delayGain;
      const revL=this.reverbs[0].tick((wetL+live*.4)*this.reverbMix),revR=this.reverbs[1].tick((wetR+live*.4)*this.reverbMix);
      left[n]=.8*Math.tanh((wetL+revL*.3*this.reverbMix)*.5);right[n]=.8*Math.tanh((wetR+revR*.3*this.reverbMix)*.5);
      this.outputLevel=Math.max(Math.abs(left[n]),Math.abs(right[n]),this.outputLevel*.998);
    }
    this.time+=dt;
  }
  snapshot() {
    return {time:this.time,input:this.inputLevel,output:this.outputLevel,effects:{...this.effects},parameters:{...this.parameters},next:this.slot(),recordings:this.voices.flatMap((v,i)=>v?.recording?[i]:[]),
      voices:this.voices.map(v=>v?{seconds:v.seconds,phase:v.pos/v.samples,fill:Math.min(1,v.captured/v.samples),recording:v.recording,energy:v.energy,pan:v.pan,cycles:v.cycles,peaks:Array.from(v.peaks)}:null)};
  }
}
