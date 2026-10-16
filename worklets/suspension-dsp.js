// Condensed interactive adaptation of v7.0.4; browser coupling is calibrated separately.
// an ideal, lossy delay-line string replaces the physical pickup/driver system.
class SuspensionProcessor extends AudioWorkletProcessor {
 constructor(){
  super();this.p={frequency:25.8,intensity:.6,brightness:180,movement:1,closed:true,auto:true,q:3};
  this.delay=new Float32Array(8192);this.index=0;this.previous=0;this.hpX=0;this.hpY=0;this.lp=0;this.dcX=0;this.dcY=0;this.svf=[[0,0],[0,0],[0,0]];this.env=0;this.baseline=.02;this.q=1.5;this.center=200;this.velocity=0;this.rescue=0;this.silent=0;this.sounding=0;this.breath=-1;this.time=0;this.report=0;this.driftClock=0;this.pluck=0;this.latch=0;this.oldEnergy=0;this.gainNorm=1;this.frequencies=[176,200,224];this.rawWave=new Float32Array(512);this.filterWave=new Float32Array(512);this.driverWave=new Float32Array(512);this.waveIndex=0;this.waveStep=0;this.rawEnergy=0;this.ramp=0;this.frequency=this.p.frequency;this.confirmed=0;this.latchClock=0;this.breathPhase='idle';this.breathTime=0;this.breathBoost=0;this.breathCount=0;this.polarity=1;this.flipClock=0;this.offsets=[-24,0,24];this.offsetVelocity=[0,0,0];this.waveSums=[0,0,0];
  this.port.onmessage=e=>{if(e.data.type==='pluck')this.pluckPending=Math.min(.18,Math.max(0,e.data.amplitude??.16));if(e.data.type==='damp'){this.delay.fill(0);this.svf=[[0,0],[0,0],[0,0]];this.env=0;this.rawEnergy=0;this.frequency=this.p.frequency;this.hpX=this.hpY=this.lp=this.dcX=this.dcY=this.previous=0;}if(e.data.type==='breath')this.breath=0;if(e.data.type==='params')Object.assign(this.p,e.data.params);};
 }
 process(inputs,outputs){
  const output=outputs[0][0],sr=sampleRate,dt=output.length/sr,p=this.p;this.time+=dt;this.report+=dt;this.driftClock+=dt;
  const energy=this.env/(1+this.env);this.baseline=Math.max(.003,this.baseline+(energy-this.baseline)*(1-Math.exp(-dt/20)));const ratio=energy/this.baseline;
  if(energy<.03&&p.closed){this.silent+=dt;this.confirmed=0;this.rescue=Math.max(this.rescue,Math.min(1,this.silent/8));}
  else {this.silent=0;this.confirmed+=dt;if(this.confirmed>2)this.rescue*=Math.exp(-dt*.14);}
  if(!p.closed){this.rescue=0;this.sounding=0;this.breathPhase='idle';this.breathTime=0;}
  // Give a growing resonance 400 ms to settle before the search moves again.
  this.latchClock+=dt;
  if(this.latchClock>=.1){if(energy-this.oldEnergy>.001&&energy>.003)this.latch=.4;this.oldEnergy=energy;this.latchClock=0;}
  this.latch=Math.max(0,this.latch-dt);
  this.breathBoost=Math.max(0,this.breathBoost-dt*(6-1.5)/5);
  let attenuation=1;
  if(this.breathPhase==='idle'){
   if(energy>.01&&this.rescue<.5&&p.closed)this.sounding+=dt;else this.sounding=0;
   if(this.sounding>30){this.breathPhase='fade';this.breathTime=0;this.breathCount++;}
  }else{
   this.breathTime+=dt;
   if(this.breathPhase==='fade'){attenuation=Math.max(0,1-this.breathTime/1.5);if(this.breathTime>=1.5){this.breathPhase='wait';this.breathTime=0;}}
   else if(this.breathPhase==='wait'){
    attenuation=0;
    if(energy<.005||this.breathTime>=5){
     const candidates=[.5,2/3,.75,4/3,1.5,2].map(r=>this.center*r).filter(f=>f>=120&&f<=380&&Math.abs(f-this.center)>35);
     this.center=candidates.length?candidates[Math.floor(Math.random()*candidates.length)]:(this.center>250?150:350);
     this.velocity=0;this.breathPhase='return';this.breathTime=0;this.breathBoost=6;
    }
   }else{attenuation=Math.min(1,this.breathTime/.5);if(this.breathTime>=.5){this.breathPhase='idle';this.sounding=0;}}
  }
  const target=Math.max(this.breathBoost,this.rescue>.5?1.5:1.5+Math.min(1,ratio)*6.5);
  this.q=p.auto?this.q+(target-this.q)*(1-Math.exp(-dt*(target<this.q?80:3))):p.q;
  this.gainNorm=1/(1+.3*ratio);
  this.driftSpeed=(1+(1-Math.min(1,ratio))*2+Math.max(0,ratio-2)*.5)*Math.sqrt(1.5/this.q)*p.movement;
  if(this.rescue>.5&&energy<.03){this.flipClock+=dt;if(this.flipClock>15){this.polarity*=-1;this.flipClock=0;}}else this.flipClock=0;
  if(this.driftClock>=.05){
   this.driftClock=0;
   if(!this.latch){
    this.velocity=(this.velocity+(Math.random()-.5)*3*this.driftSpeed+Math.sin(this.time/45*Math.PI*2)*.6*.05)*.96;
    this.center=Math.max(100,Math.min(400,this.center+this.velocity));if(this.center===100||this.center===400)this.velocity*=-.7;
    for(let i=0;i<3;i++){this.offsetVelocity[i]=(this.offsetVelocity[i]+(Math.random()-.5)*.6*p.movement)*.95;this.offsets[i]=Math.max(-40,Math.min(40,this.offsets[i]+this.offsetVelocity[i]));}
   }
  }
  const bump=.3+.7*Math.exp(-.5*((this.center-p.brightness)/100)**2),effectiveBump=bump*(1-this.rescue)+this.rescue;
  this.frequencies=this.offsets.map(o=>Math.max(100,Math.min(400,this.center+o)));
  const k=1/this.q,coeff=this.frequencies.map(f=>{const g=Math.tan(Math.PI*f/sr),a=1/(1+g*(g+k));return [a,g*a,g*g*a];});
  const hp=1/(1+2*Math.PI*80/sr),lp=2*Math.PI*8000/(sr+2*Math.PI*8000),dc=1-2*Math.PI*10/sr;
  this.frequency+=(p.frequency-this.frequency)*(1-Math.exp(-dt/.05));
  const delay=Math.max(2,Math.min(8190,sr/this.frequency)),pickupGain=1+this.rescue*2;let peak=0,prePeak=0;
  if(this.pluckPending){
   // Displace a string near one end. This excites a harmonic family immediately,
   // unlike a long, quiet noise burst. It does not connect the feedback path.
   const period=Math.ceil(delay),position=.17;
   for(let i=0;i<period;i++){const phase=i/period,shape=phase<position?phase/position:(1-phase)/(1-position);const at=(this.index-period+i+8192)%8192;this.delay[at]=this.delay[at]*.35+this.pluckPending*(shape-.5);}
   this.pluckPending=0;
  }
  for(let i=0;i<output.length;i++){
   const read=(this.index-delay+8192)%8192,lo=Math.floor(read),fraction=read-lo;
   const raw=this.delay[lo]*(1-fraction)+this.delay[(lo+1)%8192]*fraction;
   const x=raw*pickupGain;this.hpY=hp*(this.hpY+x-this.hpX);this.hpX=x;this.lp+=lp*(this.hpY-this.lp);let filtered=0;
   for(let n=0;n<3;n++){const [a1,a2,a3]=coeff[n],s=this.svf[n],v3=this.lp-s[1],v1=a1*s[0]+a2*v3,v2=s[1]+a2*s[0]+a3*v3;s[0]=2*v1-s[0];s[1]=2*v2-s[1];filtered+=k*v1;}
   const amplitude=Math.abs(filtered),tau=amplitude>this.env?.01:.2;this.env+=(amplitude-this.env)*(1-Math.exp(-1/(tau*sr)));
   this.rawEnergy+=(raw*raw-this.rawEnergy)*(1-Math.exp(-1/(.012*sr)));
   const couplingGain=1/(1+Math.pow(this.rawEnergy/.0016,2));
   const fb=filtered*p.intensity*this.gainNorm*effectiveBump*(1+this.rescue*2)*couplingGain,pre=fb-this.dcX+dc*this.dcY;this.dcX=fb;this.dcY=pre;
   const limited=Math.max(-.95,Math.min(.95,Math.tanh(pre))),driver=p.closed?limited*attenuation*this.polarity:0;
   this.pluck*=.9995;
   // Mechanical response: a lossy waveguide, driven at one point. The coupling
   // coefficient is illustrative; it is not a calibration of the installation.
   const mechanical=.996*(raw+this.previous)*.5+driver*.025+(Math.random()-.5)*(this.pluck+.000002);
   this.delay[this.index]=mechanical;this.previous=raw;this.index=(this.index+1)%8192;
   this.ramp=Math.min(1,this.ramp+1/(sr*.08));output[i]=raw*3*this.ramp;peak=Math.max(peak,Math.abs(limited));prePeak=Math.max(prePeak,Math.abs(pre));
   this.waveSums[0]+=raw;this.waveSums[1]+=filtered;this.waveSums[2]+=driver;if(++this.waveStep===8){this.waveStep=0;this.rawWave[this.waveIndex]=this.waveSums[0]/8;this.filterWave[this.waveIndex]=this.waveSums[1]/8;this.driverWave[this.waveIndex]=this.waveSums[2]/8;this.waveSums.fill(0);this.waveIndex=(this.waveIndex+1)%512;}
  }
  if(this.report>.08){this.report=0;this.port.postMessage({energy,baseline:this.baseline,q:this.q,frequencies:this.frequencies,gain:this.gainNorm,bump:effectiveBump,rescue:this.rescue,peak,prePeak,driftSpeed:this.driftSpeed,latched:this.latch>0,breathPhase:this.breathPhase,breathProgress:this.sounding/30,breathCount:this.breathCount,attenuation,polarity:this.polarity,state:!p.closed?'Driver disconnected ringing out':this.breathPhase!=='idle'?'Breathing':this.rescue>.5?'Rescuing':this.latch?'Holding resonance':'Following resonance',raw:Array.from({length:512},(_,i)=>this.rawWave[(this.waveIndex+i)%512]),filtered:Array.from({length:512},(_,i)=>this.filterWave[(this.waveIndex+i)%512]),driver:Array.from({length:512},(_,i)=>this.driverWave[(this.waveIndex+i)%512])});}
  return true;
 }
}
registerProcessor('suspension-feedback',SuspensionProcessor);
