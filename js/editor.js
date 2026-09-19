// ===== エディタ画面のロジック =====
const Editor = (() => {
  const PX_PER_SEC_DEFAULT = 90;
  const PX_PER_SEC_MIN = 30;
  const PX_PER_SEC_MAX = 240;
  let PX_PER_SEC = PX_PER_SEC_DEFAULT;
  const KF_EPS = 10; // ms

  let pattern = null;
  let selectedBoneId = null;
  let selectedKf = null; // 実オブジェクト参照
  let scrubTime = 0;
  let previewPlaying = false;
  let previewRAF = null;
  let previewStartPerf = 0;
  let previewStartScrub = 0;
  let drag = null; // {mode:'move'|'rotate', boneId}

  let canvas, ctx, tr;

  const el = {};

  function qs(id) { return document.getElementById(id); }

  function init(initialPattern) {
    canvas = qs('stageCanvas');
    ctx = canvas.getContext('2d');

    ['patternName', 'boneList', 'btnAddBone', 'newBoneKind',
     'setDuration', 'setHp', 'setSoulSpeed', 'setDamage', 'setBoxW', 'setBoxH',
     'setGravityDir', 'setGravityStrength', 'setBgm', 'btnBgmPreview',
     'btnPreviewPlay', 'btnPreviewStop', 'scrubReadout', 'durReadout',
     'boneProps', 'kfList', 'kfEditor', 'kfTime', 'kfX', 'kfY', 'kfRot', 'kfScale', 'kfOpacity', 'kfLength', 'kfThick',
     'btnDupKf', 'btnDelKf', 'btnAddKfNow', 'btnShowNow', 'btnHideNow',
     'timelineScroll', 'timelineRuler', 'timelineTracks', 'playhead',
     'btnZoomIn', 'btnZoomOut', 'zoomReadout'].forEach(id => el[id] = qs(id));

    el.newBoneKind.innerHTML = Object.keys(Data.KIND_DEFAULTS).map(k =>
      `<option value="${k}">${Data.KIND_DEFAULTS[k].label}</option>`).join('');
    el.setBgm.innerHTML = Object.keys(Bgm.TRACK_LABELS).map(k =>
      `<option value="${k}">${Bgm.TRACK_LABELS[k]}</option>`).join('');

    setPattern(initialPattern);
    bindEvents();

    fitStageCanvas();
    window.addEventListener('resize', fitStageCanvas);
    if (window.ResizeObserver) {
      new ResizeObserver(fitStageCanvas).observe(qs('stagePanel'));
    }
  }

  // キャンバスの表示サイズを、パネルの実際の余白(ツールバー・注意書きを除いた分)に
  // 収まるよう縦横比640:420を保ったまま調整する(画面が低いとプレビューが入り切らない対策)
  function fitStageCanvas() {
    const panel = qs('stagePanel');
    const toolbar = document.querySelector('.stageToolbar');
    const hint = document.querySelector('.stageHint');
    if (!panel || !canvas) return;
    const cs = getComputedStyle(panel);
    const padV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const padH = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const availH = panel.clientHeight - padV - (toolbar ? toolbar.offsetHeight : 0) - (hint ? hint.offsetHeight : 0) - 20;
    const availW = panel.clientWidth - padH - 4;
    const ratio = 640 / 420;
    let w = Math.max(160, availW);
    let h = w / ratio;
    if (h > availH) { h = Math.max(105, availH); w = h * ratio; }
    canvas.style.width = Math.floor(w) + 'px';
    canvas.style.height = Math.floor(h) + 'px';
  }

  function setPattern(p) {
    pattern = p;
    selectedBoneId = pattern.bones[0] ? pattern.bones[0].id : null;
    selectedKf = null;
    scrubTime = 0;
    stopPreview();
    el.patternName.value = pattern.name;
    syncSettingsInputs();
    renderAll();
  }

  function getPattern() { return pattern; }

  function syncSettingsInputs() {
    const s = pattern.settings;
    el.setDuration.value = (s.duration / 1000).toString();
    el.setHp.value = s.hp;
    el.setSoulSpeed.value = s.soulSpeed;
    el.setDamage.value = s.damage;
    el.setBoxW.value = s.boxW;
    el.setBoxH.value = s.boxH;
    el.setGravityDir.value = s.gravityDir || 'none';
    el.setGravityStrength.value = (typeof s.gravityStrength === 'number') ? s.gravityStrength : 80;
    el.setBgm.value = s.bgm || 'none';
    el.durReadout.textContent = (s.duration / 1000).toFixed(2);
    Bgm.stop();
    el.btnBgmPreview.textContent = '▶ 試聴';
  }

  function findBone(id) { return pattern.bones.find(b => b.id === id); }

  function boxPosFromEvent(evt) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
    const px = (evt.clientX - rect.left) * sx;
    const py = (evt.clientY - rect.top) * sy;
    return tr.toBox(px, py);
  }

  function upsertKfAtScrub(bone, patch) {
    let kf = bone.keyframes.find(k => Math.abs(k.t - scrubTime) <= KF_EPS);
    if (!kf) {
      const s = Render.sampleBone(bone, scrubTime);
      kf = { t: Math.round(scrubTime), x: s.x, y: s.y, rot: s.rot, scale: s.scale, opacity: s.visible ? s.opacity : 1 };
      bone.keyframes.push(kf);
    }
    Object.assign(kf, patch);
    Data.sortKf(bone);
    selectedKf = kf;
    return kf;
  }

  // 「この時刻で消す/出現」用: 直前のキーフレームがどれだけ離れていても、
  // だんだん透明になるフェードにならないよう、現在時刻の見た目を一旦固定してから
  // 1ms後に不透明度だけ切り替える(ほぼ瞬時のオン/オフに見える)。
  function snapOpacity(bone, targetOpacity) {
    upsertKfAtScrub(bone, {}); // 現在時刻の見た目をそのまま固定
    const cur = Render.sampleBone(bone, scrubTime);
    const snapT = Math.min(pattern.settings.duration, Math.round(scrubTime) + 1);
    bone.keyframes = bone.keyframes.filter(k => Math.abs(k.t - snapT) > 1 || k.t === Math.round(scrubTime));
    const kf = { t: snapT, x: cur.x, y: cur.y, rot: cur.rot, scale: cur.scale, opacity: targetOpacity };
    bone.keyframes.push(kf);
    Data.sortKf(bone);
    selectedKf = kf;
    return kf;
  }

  // ---------- 描画 ----------
  function renderStage() {
    const s = pattern.settings;
    tr = Render.makeTransform(canvas, s.boxW, s.boxH);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Render.drawBox(ctx, tr, s.boxW, s.boxH);
    Render.drawGravityHint(ctx, tr, s.boxW, s.boxH, s.gravityDir);
    pattern.bones.forEach(b => {
      if (b.kind !== 'blaster') {
        const tg = Render.sampleTelegraph(b, scrubTime);
        if (tg) Render.drawTelegraph(ctx, tr, b, tg);
      }
      const sample = Render.sampleBone(b, scrubTime);
      Render.drawBone(ctx, tr, b, sample, { selected: b.id === selectedBoneId });
    });
    el.scrubReadout.textContent = (scrubTime / 1000).toFixed(2);
  }

  function renderBoneList() {
    el.boneList.innerHTML = '';
    pattern.bones.forEach(b => {
      const row = document.createElement('div');
      row.className = 'boneRow' + (b.id === selectedBoneId ? ' selected' : '');
      row.innerHTML = `<span class="swatch" style="background:${b.color}"></span><span class="bname">${escapeHtml(b.name)}</span>`;
      row.addEventListener('click', () => { selectedBoneId = b.id; selectedKf = null; renderAll(); });
      el.boneList.appendChild(row);
    });
  }

  function renderBoneProps() {
    const b = findBone(selectedBoneId);
    if (!b) { el.boneProps.className = 'boneProps empty'; el.boneProps.textContent = '骨を選択してください'; return; }
    el.boneProps.className = 'boneProps';
    const kindOptions = Object.keys(Data.KIND_DEFAULTS).map(k =>
      `<option value="${k}"${b.kind === k ? ' selected' : ''}>${Data.KIND_DEFAULTS[k].label}</option>`).join('');
    el.boneProps.innerHTML = `
      <label>名前<input id="bpName" type="text" value="${escapeAttr(b.name)}" maxlength="16"></label>
      <label>種類<select id="bpKind">${kindOptions}</select></label>
      <label>色<input id="bpColor" type="color" value="${b.color}"></label>
      <label>補間<select id="bpEase">
        <option value="linear"${b.ease !== 'easeInOut' ? ' selected' : ''}>直線</option>
        <option value="easeInOut"${b.ease === 'easeInOut' ? ' selected' : ''}>イーズ</option>
      </select></label>
      <label>長さ(初期値)${b.kind === 'blaster' ? '・射程' : ''}<input id="bpLength" type="number" min="10" max="600" step="2" value="${b.length}"></label>
      <label>太さ(初期値)${b.kind === 'blaster' ? '・ビーム幅' : ''}<input id="bpThick" type="number" min="4" max="120" step="2" value="${b.thickness}"></label>
      <p class="propsHint">長さ・太さはキーフレームごとに上書き可能(下のキーフレーム欄)。ここは上書きしていないキーフレームに使われる初期値。</p>
      <label>予告線(出現の何ms前に表示)${b.kind === 'blaster' ? '・溜め演出があるため非表示' : ''}<input id="bpTelegraph" type="number" min="0" max="3000" step="50" value="${b.telegraph || 0}"${b.kind === 'blaster' ? ' disabled' : ''}></label>
      <p class="propsHint">出現する直前に、点線の輪郭だけをその位置に薄く表示する(当たり判定は無い)。0にすると予告なしでいきなり出現する。</p>
      <label>ランダム幅(±ms)<input id="bpJitter" type="number" min="0" max="5000" step="50" value="${b.jitter || 0}"></label>
      <label>ランダムグループ(任意)<input id="bpJitterGroup" type="text" maxlength="20" value="${escapeAttr(b.jitterGroup || '')}" placeholder="空欄なら単独で揺れる"></label>
      <p class="propsHint">プレイ開始のたびに、この骨のタイミングを±ランダム幅の範囲でずらす。同じ「ランダムグループ」名を持つ骨同士は必ず同じだけずれる(壁の隙間など複数の骨を連動させたい時に使う)。パターンを覚えられてしまう問題を防ぐための機能。</p>
      <div class="boneBtnRow">
        <button id="bpDup" class="tbtn">複製</button>
        <button id="bpMirror" class="tbtn">反転複製</button>
        <button id="bpDel" class="tbtn danger">削除</button>
      </div>`;
    qs('bpName').addEventListener('input', e => { b.name = e.target.value || '骨'; renderBoneList(); });
    qs('bpKind').addEventListener('change', e => {
      b.kind = e.target.value;
      b.color = Data.KIND_DEFAULTS[b.kind].color;
      renderBoneProps(); renderStage(); renderBoneList();
    });
    qs('bpColor').addEventListener('input', e => { b.color = e.target.value; renderStage(); renderBoneList(); renderTimeline(); });
    qs('bpEase').addEventListener('change', e => { b.ease = e.target.value; renderStage(); });
    qs('bpLength').addEventListener('input', e => { b.length = Number(e.target.value) || 10; renderStage(); renderKfList(); });
    qs('bpThick').addEventListener('input', e => { b.thickness = Number(e.target.value) || 4; renderStage(); renderKfList(); });
    qs('bpTelegraph').addEventListener('input', e => { b.telegraph = Math.max(0, Number(e.target.value) || 0); renderStage(); });
    qs('bpJitter').addEventListener('input', e => { b.jitter = Math.max(0, Number(e.target.value) || 0); });
    qs('bpJitterGroup').addEventListener('input', e => { b.jitterGroup = e.target.value; });
    qs('bpDup').addEventListener('click', () => {
      const copy = Data.clone(b);
      copy.id = Data.uid('bone');
      copy.name = Data.dupName(b.name, 'コピー');
      pattern.bones.push(copy);
      selectedBoneId = copy.id; selectedKf = null;
      renderAll();
    });
    qs('bpMirror').addEventListener('click', () => {
      const copy = Data.mirrorBone(b);
      pattern.bones.push(copy);
      selectedBoneId = copy.id; selectedKf = null;
      renderAll();
    });
    qs('bpDel').addEventListener('click', () => {
      if (!confirm(`「${b.name}」を削除しますか?`)) return;
      pattern.bones = pattern.bones.filter(x => x.id !== b.id);
      selectedBoneId = pattern.bones[0] ? pattern.bones[0].id : null;
      selectedKf = null;
      renderAll();
    });
  }

  function renderKfList() {
    const b = findBone(selectedBoneId);
    el.btnAddKfNow.disabled = !b;
    el.btnShowNow.disabled = !b;
    el.btnHideNow.disabled = !b;
    if (!b || b.keyframes.length === 0) {
      el.kfList.className = 'kfList empty';
      el.kfList.textContent = b ? 'キーフレームがありません' : '';
      el.kfEditor.classList.add('hidden');
      return;
    }
    el.kfList.className = 'kfList';
    el.kfList.innerHTML = '';
    b.keyframes.forEach(k => {
      const chip = document.createElement('div');
      chip.className = 'kfChip' + (k === selectedKf ? ' selected' : '');
      chip.textContent = (k.t / 1000).toFixed(2) + 's';
      chip.addEventListener('click', () => { selectedKf = k; renderKfEditor(); renderKfList(); renderTimeline(); });
      el.kfList.appendChild(chip);
    });
    renderKfEditor();
  }

  function renderKfEditor() {
    const b = findBone(selectedBoneId);
    if (!b || !selectedKf) { el.kfEditor.classList.add('hidden'); return; }
    el.kfEditor.classList.remove('hidden');
    el.kfTime.value = (selectedKf.t / 1000).toFixed(2);
    el.kfX.value = Math.round(selectedKf.x);
    el.kfY.value = Math.round(selectedKf.y);
    el.kfRot.value = Math.round(selectedKf.rot);
    el.kfScale.value = selectedKf.scale;
    el.kfOpacity.value = selectedKf.opacity;
    el.kfLength.value = Math.round(typeof selectedKf.length === 'number' ? selectedKf.length : b.length);
    el.kfThick.value = Math.round(typeof selectedKf.thickness === 'number' ? selectedKf.thickness : b.thickness);
  }

  function setZoom(px) {
    PX_PER_SEC = clamp(px, PX_PER_SEC_MIN, PX_PER_SEC_MAX);
    el.zoomReadout.textContent = Math.round((PX_PER_SEC / PX_PER_SEC_DEFAULT) * 100) + '%';
    renderTimeline();
  }

  function renderTimeline() {
    const dur = pattern.settings.duration;
    const width = Math.max(300, (dur / 1000) * PX_PER_SEC + 40);
    el.timelineRuler.style.width = width + 'px';
    el.timelineTracks.style.width = width + 'px';

    el.timelineRuler.innerHTML = '';
    const stepCandidates = [0.5, 1, 2, 5, 10, 20];
    const step = stepCandidates.find(s => s * PX_PER_SEC >= 60) || 20;
    for (let sec = 0; sec <= dur / 1000 + 0.001; sec += step) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.style.left = (sec * PX_PER_SEC) + 'px';
      tick.textContent = sec.toFixed(step < 1 ? 1 : 0) + 's';
      el.timelineRuler.appendChild(tick);
    }

    el.timelineTracks.innerHTML = '';
    pattern.bones.forEach(b => {
      const track = document.createElement('div');
      track.className = 'track' + (b.id === selectedBoneId ? ' selected' : '');
      track.dataset.boneId = b.id;
      const label = document.createElement('div');
      label.className = 'trackLabel';
      label.textContent = b.name;
      track.appendChild(label);
      b.keyframes.forEach(k => {
        const marker = document.createElement('div');
        marker.className = 'kfMarker' + (k === selectedKf && b.id === selectedBoneId ? ' selected' : '');
        marker.style.left = ((k.t / 1000) * PX_PER_SEC) + 'px';
        if (!(k === selectedKf && b.id === selectedBoneId)) marker.style.background = b.color;
        marker.title = (k.t / 1000).toFixed(2) + 's';
        marker.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          selectedBoneId = b.id; selectedKf = k;
          renderBoneList(); renderKfList(); renderTimeline(); renderStage();
          startMarkerDrag(b, k, e);
        });
        track.appendChild(marker);
      });
      track.addEventListener('pointerdown', (e) => {
        if (e.target !== track && e.target !== label) return;
        selectedBoneId = b.id; selectedKf = null;
        const t = clamp(((e.offsetX) / PX_PER_SEC) * 1000, 0, dur);
        scrubTime = t;
        renderBoneList(); renderKfList(); renderTimeline(); renderStage();
        startTrackDrag(b, e);
      });
      el.timelineTracks.appendChild(track);
    });

    el.playhead.style.left = ((scrubTime / 1000) * PX_PER_SEC) + 'px';
    el.playhead.style.height = (el.timelineRuler.offsetHeight + el.timelineTracks.offsetHeight) + 'px';
  }

  function startMarkerDrag(bone, kf, evt) {
    const move = (e) => {
      const rect = el.timelineTracks.getBoundingClientRect();
      const x = e.clientX - rect.left;
      kf.t = Math.round(clamp((x / PX_PER_SEC) * 1000, 0, pattern.settings.duration));
      renderTimeline();
    };
    const up = () => {
      Data.sortKf(bone);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      renderKfList(); renderTimeline(); renderStage();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  // トラック全体をドラッグして、その骨の全キーフレームをまとめて時間シフトする
  // (登場タイミングをまるごと前後にずらしたい時、一つずつキーフレームを動かさなくて済む)
  function startTrackDrag(bone, evt) {
    const startX = evt.clientX;
    const originalTimes = bone.keyframes.map(k => k.t);
    const minT = Math.min(...originalTimes);
    const maxT = Math.max(...originalTimes);
    const dur = pattern.settings.duration;
    let dragging = false;
    const move = (e) => {
      const dxPx = e.clientX - startX;
      if (!dragging && Math.abs(dxPx) > 4) {
        dragging = true;
        el.timelineTracks.classList.add('dragging');
      }
      if (!dragging) return;
      let dtMs = (dxPx / PX_PER_SEC) * 1000;
      dtMs = clamp(dtMs, -minT, dur - maxT);
      bone.keyframes.forEach((k, i) => { k.t = Math.round(originalTimes[i] + dtMs); });
      renderTimeline(); renderStage(); renderKfList();
    };
    const up = () => {
      el.timelineTracks.classList.remove('dragging');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  function renderAll() {
    renderStage();
    renderBoneList();
    renderBoneProps();
    renderKfList();
    renderTimeline();
  }

  // ---------- キャンバス操作 ----------
  // 指定したスクリーン上のピクセル数を、現在のキャンバス表示倍率を踏まえて
  // 箱スペースの単位に変換する(キャンバスが小さく表示されているスマホでも
  // タップの当たり判定が指の大きさ分きちんと確保されるようにするため)
  function screenPxToBox(px) {
    const rect = canvas.getBoundingClientRect();
    const dispScale = rect.width > 0 ? canvas.width / rect.width : 1;
    return (px * dispScale) / tr.scale;
  }

  function hitTestBone(bx, by, bone, sample) {
    const pad = screenPxToBox(16);
    const rad = -sample.rot * Math.PI / 180;
    const dx = bx - sample.x, dy = by - sample.y;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    const hl = (sample.length * sample.scale) / 2 + pad;
    const ht = (sample.thickness * sample.scale) / 2 + pad;
    if (Math.abs(lx) <= hl && Math.abs(ly) <= ht) return true;
    // 発射口(原点)付近を掴みやすくする
    return Math.hypot(dx, dy) <= (sample.thickness * sample.scale) * 0.9 + pad;
  }

  function handlePos(bone, sample) {
    const hl = (sample.length * sample.scale) / 2 + 24 / tr.scale;
    const rad = sample.rot * Math.PI / 180;
    return { x: sample.x + Math.cos(rad) * hl, y: sample.y + Math.sin(rad) * hl };
  }

  function safeSetPointerCapture(el, pointerId) {
    try { el.setPointerCapture(pointerId); } catch (e) { /* 実ポインタでない等は無視 */ }
  }

  function bindCanvasEvents() {
    canvas.addEventListener('pointerdown', (e) => {
      if (!pattern.bones.length) return;
      const [bx, by] = boxPosFromEvent(e);
      const selBone = findBone(selectedBoneId);
      if (selBone) {
        const s = Render.sampleBone(selBone, scrubTime);
        if (s.visible !== false) {
          const hp = handlePos(selBone, s);
          const dist = Math.hypot(bx - hp.x, by - hp.y);
          if (dist < screenPxToBox(22)) {
            drag = { mode: 'rotate', boneId: selBone.id };
            safeSetPointerCapture(canvas, e.pointerId);
            return;
          }
        }
      }
      for (let i = pattern.bones.length - 1; i >= 0; i--) {
        const b = pattern.bones[i];
        const s = Render.sampleBone(b, scrubTime);
        if (hitTestBone(bx, by, b, s)) {
          selectedBoneId = b.id;
          selectedKf = b.keyframes.find(k => Math.abs(k.t - scrubTime) <= KF_EPS) || null;
          drag = { mode: 'move', boneId: b.id, offX: bx - s.x, offY: by - s.y };
          safeSetPointerCapture(canvas, e.pointerId);
          renderBoneList(); renderKfList(); renderTimeline(); renderStage();
          return;
        }
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const b = findBone(drag.boneId);
      if (!b) return;
      const [bx, by] = boxPosFromEvent(e);
      if (drag.mode === 'move') {
        upsertKfAtScrub(b, { x: Math.round(bx - drag.offX), y: Math.round(by - drag.offY) });
      } else if (drag.mode === 'rotate') {
        const s = Render.sampleBone(b, scrubTime);
        const angle = Math.atan2(by - s.y, bx - s.x) * 180 / Math.PI;
        upsertKfAtScrub(b, { rot: Math.round(angle) });
      }
      renderStage(); renderKfList(); renderTimeline();
    });

    const endDrag = () => {
      if (!drag) return;
      drag = null;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  // ---------- キーボードショートカット ----------
  function bindKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (!document.getElementById('editorView').classList.contains('active')) return;
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedKf) {
        e.preventDefault();
        const b = findBone(selectedBoneId);
        if (!b) return;
        b.keyframes = b.keyframes.filter(k => k !== selectedKf);
        selectedKf = null;
        renderKfList(); renderTimeline(); renderStage();
      } else if (e.key === 'Escape' && selectedKf) {
        selectedKf = null;
        renderKfList(); renderTimeline(); renderStage();
      }
    });
  }

  // ---------- プレビュー再生 ----------
  function stopPreview() {
    previewPlaying = false;
    if (previewRAF) cancelAnimationFrame(previewRAF);
    previewRAF = null;
    el.btnPreviewPlay.disabled = false;
    el.btnPreviewStop.disabled = true;
  }

  function startPreview() {
    if (scrubTime >= pattern.settings.duration) scrubTime = 0;
    previewPlaying = true;
    previewStartPerf = performance.now();
    previewStartScrub = scrubTime;
    el.btnPreviewPlay.disabled = true;
    el.btnPreviewStop.disabled = false;
    const loop = () => {
      if (!previewPlaying) return;
      const elapsed = performance.now() - previewStartPerf;
      scrubTime = previewStartScrub + elapsed;
      if (scrubTime >= pattern.settings.duration) {
        scrubTime = pattern.settings.duration;
        renderStage();
        el.playhead.style.left = ((scrubTime / 1000) * PX_PER_SEC) + 'px';
        stopPreview();
        return;
      }
      renderStage();
      el.playhead.style.left = ((scrubTime / 1000) * PX_PER_SEC) + 'px';
      previewRAF = requestAnimationFrame(loop);
    };
    previewRAF = requestAnimationFrame(loop);
  }

  // ---------- イベント ----------
  function bindEvents() {
    bindCanvasEvents();
    bindKeyboardShortcuts();

    el.patternName.addEventListener('input', () => { pattern.name = el.patternName.value || '無題の攻撃'; });

    el.btnAddBone.addEventListener('click', () => {
      const kind = el.newBoneKind.value || 'normal';
      const b = Data.newBone({
        name: Data.KIND_DEFAULTS[kind].label.replace(/\(.*\)/, '') + (pattern.bones.length + 1),
        kind,
        color: Data.KIND_DEFAULTS[kind].color,
      });
      pattern.bones.push(b);
      selectedBoneId = b.id; selectedKf = b.keyframes[0];
      renderAll();
    });

    el.setDuration.addEventListener('change', () => {
      const v = Math.max(1, Number(el.setDuration.value) || 8) * 1000;
      pattern.settings.duration = v;
      if (scrubTime > v) scrubTime = v;
      el.durReadout.textContent = (v / 1000).toFixed(2);
      renderAll();
    });
    el.setHp.addEventListener('change', () => { pattern.settings.hp = Math.max(1, Number(el.setHp.value) || 92); });
    el.setSoulSpeed.addEventListener('change', () => { pattern.settings.soulSpeed = Math.max(10, Number(el.setSoulSpeed.value) || 180); });
    el.setDamage.addEventListener('change', () => { pattern.settings.damage = Math.max(1, Number(el.setDamage.value) || 8); });
    el.setBoxW.addEventListener('change', () => { pattern.settings.boxW = Math.max(80, Number(el.setBoxW.value) || 320); renderStage(); });
    el.setBoxH.addEventListener('change', () => { pattern.settings.boxH = Math.max(60, Number(el.setBoxH.value) || 220); renderStage(); });
    el.setGravityDir.addEventListener('change', () => { pattern.settings.gravityDir = el.setGravityDir.value; renderStage(); });
    el.setGravityStrength.addEventListener('change', () => { pattern.settings.gravityStrength = Math.max(0, Number(el.setGravityStrength.value) || 0); });
    el.setBgm.addEventListener('change', () => {
      pattern.settings.bgm = el.setBgm.value;
      if (el.btnBgmPreview.textContent.includes('停止')) {
        Bgm.play(pattern.settings.bgm);
      }
    });
    el.btnBgmPreview.addEventListener('click', () => {
      if (el.btnBgmPreview.textContent.includes('試聴')) {
        Bgm.play(el.setBgm.value);
        el.btnBgmPreview.textContent = '■ 停止';
      } else {
        Bgm.stop();
        el.btnBgmPreview.textContent = '▶ 試聴';
      }
    });

    el.btnPreviewPlay.addEventListener('click', startPreview);
    el.btnPreviewStop.addEventListener('click', stopPreview);

    el.btnZoomIn.addEventListener('click', () => setZoom(PX_PER_SEC * 1.3));
    el.btnZoomOut.addEventListener('click', () => setZoom(PX_PER_SEC / 1.3));

    el.btnAddKfNow.addEventListener('click', () => {
      const b = findBone(selectedBoneId);
      if (!b) return;
      upsertKfAtScrub(b, {});
      renderKfList(); renderTimeline(); renderStage();
    });

    el.btnShowNow.addEventListener('click', () => {
      const b = findBone(selectedBoneId);
      if (!b) return;
      snapOpacity(b, 1);
      renderKfList(); renderTimeline(); renderStage();
    });

    el.btnHideNow.addEventListener('click', () => {
      const b = findBone(selectedBoneId);
      if (!b) return;
      snapOpacity(b, 0);
      renderKfList(); renderTimeline(); renderStage();
    });

    ['kfTime', 'kfX', 'kfY', 'kfRot', 'kfScale', 'kfOpacity', 'kfLength', 'kfThick'].forEach(id => {
      el[id].addEventListener('change', () => {
        if (!selectedKf) return;
        const b = findBone(selectedBoneId);
        selectedKf.t = clamp(Math.round(Number(el.kfTime.value) * 1000), 0, pattern.settings.duration);
        selectedKf.x = Number(el.kfX.value) || 0;
        selectedKf.y = Number(el.kfY.value) || 0;
        selectedKf.rot = Number(el.kfRot.value) || 0;
        selectedKf.scale = Math.max(0.05, Number(el.kfScale.value) || 1);
        selectedKf.opacity = clamp(Number(el.kfOpacity.value), 0, 1);
        selectedKf.length = Math.max(1, Number(el.kfLength.value) || b.length);
        selectedKf.thickness = Math.max(1, Number(el.kfThick.value) || b.thickness);
        Data.sortKf(b);
        scrubTime = selectedKf.t;
        renderKfList(); renderTimeline(); renderStage();
      });
    });

    el.btnDupKf.addEventListener('click', () => {
      const b = findBone(selectedBoneId);
      if (!b || !selectedKf) return;
      const copy = Object.assign({}, selectedKf, { t: Math.min(pattern.settings.duration, selectedKf.t + 300) });
      b.keyframes.push(copy);
      Data.sortKf(b);
      selectedKf = copy;
      renderKfList(); renderTimeline(); renderStage();
    });

    el.btnDelKf.addEventListener('click', () => {
      const b = findBone(selectedBoneId);
      if (!b || !selectedKf) return;
      b.keyframes = b.keyframes.filter(k => k !== selectedKf);
      selectedKf = null;
      renderKfList(); renderTimeline(); renderStage();
    });
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(s) { return escapeHtml(s); }

  function stopBgmPreview() {
    Bgm.stop();
    if (el.btnBgmPreview) el.btnBgmPreview.textContent = '▶ 試聴';
  }

  return { init, setPattern, getPattern, renderAll, stopPreview, fitStageCanvas, stopBgmPreview };
})();
