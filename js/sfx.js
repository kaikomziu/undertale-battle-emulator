// ===== 効果音(WebAudio自作合成、外部音源は使用しない) =====
const Sfx = (() => {
  const STORE_KEY = 'utbe_sound_v1';
  let ac = null;
  let enabled = true;
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v !== null) enabled = v === '1';
  } catch (e) { /* noop */ }

  function ctx() {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function tone(freq, dur, type, vol, delay) {
    if (!enabled) return;
    const a = ctx();
    const t0 = a.currentTime + (delay || 0);
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol || 0.2, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, vol) {
    if (!enabled) return;
    const a = ctx();
    const n = Math.max(1, Math.floor(a.sampleRate * dur));
    const buffer = a.createBuffer(1, n, a.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = a.createBufferSource();
    src.buffer = buffer;
    const gain = a.createGain();
    gain.gain.value = vol || 0.25;
    src.connect(gain).connect(a.destination);
    src.start();
  }

  function hit() { noiseBurst(0.14, 0.28); tone(110, 0.18, 'square', 0.14); }
  function win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.16, i * 0.11)); }
  function lose() { [320, 260, 210, 150].forEach((f, i) => tone(f, 0.4, 'sawtooth', 0.13, i * 0.16)); }
  function blip() { tone(660, 0.06, 'square', 0.08); }

  function setEnabled(v) {
    enabled = !!v;
    try { localStorage.setItem(STORE_KEY, enabled ? '1' : '0'); } catch (e) { /* noop */ }
  }
  function isEnabled() { return enabled; }

  return { hit, win, lose, blip, setEnabled, isEnabled };
})();
