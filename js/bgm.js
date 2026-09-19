// ===== BGM(WebAudio自作合成のループ、外部音源は使用しない) =====
const Bgm = (() => {
  const STORE_KEY = 'utbe_bgm_enabled_v1';
  let ac = null;
  let enabled = true;
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v !== null) enabled = v === '1';
  } catch (e) { /* noop */ }

  let master = null;
  let timerId = null;
  let nextStepTime = 0;
  let stepIndex = 0;
  let activeTrackId = 'none';

  function ctx() {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function getMaster() {
    const a = ctx();
    if (!master) {
      master = a.createGain();
      master.gain.value = 0.22;
      master.connect(a.destination);
    }
    return master;
  }

  function freqFromSemitone(rootFreq, semi) {
    return rootFreq * Math.pow(2, semi / 12);
  }

  function pluck(freq, time, dur, type, vol) {
    const a = ctx();
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(gain).connect(getMaster());
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  function kick(time) {
    const a = ctx();
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    osc.connect(gain).connect(getMaster());
    osc.start(time);
    osc.stop(time + 0.2);
  }

  const TRACKS = {
    tense: {
      bpm: 132, bassRoot: 73.42, leadRoot: 293.66,
      bass: [0, null, 0, null, 3, null, 0, null],
      kick: [1, 0, 0, 0, 1, 0, 0, 0],
      lead: null,
    },
    battle: {
      bpm: 150, bassRoot: 82.41, leadRoot: 329.63,
      bass: [0, 3, 0, 5, 0, 3, 0, -2],
      kick: [1, 0, 1, 0, 1, 0, 1, 0],
      lead: [0, 3, 7, 10, 7, 3, 0, null],
    },
    calm: {
      bpm: 86, bassRoot: 98.00, leadRoot: 392.00,
      bass: [0, null, null, null, 5, null, null, null],
      kick: [0, 0, 0, 0, 0, 0, 0, 0],
      lead: [0, null, 4, null, 7, null, 4, null],
    },
  };

  const TRACK_LABELS = { none: 'なし', tense: '緊迫', battle: 'バトル', calm: 'おだやか' };

  function scheduler() {
    const track = TRACKS[activeTrackId];
    if (!track) return;
    const a = ctx();
    const stepDur = 60 / track.bpm / 2;
    while (nextStepTime < a.currentTime + 0.12) {
      const i = stepIndex % track.bass.length;
      if (track.bass[i] !== null) pluck(freqFromSemitone(track.bassRoot, track.bass[i]), nextStepTime, stepDur * 1.8, 'triangle', 0.5);
      if (track.lead && track.lead[i] !== null) pluck(freqFromSemitone(track.leadRoot, track.lead[i]), nextStepTime, stepDur * 0.9, 'square', 0.16);
      if (track.kick[i]) kick(nextStepTime);
      nextStepTime += stepDur;
      stepIndex++;
    }
    timerId = setTimeout(scheduler, 30);
  }

  function play(trackId) {
    stop();
    if (!enabled || !trackId || trackId === 'none' || !TRACKS[trackId]) return;
    activeTrackId = trackId;
    stepIndex = 0;
    nextStepTime = ctx().currentTime + 0.05;
    getMaster().gain.value = 0.22;
    scheduler();
  }

  function stop() {
    if (timerId) clearTimeout(timerId);
    timerId = null;
    activeTrackId = 'none';
  }

  function setEnabled(v) {
    enabled = !!v;
    try { localStorage.setItem(STORE_KEY, enabled ? '1' : '0'); } catch (e) { /* noop */ }
    if (!enabled) stop();
  }
  function isEnabled() { return enabled; }

  return { play, stop, setEnabled, isEnabled, TRACK_LABELS };
})();
