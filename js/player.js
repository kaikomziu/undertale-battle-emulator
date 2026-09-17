// ===== プレイ画面のロジック(実際に戦う) =====
const Player = (() => {
  const INVINCIBLE_MS = 900;
  const SOUL_RADIUS = 7;

  let pattern = null;
  let canvas, ctx, tr;
  let status = 'ready'; // ready | playing | win | lose
  let hp = 0, maxHp = 0;
  let soulX = 0, soulY = 0;
  let elapsed = 0;
  let invincibleUntil = 0;
  let lastTs = 0;
  let rafId = null;
  let hitCount = 0;
  let shakeUntil = 0;
  let flashUntil = 0;
  let soulMoving = false;
  let boneOffsets = {};

  const keys = { up: false, down: false, left: false, right: false };
  const el = {};

  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
  };

  function qs(id) { return document.getElementById(id); }

  function init() {
    canvas = qs('playCanvas');
    ctx = canvas.getContext('2d');
    ['hpBarInner', 'hpText', 'playTimer', 'btnPlayStart', 'btnPlayRetry', 'btnPlayBackEdit',
     'playOverlay', 'playResultTitle', 'playResultDesc', 'btnOverlayRetry', 'btnOverlayEdit',
     'tpUp', 'tpDown', 'tpLeft', 'tpRight'].forEach(id => el[id] = qs(id));

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    bindTouchPad();

    el.btnPlayStart.addEventListener('click', () => start());
    el.btnPlayRetry.addEventListener('click', () => start());
    el.btnOverlayRetry.addEventListener('click', () => start());
    el.btnPlayBackEdit.addEventListener('click', () => Main.goToEditor());
    el.btnOverlayEdit.addEventListener('click', () => Main.goToEditor());

    drawIdle();
  }

  function bindTouchPad() {
    const bind = (btn, dir) => {
      const down = (e) => { e.preventDefault(); keys[dir] = true; };
      const up = (e) => { e.preventDefault(); keys[dir] = false; };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    };
    bind(el.tpUp, 'up'); bind(el.tpDown, 'down'); bind(el.tpLeft, 'left'); bind(el.tpRight, 'right');
  }

  function onKeyDown(e) {
    const dir = KEYMAP[e.key];
    if (!dir) return;
    if (status === 'playing') e.preventDefault();
    keys[dir] = true;
  }
  function onKeyUp(e) {
    const dir = KEYMAP[e.key];
    if (!dir) return;
    keys[dir] = false;
  }

  function setPattern(p) {
    pattern = p;
    status = 'ready';
    maxHp = p.settings.hp;
    hp = p.settings.hp;
    el.btnPlayStart.classList.remove('hidden');
    el.btnPlayRetry.classList.add('hidden');
    el.playOverlay.classList.add('hidden');
    el.playTimer.textContent = '0.0s';
    drawIdle();
    updateHud();
  }

  function drawIdle() {
    if (!pattern) return;
    const s = pattern.settings;
    tr = Render.makeTransform(canvas, s.boxW, s.boxH);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Render.drawBox(ctx, tr, s.boxW, s.boxH);
    const sx = 0, sy = s.boxH / 2 - 24;
    Render.drawSoul(ctx, tr, sx, sy, {});
  }

  function start() {
    const s = pattern.settings;
    status = 'playing';
    maxHp = s.hp; hp = s.hp;
    soulX = 0; soulY = s.boxH / 2 - 24;
    elapsed = 0;
    invincibleUntil = 0;
    hitCount = 0;
    shakeUntil = 0;
    flashUntil = 0;
    soulMoving = false;
    boneOffsets = rollBoneOffsets(pattern.bones);
    Object.keys(keys).forEach(k => keys[k] = false);
    el.btnPlayStart.classList.add('hidden');
    el.btnPlayRetry.classList.remove('hidden');
    el.playOverlay.classList.add('hidden');
    updateHud();
    Sfx.blip();
    lastTs = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // 骨ごとの時間ズレをプレイ開始時に一度だけ抽選する。
  // 同じ jitterGroup を持つ骨は同じズレを共有する(壁の隙間など連動が必要な骨をまとめて揺らせる)。
  function rollBoneOffsets(bones) {
    const groupRolls = {};
    const offsets = {};
    bones.forEach(b => {
      if (!b.jitter) { offsets[b.id] = 0; return; }
      const key = b.jitterGroup || b.id;
      if (!(key in groupRolls)) groupRolls[key] = (Math.random() * 2 - 1) * b.jitter;
      offsets[b.id] = groupRolls[key];
    });
    return offsets;
  }

  function boneTime(b) {
    return elapsed - (boneOffsets[b.id] || 0);
  }

  function loop(ts) {
    if (status !== 'playing') return;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    elapsed += dt * 1000;

    const s = pattern.settings;
    const speed = s.soulSpeed;
    let dx = 0, dy = 0;
    if (keys.up) dy -= 1;
    if (keys.down) dy += 1;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    soulMoving = !!(dx || dy);
    if (soulMoving) {
      const len = Math.hypot(dx, dy);
      soulX += (dx / len) * speed * dt;
      soulY += (dy / len) * speed * dt;
    }
    const hw = s.boxW / 2 - SOUL_RADIUS, hh = s.boxH / 2 - SOUL_RADIUS;
    soulX = Math.max(-hw, Math.min(hw, soulX));
    soulY = Math.max(-hh, Math.min(hh, soulY));

    const now = performance.now();
    if (now >= invincibleUntil) {
      for (const b of pattern.bones) {
        const sample = Render.sampleBone(b, boneTime(b));
        if (Render.hitTest(soulX, soulY, SOUL_RADIUS, b, sample, soulMoving)) {
          hp = Math.max(0, hp - s.damage);
          invincibleUntil = now + INVINCIBLE_MS;
          hitCount++;
          shakeUntil = now + 220;
          flashUntil = now + 260;
          Sfx.hit();
          updateHud();
          if (hp <= 0) { finish('lose'); return; }
          break;
        }
      }
    }

    if (elapsed >= s.duration) { finish('win'); return; }

    draw(now);
    el.playTimer.textContent = (elapsed / 1000).toFixed(1) + 's / ' + (s.duration / 1000).toFixed(1) + 's';
    rafId = requestAnimationFrame(loop);
  }

  function draw(now) {
    const s = pattern.settings;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (now < shakeUntil) {
      const remain = (shakeUntil - now) / 220;
      ctx.translate((Math.random() - 0.5) * 10 * remain, (Math.random() - 0.5) * 10 * remain);
    }
    Render.drawBox(ctx, tr, s.boxW, s.boxH);
    pattern.bones.forEach(b => {
      const sample = Render.sampleBone(b, boneTime(b));
      Render.drawBone(ctx, tr, b, sample, {});
    });
    const blink = now < invincibleUntil && Math.floor(now / 90) % 2 === 0;
    Render.drawSoul(ctx, tr, soulX, soulY, { blink });
    ctx.restore();
    if (now < flashUntil) {
      const alpha = (flashUntil - now) / 260 * 0.35;
      ctx.fillStyle = `rgba(255,0,40,${alpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function finish(result) {
    status = result;
    stop();
    updateHud();
    el.playOverlay.classList.remove('hidden');
    if (result === 'win') {
      el.playResultTitle.textContent = 'YOU WON';
      el.playResultTitle.className = 'win';
      el.playResultDesc.textContent = hitCount === 0
        ? '攻撃を耐えきった。ノーダメージクリア！'
        : `攻撃を耐えきった。(被弾 ${hitCount}回)`;
      Sfx.win();
    } else {
      el.playResultTitle.textContent = 'GAME OVER';
      el.playResultTitle.className = 'lose';
      el.playResultDesc.textContent = 'ぼうしがちった…もう一度ちょうせんしよう。';
      Sfx.lose();
    }
  }

  function updateHud() {
    const pct = maxHp > 0 ? Math.max(0, hp) / maxHp * 100 : 100;
    el.hpBarInner.style.width = pct + '%';
    el.hpText.textContent = `${Math.max(0, hp)} / ${maxHp || pattern.settings.hp}`;
  }

  function onLeave() {
    stop();
    status = 'ready';
  }

  return { init, setPattern, onLeave };
})();
