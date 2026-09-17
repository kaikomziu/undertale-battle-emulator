// ===== エディタ画面のロジック =====
const Editor = (() => {
  const PX_PER_SEC = 90;
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
     'btnPreviewPlay', 'btnPreviewStop', 'scrubReadout', 'durReadout',
     'boneProps', 'kfList', 'kfEditor', 'kfTime', 'kfX', 'kfY', 'kfRot', 'kfScale', 'kfOpacity', 'kfLength', 'kfThick',
     'btnDupKf', 'btnDelKf', 'btnAddKfNow', 'btnShowNow', 'btnHideNow',
     'timelineScroll', 'timelineRuler', 'timelineTracks', 'playhead'].forEach(id => el[id] = qs(id));

    el.newBoneKind.innerHTML = Object.keys(Data.KIND_DEFAULTS).map(k =>
      `<option value="${k}">${Data.KIND_DEFAULTS[k].label}</option>`).join('');

    setPattern(initialPattern);
    bindEvents();
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
    el.durReadout.textContent = (s.duration / 1000).toFixed(2);
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

  // ---------- 描画 ----------
  function renderStage() {
    const s = pattern.settings;
    tr = Render.makeTransform(canvas, s.boxW, s.boxH);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Render.drawBox(ctx, tr, s.boxW, s.boxH);
    pattern.bones.forEach(b => {
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

  function renderTimeline() {
    const dur = pattern.settings.duration;
    const width = Math.max(300, (dur / 1000) * PX_PER_SEC + 40);
    el.timelineRuler.style.width = width + 'px';
    el.timelineTracks.style.width = width + 'px';

    el.timelineRuler.innerHTML = '';
    const step = dur > 20000 ? 2 : 1;
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
      });
      el.timelineTracks.appendChild(track);
    });

    el.playhead.style.left = ((scrubTime / 1000) * PX_PER_SEC) + 'px';
    el.playhead.style.height = (32 + pattern.bones.length * 30) + 'px';
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

  function renderAll() {
    renderStage();
    renderBoneList();
    renderBoneProps();
    renderKfList();
    renderTimeline();
  }

  // ---------- キャンバス操作 ----------
  function hitTestBone(bx, by, bone, sample) {
    const rad = -sample.rot * Math.PI / 180;
    const dx = bx - sample.x, dy = by - sample.y;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    const hl = (sample.length * sample.scale) / 2 + 6;
    const ht = (sample.thickness * sample.scale) / 2 + 6;
    if (Math.abs(lx) <= hl && Math.abs(ly) <= ht) return true;
    // 発射口(原点)付近を掴みやすくする
    return Math.hypot(dx, dy) <= (sample.thickness * sample.scale) * 0.9 + 6;
  }

  function handlePos(bone, sample) {
    const hl = (sample.length * sample.scale) / 2 + 24 / tr.scale;
    const rad = sample.rot * Math.PI / 180;
    return { x: sample.x + Math.cos(rad) * hl, y: sample.y + Math.sin(rad) * hl };
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
          if (dist < 14 / tr.scale) {
            drag = { mode: 'rotate', boneId: selBone.id };
            canvas.setPointerCapture(e.pointerId);
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
          canvas.setPointerCapture(e.pointerId);
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

    el.btnPreviewPlay.addEventListener('click', startPreview);
    el.btnPreviewStop.addEventListener('click', stopPreview);

    el.btnAddKfNow.addEventListener('click', () => {
      const b = findBone(selectedBoneId);
      if (!b) return;
      upsertKfAtScrub(b, {});
      renderKfList(); renderTimeline(); renderStage();
    });

    el.btnShowNow.addEventListener('click', () => {
      const b = findBone(selectedBoneId);
      if (!b) return;
      upsertKfAtScrub(b, { opacity: 1 });
      renderKfList(); renderTimeline(); renderStage();
    });

    el.btnHideNow.addEventListener('click', () => {
      const b = findBone(selectedBoneId);
      if (!b) return;
      upsertKfAtScrub(b, { opacity: 0 });
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

  return { init, setPattern, getPattern, renderAll, stopPreview };
})();
