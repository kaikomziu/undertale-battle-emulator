// ===== データモデル / 保存 / テンプレート =====
const Data = (() => {

  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function defaultSettings() {
    return {
      duration: 8000,   // ms
      boxW: 320,
      boxH: 220,
      hp: 92,
      soulSpeed: 180,   // px/sec (box space)
      damage: 8,
    };
  }

  const KIND_DEFAULTS = {
    normal:  { label: '通常(白)',       color: '#f5f5f5' },
    blue:    { label: '青(動くと当たる)', color: '#3fa9ff' },
    orange:  { label: 'オレンジ(止まると当たる)', color: '#ff8a3f' },
    blaster: { label: 'ブラスター',      color: '#eaf6ff' },
  };

  function newBone(overrides) {
    return Object.assign({
      id: uid('bone'),
      name: '骨',
      kind: 'normal',
      ease: 'linear',
      color: '#f5f5f5',
      length: 90,
      thickness: 16,
      jitter: 0,
      jitterGroup: '',
      keyframes: [
        { t: 0, x: 0, y: 0, rot: 0, scale: 1, opacity: 1 },
      ],
    }, overrides || {});
  }

  // 「〜コピー」「〜(反転)」の連続スタックを防ぎつつ複製名を作る
  function dupName(name, suffix) {
    const base = name.replace(/(コピー|\(反転\))+$/, '').trim() || name;
    return base + suffix;
  }

  function mirrorBone(bone) {
    const copy = clone(bone);
    copy.id = uid('bone');
    copy.name = dupName(bone.name, '(反転)');
    copy.keyframes = bone.keyframes.map(k => ({
      ...k,
      x: -k.x,
      rot: (180 - k.rot),
    }));
    return copy;
  }

  function newPattern(name) {
    return {
      id: uid('pat'),
      name: name || '無題の攻撃',
      updatedAt: Date.now(),
      settings: defaultSettings(),
      bones: [
        newBone({ name: '骨1', keyframes: [
          { t: 0, x: -120, y: 80, rot: 90, scale: 1, opacity: 1 },
          { t: 3000, x: 120, y: 80, rot: 90, scale: 1, opacity: 1 },
        ]}),
      ],
    };
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function sortKf(bone) {
    bone.keyframes.sort((a, b) => a.t - b.t);
  }

  // ---------- ローカル保存 ----------
  const SAVE_KEY = 'utbe_saves_v1';

  function listSaves() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return Object.values(obj).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch (e) { return []; }
  }

  function savePattern(pattern) {
    pattern.updatedAt = Date.now();
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      obj[pattern.id] = clone(pattern);
      localStorage.setItem(SAVE_KEY, JSON.stringify(obj));
      return true;
    } catch (e) { return false; }
  }

  function deleteSave(id) {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      delete obj[id];
      localStorage.setItem(SAVE_KEY, JSON.stringify(obj));
      return true;
    } catch (e) { return false; }
  }

  // ---------- 書き出し / 読み込み ----------
  function exportPattern(pattern) {
    const blob = new Blob([JSON.stringify(pattern, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (pattern.name || 'attack').replace(/[\\/:*?"<>|]/g, '_') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function importPatternFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(reader.result);
          if (!obj || !Array.isArray(obj.bones) || !obj.settings) throw new Error('bad format');
          obj.id = uid('pat');
          resolve(obj);
        } catch (e) { reject(e); }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  // ---------- テンプレート ----------
  function buildRange(n, fn) { return Array.from({ length: n }, (_, i) => fn(i)); }

  function tplSimpleSweep() {
    const p = newPattern('サンプル: 横なぎ骨');
    p.settings.duration = 6000;
    p.bones = [
      newBone({ name: '横骨', length: 70, thickness: 16, keyframes: [
        { t: 0, x: -180, y: 60, rot: 90, scale: 1, opacity: 1 },
        { t: 2500, x: 180, y: 60, rot: 90, scale: 1, opacity: 1 },
        { t: 3000, x: 180, y: 60, rot: 90, scale: 1, opacity: 0 },
      ]}),
      newBone({ name: '横骨2', length: 70, thickness: 16, keyframes: [
        { t: 3000, x: 180, y: -30, rot: 90, scale: 1, opacity: 0 },
        { t: 3000, x: 180, y: -30, rot: 90, scale: 1, opacity: 1 },
        { t: 5500, x: -180, y: -30, rot: 90, scale: 1, opacity: 1 },
        { t: 6000, x: -180, y: -30, rot: 90, scale: 1, opacity: 0 },
      ]}),
    ];
    return p;
  }

  function tplSpinner() {
    const p = newPattern('サンプル: 回転する骨');
    p.settings.duration = 8000;
    const kfs = buildRange(9, (i) => ({
      t: Math.round(i * (8000 / 8)),
      x: 0, y: 20, rot: i * 90, scale: 1, opacity: 1,
    }));
    p.bones = [
      newBone({ name: '回転骨A', length: 140, thickness: 14, keyframes: kfs }),
      newBone({ name: '回転骨B', length: 140, thickness: 14, keyframes: kfs.map(k => ({ ...k, rot: k.rot + 180 })) }),
    ];
    return p;
  }

  function tplWallGap() {
    const p = newPattern('サンプル: 隙間の壁');
    p.settings.duration = 9000;
    const laneX = [-140, -84, -28, 28, 84, 140];
    const gapSeq = [0, 2, 4, 1, 3, 5];
    const segDur = 1400;
    const bones = laneX.map((x, i) => {
      const kfs = [];
      gapSeq.forEach((gapIdx, seg) => {
        const t0 = seg * segDur;
        const isGap = gapIdx === i;
        kfs.push({ t: t0, x, y: 0, rot: 0, scale: 1, opacity: isGap ? 0 : 1 });
        kfs.push({ t: t0 + segDur - 200, x, y: 0, rot: 0, scale: 1, opacity: isGap ? 0 : 1 });
      });
      return newBone({ name: '壁' + (i + 1), length: 200, thickness: 20, keyframes: kfs });
    });
    p.bones = bones;
    return p;
  }

  function tplCrossFire() {
    const p = newPattern('サンプル: 十字連打');
    p.settings.duration = 8000;
    const dirs = [
      { from: { x: -220, y: 0 }, to: { x: 220, y: 0 }, rot: 90 },
      { from: { x: 220, y: 0 }, to: { x: -220, y: 0 }, rot: 90 },
      { from: { x: 0, y: -160 }, to: { x: 0, y: 160 }, rot: 0 },
      { from: { x: 0, y: 160 }, to: { x: 0, y: -160 }, rot: 0 },
    ];
    const bones = [];
    let t = 0;
    for (let wave = 0; wave < 4; wave++) {
      const d = dirs[wave % dirs.length];
      bones.push(newBone({ name: '弾' + (wave + 1), length: 80, thickness: 16, keyframes: [
        { t: t, x: d.from.x, y: d.from.y, rot: d.rot, scale: 1, opacity: 1 },
        { t: t + 1600, x: d.to.x, y: d.to.y, rot: d.rot, scale: 1, opacity: 1 },
        { t: t + 1700, x: d.to.x, y: d.to.y, rot: d.rot, scale: 1, opacity: 0 },
      ]}));
      t += 900;
    }
    p.bones = bones;
    return p;
  }

  function tplWave() {
    const p = newPattern('サンプル: 波状の骨');
    p.settings.duration = 8000;
    const bones = buildRange(5, (i) => {
      const baseX = -200 + i * 100;
      const phase = i * 0.6;
      const kfs = buildRange(9, (s) => {
        const t = s * 1000;
        const y = Math.sin(t / 1000 + phase) * 70;
        return { t, x: baseX, y, rot: 0, scale: 1, opacity: 1 };
      });
      return newBone({ name: '波骨' + (i + 1), length: 40, thickness: 40, color: '#eaf6ff', keyframes: kfs });
    });
    p.bones = bones;
    return p;
  }

  function tplBlueOrange() {
    const p = newPattern('サンプル: 青とオレンジ');
    p.settings.duration = 10000;
    p.bones = [
      newBone({ name: '青骨(動くと危険)', kind: 'blue', color: KIND_DEFAULTS.blue.color, length: 300, thickness: 18, keyframes: [
        { t: 0, x: 0, y: -70, rot: 0, scale: 1, opacity: 1 },
        { t: 5000, x: 0, y: -70, rot: 0, scale: 1, opacity: 1 },
        { t: 5001, x: 0, y: -70, rot: 0, scale: 1, opacity: 0 },
      ]}),
      newBone({ name: 'オレンジ骨(止まると危険)', kind: 'orange', color: KIND_DEFAULTS.orange.color, length: 300, thickness: 18, keyframes: [
        { t: 5000, x: 0, y: 70, rot: 0, scale: 1, opacity: 0 },
        { t: 5001, x: 0, y: 70, rot: 0, scale: 1, opacity: 1 },
        { t: 10000, x: 0, y: 70, rot: 0, scale: 1, opacity: 1 },
      ]}),
    ];
    return p;
  }

  function tplBlaster() {
    const p = newPattern('サンプル: ガスターブラスター');
    p.settings.duration = 9000;
    const mkBlaster = (name, x, y, rot) => newBone({
      name, kind: 'blaster', color: KIND_DEFAULTS.blaster.color, length: 420, thickness: 46,
      keyframes: [
        { t: 0, x, y, rot, scale: 1, opacity: 0 },
        { t: 900, x, y, rot, scale: 1, opacity: 0.4 },
        { t: 1500, x, y, rot, scale: 1, opacity: 1 },
        { t: 2100, x, y, rot, scale: 1, opacity: 1 },
        { t: 2300, x, y, rot, scale: 1, opacity: 0 },
      ],
    });
    p.bones = [
      mkBlaster('ブラスター(左から)', -180, 0, 0),
      Object.assign(mkBlaster('ブラスター(上から)', 0, -130, 90), {
        keyframes: mkBlaster('', 0, -130, 90).keyframes.map(k => ({ ...k, t: k.t + 2600 })),
      }),
      Object.assign(mkBlaster('ブラスター(右から)', 220, 40, 180), {
        keyframes: mkBlaster('', 220, 40, 180).keyframes.map(k => ({ ...k, t: k.t + 5200 })),
      }),
    ];
    return p;
  }

  function tplGrowingSpike() {
    const p = newPattern('サンプル: 伸び縮みする骨');
    p.settings.duration = 8000;
    const mkSpike = (x, y, rot, delay) => newBone({
      name: '伸縮骨', length: 20, thickness: 20, keyframes: [
        { t: delay, x, y, rot, scale: 1, opacity: 1, length: 10, thickness: 14 },
        { t: delay + 500, x, y, rot, scale: 1, opacity: 1, length: 260, thickness: 26 },
        { t: delay + 1300, x, y, rot, scale: 1, opacity: 1, length: 260, thickness: 26 },
        { t: delay + 1700, x, y, rot, scale: 1, opacity: 0, length: 10, thickness: 14 },
      ],
    });
    p.bones = [
      mkSpike(-140, 100, -90, 0),
      mkSpike(0, 100, -90, 500),
      mkSpike(140, 100, -90, 1000),
      mkSpike(-140, -100, 90, 2600),
      mkSpike(0, -100, 90, 3100),
      mkSpike(140, -100, 90, 3600),
      mkSpike(-140, 100, -90, 5200),
      mkSpike(0, 100, -90, 5700),
      mkSpike(140, 100, -90, 6200),
    ];
    return p;
  }

  const TEMPLATES = [
    { id: 'tpl_sweep', label: '横なぎ骨', desc: '左右からシンプルに骨が流れてくる入門用パターン。', build: tplSimpleSweep },
    { id: 'tpl_spin', label: '回転する骨', desc: '中央で長い骨が回転し続ける。回転キーフレームの作例。', build: tplSpinner },
    { id: 'tpl_wall', label: '隙間の壁', desc: '骨の壁に空いた隙間を通り抜けていくパピルス風の壁攻撃。', build: tplWallGap },
    { id: 'tpl_cross', label: '十字連打', desc: '上下左右から交互に骨が飛んでくる連続攻撃。', build: tplCrossFire },
    { id: 'tpl_wave', label: '波状の骨', desc: '複数の短い骨がサインカーブ状に上下する。', build: tplWave },
    { id: 'tpl_blueorange', label: '青とオレンジ', desc: '青骨は動くと被弾、オレンジ骨は止まると被弾。切り替えを体感できる。', build: tplBlueOrange },
    { id: 'tpl_blaster', label: 'ガスターブラスター', desc: '溜めてから発射するブラスター攻撃。3方向から順に撃ってくる。', build: tplBlaster },
    { id: 'tpl_spike', label: '伸び縮みする骨', desc: '床と天井から槍のように伸び上がる骨。長さ・太さのキーフレームの作例。', build: tplGrowingSpike },
  ];

  return {
    uid, defaultSettings, newBone, mirrorBone, dupName, newPattern, clone, sortKf,
    listSaves, savePattern, deleteSave,
    exportPattern, importPatternFile,
    KIND_DEFAULTS, TEMPLATES,
  };
})();
