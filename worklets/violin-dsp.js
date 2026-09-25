import { ViolinEngine } from './violin-core.js';
class ViolinProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.engine = new ViolinEngine(sampleRate); this.frames = 0; this.revision = 0;
    this.port.onmessage = ({ data: m }) => {
      if (m.type === 'record') this.port.postMessage({ type: 'selected', id: this.engine.record(), revision: this.revision });
      if (m.type === 'close') this.engine.closeRecording();
      if (m.type === 'clear' || m.type === 'remove') {
        if (m.type === 'clear') this.engine.clear(); else this.engine.remove(m.id);
        this.revision = m.revision ?? this.revision + 1;
        this.publish();
      }
      if (m.type === 'effects') this.engine.setEffects(m);
      if (m.type === 'parameters') this.engine.setParameters(m);
    };
  }
  publish() { this.port.postMessage({ type: 'state', ...this.engine.snapshot(), revision: this.revision }); }
  process(inputs, outputs) {
    const out = outputs[0];
    this.engine.process(inputs[0]?.[0] || [], out[0], out[1]);
    this.frames += out[0].length;
    if (this.frames >= sampleRate / 20) { this.frames = 0; this.publish(); }
    return true;
  }
}
registerProcessor('violin-performance', ViolinProcessor);
