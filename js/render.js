// ===== 共通レンダリング / 補間 / 当たり判定 =====
const Render = (() => {

  function smoothstep(p) { return p * p * (3 - 2 * p); }

  // キーフレームの長さ/太さ: 未指定なら骨のデフォルト値にフォールバック
  function resolveLen(bone, k) { return (typeof k.length === 'number') ? k.length : bone.length; }
  function resolveThick(bone, k) { return (typeof k.thickness === 'number') ? k.thickness : bone.thickness; }

  // 骨オブジェクトの時刻tにおける変換値をサンプリング(線形補間 / イーズ補間)
  function sampleBone(bone, t) {
    const kfs = bone.keyframes;
    if (!kfs || kfs.length === 0) return { x: 0, y: 0, rot: 0, scale: 1, opacity: 0, length: bone.length, thickness: bone.thickness, visible: false };
    if (kfs.length === 1) {
      const k = kfs[0];
      return { x: k.x, y: k.y, rot: k.rot, scale: k.scale, opacity: k.opacity, length: resolveLen(bone, k), thickness: resolveThick(bone, k), visible: t >= k.t };
    }
    if (t <= kfs[0].t) {
      const k = kfs[0];
      return { x: k.x, y: k.y, rot: k.rot, scale: k.scale, opacity: k.opacity, length: resolveLen(bone, k), thickness: resolveThick(bone, k), visible: t >= k.t };
    }
    const last = kfs[kfs.length - 1];
    if (t >= last.t) {
      return { x: last.x, y: last.y, rot: last.rot, scale: last.scale, opacity: last.opacity, length: resolveLen(bone, last), thickness: resolveThick(bone, last), visible: true };
    }
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i], b = kfs[i + 1];
      if (t >= a.t && t <= b.t) {
        const span = (b.t - a.t) || 1;
        let p = (t - a.t) / span;
        if (bone.ease === 'easeInOut') p = smoothstep(p);
        const aLen = resolveLen(bone, a), bLen = resolveLen(bone, b);
        const aThick = resolveThick(bone, a), bThick = resolveThick(bone, b);
        return {
          x: a.x + (b.x - a.x) * p,
          y: a.y + (b.y - a.y) * p,
          rot: a.rot + (b.rot - a.rot) * p,
          scale: a.scale + (b.scale - a.scale) * p,
          opacity: a.opacity + (b.opacity - a.opacity) * p,
          length: aLen + (bLen - aLen) * p,
          thickness: aThick + (bThick - aThick) * p,
          visible: true,
        };
      }
    }
    return { x: 0, y: 0, rot: 0, scale: 1, opacity: 0, length: bone.length, thickness: bone.thickness, visible: false };
  }

  // 骨がこれから出現する(有効になる)場合、その未来の見た目を予告線として返す。
  // すでに出現済み、またはtelegraph時間内に出現しないならnull。
  function sampleTelegraph(bone, t) {
    const tel = bone.telegraph || 0;
    if (!tel) return null;
    const now = sampleBone(bone, t);
    if (now.visible && now.opacity >= 0.5) return null;
    const future = sampleBone(bone, t + tel);
    if (!(future.visible && future.opacity >= 0.5)) return null;
    return future;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 箱スペース座標 <-> キャンバス座標
  function makeTransform(canvas, boxW, boxH) {
    const pad = 36;
    const scale = Math.min((canvas.width - pad * 2) / boxW, (canvas.height - pad * 2) / boxH);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    return {
      scale,
      toCanvas: (bx, by) => [cx + bx * scale, cy + by * scale],
      toBox: (px, py) => [(px - cx) / scale, (py - cy) / scale],
      cx, cy,
    };
  }

  function drawBox(ctx, tr, boxW, boxH) {
    const [x0, y0] = tr.toCanvas(-boxW / 2, -boxH / 2);
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(x0, y0, boxW * tr.scale, boxH * tr.scale);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(x0, y0, boxW * tr.scale, boxH * tr.scale);
    ctx.restore();
  }

  const GRAVITY_VECTORS = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

  // ボックス内に重力の向きを示す矢印を薄く表示する
  function drawGravityHint(ctx, tr, boxW, boxH, dir) {
    const vec = GRAVITY_VECTORS[dir];
    if (!vec) return;
    const [vx, vy] = vec;
    const perpX = -vy, perpY = vx;
    const lanes = [-0.28, 0, 0.28];
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 2;
    lanes.forEach(l => {
      const baseX = perpX * l * boxW, baseY = perpY * l * boxH;
      const len = Math.min(boxW, boxH) * 0.3;
      const [x0, y0] = tr.toCanvas(baseX - vx * len / 2, baseY - vy * len / 2);
      const [x1, y1] = tr.toCanvas(baseX + vx * len / 2, baseY + vy * len / 2);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      const ah = 7;
      const angle = Math.atan2(y1 - y0, x1 - x0);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - ah * Math.cos(angle - 0.5), y1 - ah * Math.sin(angle - 0.5));
      ctx.lineTo(x1 - ah * Math.cos(angle + 0.5), y1 - ah * Math.sin(angle + 0.5));
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  }

  function drawBonePill(ctx, bone, hl, ht) {
    ctx.fillStyle = bone.color || '#f5f5f5';
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = Math.max(1, ht * 0.12);
    roundRectPath(ctx, -hl, -ht, hl * 2, ht * 2, ht);
    ctx.fill(); ctx.stroke();
    const knobRy = ht * 1.4, knobRx = ht * 0.75;
    ctx.beginPath(); ctx.ellipse(-hl, 0, knobRx, knobRy, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(hl, 0, knobRx, knobRy, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (bone.kind === 'blue') {
      // 「動くと危険」を示す進行方向シェブロン
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(1.5, ht * 0.16);
      ctx.lineCap = 'round';
      const n = Math.max(1, Math.floor((hl * 2) / (ht * 3)));
      for (let i = 0; i < n; i++) {
        const cxp = -hl + (i + 0.5) * (hl * 2 / n);
        ctx.beginPath();
        ctx.moveTo(cxp - ht * 0.35, -ht * 0.4);
        ctx.lineTo(cxp + ht * 0.35, 0);
        ctx.lineTo(cxp - ht * 0.35, ht * 0.4);
        ctx.stroke();
      }
    } else if (bone.kind === 'orange') {
      // 「止まると危険」を示す停止マーク
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const r = ht * 0.32;
      const n = Math.max(1, Math.floor((hl * 2) / (ht * 3)));
      for (let i = 0; i < n; i++) {
        const cxp = -hl + (i + 0.5) * (hl * 2 / n);
        ctx.beginPath();
        ctx.arc(cxp, 0, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawBlaster(ctx, bone, sample, hl, ht) {
    const firing = sample.opacity >= 0.6;
    const muzzleR = ht;
    // 溜め中のグロー
    if (!firing) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, sample.opacity)) * 0.9;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, muzzleR * 1.8);
      g.addColorStop(0, bone.color || '#eaf6ff');
      g.addColorStop(1, 'rgba(234,246,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, muzzleR * 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // 発射ビーム
    if (firing) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, sample.opacity));
      const beamLen = hl * 2 - muzzleR * 0.6;
      const g = ctx.createLinearGradient(muzzleR * 0.4, 0, muzzleR * 0.4 + beamLen, 0);
      g.addColorStop(0, bone.color || '#eaf6ff');
      g.addColorStop(1, 'rgba(234,246,255,0.55)');
      ctx.fillStyle = g;
      roundRectPath(ctx, muzzleR * 0.4, -ht, beamLen, ht * 2, ht * 0.3);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      roundRectPath(ctx, muzzleR * 0.4, -ht * 0.35, beamLen, ht * 0.7, ht * 0.2);
      ctx.fill();
      ctx.restore();
    }
    // 発射口(キャノン)
    ctx.save();
    ctx.globalAlpha = Math.max(0.35, Math.min(1, sample.opacity));
    ctx.fillStyle = '#2a2a33';
    ctx.strokeStyle = firing ? '#eaf6ff' : 'rgba(234,246,255,0.6)';
    ctx.lineWidth = Math.max(2, ht * 0.12);
    roundRectPath(ctx, -muzzleR * 1.1, -ht, muzzleR * 1.5, ht * 2, ht * 0.4);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.arc(-muzzleR * 0.3, -ht * 0.4, ht * 0.18, 0, Math.PI * 2);
    ctx.arc(-muzzleR * 0.3, ht * 0.4, ht * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = firing ? '#ff5566' : '#5a5a66';
    ctx.fill();
    ctx.restore();
  }

  // 出現予告線: 点線の輪郭だけを薄く描画する(まだ無害、当たり判定は無い)
  function drawTelegraph(ctx, tr, bone, sample) {
    const [cx, cy] = tr.toCanvas(sample.x, sample.y);
    const len = sample.length * sample.scale * tr.scale;
    const thick = sample.thickness * sample.scale * tr.scale;
    const hl = len / 2, ht = thick / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sample.rot * Math.PI / 180);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = bone.color || '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    roundRectPath(ctx, -hl, -ht, len, thick, ht);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawBone(ctx, tr, bone, sample, opts) {
    if (!sample.visible || sample.opacity <= 0.01) return;
    opts = opts || {};
    const [cx, cy] = tr.toCanvas(sample.x, sample.y);
    const len = sample.length * sample.scale * tr.scale;
    const thick = sample.thickness * sample.scale * tr.scale;
    const hl = len / 2, ht = thick / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sample.rot * Math.PI / 180);
    if (bone.kind === 'blaster') {
      drawBlaster(ctx, bone, sample, hl, ht);
    } else {
      ctx.globalAlpha = Math.max(0, Math.min(1, sample.opacity));
      drawBonePill(ctx, bone, hl, ht);
    }
    ctx.restore();

    if (opts.selected) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(sample.rot * Math.PI / 180);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      roundRectPath(ctx, -hl - 5, -ht - 5, len + 10, thick + 10, ht + 5);
      ctx.stroke();
      ctx.setLineDash([]);
      // 回転ハンドル
      const handleDist = hl + 24;
      ctx.beginPath();
      ctx.moveTo(hl, 0);
      ctx.lineTo(handleDist, 0);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(handleDist, 0, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd23f';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  function heartPath(ctx, size) {
    const s = size;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.35);
    ctx.bezierCurveTo(0, s * 0.05, -s * 0.5, -s * 0.15, -s * 0.5, s * 0.15);
    ctx.bezierCurveTo(-s * 0.5, s * 0.45, -s * 0.15, s * 0.6, 0, s * 0.85);
    ctx.bezierCurveTo(s * 0.15, s * 0.6, s * 0.5, s * 0.45, s * 0.5, s * 0.15);
    ctx.bezierCurveTo(s * 0.5, -s * 0.15, 0, s * 0.05, 0, s * 0.35);
    ctx.closePath();
  }

  function drawSoul(ctx, tr, x, y, opts) {
    opts = opts || {};
    const [cx, cy] = tr.toCanvas(x, y);
    const size = 15 * tr.scale;
    ctx.save();
    ctx.translate(cx, cy - size * 0.4);
    if (opts.blink) ctx.globalAlpha = 0.35;
    ctx.fillStyle = opts.color || '#ff0033';
    heartPath(ctx, size);
    ctx.fill();
    ctx.restore();
  }

  // 円(魂)とローカル座標での矩形(x範囲[x0,x1], y範囲[-ht,ht])の当たり判定
  function circleVsLocalRect(lx, ly, radius, x0, x1, ht) {
    const cxl = Math.max(x0, Math.min(x1, lx));
    const cyl = Math.max(-ht, Math.min(ht, ly));
    const ddx = lx - cxl, ddy = ly - cyl;
    return (ddx * ddx + ddy * ddy) < radius * radius;
  }

  function toLocal(soulX, soulY, sample) {
    const rad = -sample.rot * Math.PI / 180;
    const dx = soulX - sample.x, dy = soulY - sample.y;
    return [dx * Math.cos(rad) - dy * Math.sin(rad), dx * Math.sin(rad) + dy * Math.cos(rad)];
  }

  // 円(魂)と中心配置の回転矩形(通常/青/オレンジ骨)の当たり判定
  function circleVsCenteredRect(soulX, soulY, radius, bone, sample) {
    const [lx, ly] = toLocal(soulX, soulY, sample);
    const hl = (sample.length * sample.scale) / 2;
    const ht = (sample.thickness * sample.scale) / 2;
    return circleVsLocalRect(lx, ly, radius, -hl, hl, ht);
  }

  // 円(魂)とブラスターのビーム(原点から前方に伸びる矩形)の当たり判定
  function circleVsBeam(soulX, soulY, radius, bone, sample) {
    const [lx, ly] = toLocal(soulX, soulY, sample);
    const len = sample.length * sample.scale;
    const ht = (sample.thickness * sample.scale) / 2;
    return circleVsLocalRect(lx, ly, radius, -len / 2 * 0.15, len, ht * 0.9);
  }

  // 骨の種類(通常/青/オレンジ/ブラスター)に応じた被弾判定
  // soulMoving: この瞬間に魂が移動入力をしているか(青/オレンジの判定に使用)
  function hitTest(soulX, soulY, radius, bone, sample, soulMoving) {
    if (!sample.visible || sample.opacity <= 0.08) return false;
    if (bone.kind === 'blaster') {
      if (sample.opacity < 0.6) return false; // 溜め中は無害
      return circleVsBeam(soulX, soulY, radius, bone, sample);
    }
    if (!circleVsCenteredRect(soulX, soulY, radius, bone, sample)) return false;
    if (bone.kind === 'blue') return !!soulMoving;   // 青: 動いていると被弾
    if (bone.kind === 'orange') return !soulMoving;  // オレンジ: 止まっていると被弾
    return true; // 通常: 触れたら常に被弾
  }

  return {
    sampleBone, sampleTelegraph, makeTransform, drawBox, drawGravityHint, drawBone, drawTelegraph, drawSoul,
    circleVsCenteredRect, circleVsBeam, hitTest, roundRectPath,
  };
})();
