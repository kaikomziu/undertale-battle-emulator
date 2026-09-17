// ===== 共通レンダリング / 補間 / 当たり判定 =====
const Render = (() => {

  // 骨オブジェクトの時刻tにおける変換値をサンプリング(線形補間)
  function sampleBone(bone, t) {
    const kfs = bone.keyframes;
    if (!kfs || kfs.length === 0) return { x: 0, y: 0, rot: 0, scale: 1, opacity: 0, visible: false };
    if (kfs.length === 1) {
      const k = kfs[0];
      return { x: k.x, y: k.y, rot: k.rot, scale: k.scale, opacity: k.opacity, visible: t >= k.t };
    }
    if (t <= kfs[0].t) {
      const k = kfs[0];
      return { x: k.x, y: k.y, rot: k.rot, scale: k.scale, opacity: k.opacity, visible: t >= k.t };
    }
    const last = kfs[kfs.length - 1];
    if (t >= last.t) {
      return { x: last.x, y: last.y, rot: last.rot, scale: last.scale, opacity: last.opacity, visible: true };
    }
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i], b = kfs[i + 1];
      if (t >= a.t && t <= b.t) {
        const span = (b.t - a.t) || 1;
        const p = (t - a.t) / span;
        return {
          x: a.x + (b.x - a.x) * p,
          y: a.y + (b.y - a.y) * p,
          rot: a.rot + (b.rot - a.rot) * p,
          scale: a.scale + (b.scale - a.scale) * p,
          opacity: a.opacity + (b.opacity - a.opacity) * p,
          visible: true,
        };
      }
    }
    return { x: 0, y: 0, rot: 0, scale: 1, opacity: 0, visible: false };
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

  function drawBone(ctx, tr, bone, sample, opts) {
    if (!sample.visible || sample.opacity <= 0.01) return;
    opts = opts || {};
    const [cx, cy] = tr.toCanvas(sample.x, sample.y);
    const len = bone.length * sample.scale * tr.scale;
    const thick = bone.thickness * sample.scale * tr.scale;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sample.rot * Math.PI / 180);
    ctx.globalAlpha = Math.max(0, Math.min(1, sample.opacity));
    const hl = len / 2, ht = thick / 2;
    ctx.fillStyle = bone.color || '#f5f5f5';
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = Math.max(1, thick * 0.06);
    roundRectPath(ctx, -hl, -ht, len, thick, ht);
    ctx.fill(); ctx.stroke();
    const knobRy = ht * 1.4, knobRx = ht * 0.75;
    ctx.beginPath(); ctx.ellipse(-hl, 0, knobRx, knobRy, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(hl, 0, knobRx, knobRy, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
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

  // 円(魂)と回転矩形(骨)の当たり判定
  function circleVsBone(soulX, soulY, radius, bone, sample) {
    if (!sample.visible || sample.opacity <= 0.08) return false;
    const rad = -sample.rot * Math.PI / 180;
    const dx = soulX - sample.x, dy = soulY - sample.y;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    const hl = (bone.length * sample.scale) / 2;
    const ht = (bone.thickness * sample.scale) / 2;
    const cxl = Math.max(-hl, Math.min(hl, lx));
    const cyl = Math.max(-ht, Math.min(ht, ly));
    const ddx = lx - cxl, ddy = ly - cyl;
    return (ddx * ddx + ddy * ddy) < radius * radius;
  }

  return { sampleBone, makeTransform, drawBox, drawBone, drawSoul, circleVsBone, roundRectPath };
})();
