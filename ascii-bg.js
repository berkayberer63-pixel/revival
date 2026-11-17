(() => {
  const canvas = document.getElementById("asciiBgCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  const STORAGE_KEY = "rvl_bg_theme";
  const VALID_THEMES = ["cloud-sea", "volcano-night", "lantern-lake", "aurora-fjord", "kyoto-dusk", "frog", "black-hole"];
  let activeTheme = "cloud-sea";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && VALID_THEMES.includes(saved)) activeTheme = saved;
  } catch (_) {}

  const themeSel = document.getElementById("bgThemeSelect");
  function setTheme(next) {
    if (!VALID_THEMES.includes(next)) return;
    activeTheme = next;
    try { localStorage.setItem(STORAGE_KEY, activeTheme); } catch (_) {}
    if (themeSel) themeSel.value = activeTheme;
    document.querySelectorAll("[data-bg-theme]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.bgTheme === activeTheme);
    });
    lastDraw = 0;
    resize();
  }

  if (themeSel) {
    themeSel.value = activeTheme;
    themeSel.addEventListener("change", () => setTheme(themeSel.value));
  }
  document.querySelectorAll("[data-bg-theme]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.bgTheme === activeTheme);
    btn.addEventListener("click", () => setTheme(btn.dataset.bgTheme));
  });

  let dpr = 1;
  let width = 0;
  let height = 0;
  let lastTime = performance.now();
  let lastDraw = 0;

  // =========================================================================
  // SHARED MATH & HALFTONE UTILITIES
  // =========================================================================
  const W = 200;
  const H = 100;
  const N = W * H;
  const COVER = [0, 0.3, 0.6, 1];
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.47);

  function hash(x, y) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function noise(x, y, period = 0) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    let x0 = xi, x1 = xi + 1;
    if (period) {
      x0 = ((xi % period) + period) % period;
      x1 = (x0 + 1) % period;
    }
    const a = hash(x0, yi), b = hash(x1, yi), c = hash(x0, yi + 1), d = hash(x1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  function fbm(x, y, octaves, period = 0) {
    let s = 0, n = 0, amp = 0.5, f = 1;
    for (let i = 0; i < octaves; i++) {
      s += amp * noise(x * f, y * f, period * f);
      n += amp;
      amp *= 0.5;
      f *= 2;
    }
    return s / n;
  }

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (a, b, v) => {
    const k = clamp01((v - a) / (b - a));
    return k * k * (3 - 2 * k);
  };
  const mix = (a, b, k) => a + (b - a) * k;
  const hexToRgb01 = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);

  function seg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const k = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
    const ex = ax + dx * k - px, ey = ay + dy * k - py;
    return [Math.sqrt(ex * ex + ey * ey), k];
  }

  function makePaletteMatcher(paletteHex, matchLimit = paletteHex.length) {
    const P = paletteHex.map(hexToRgb01);
    const lut = new Uint8Array(32768).fill(255);
    const nearest = (r, g, b) => {
      const k = (Math.min(31, (r * 31.99) | 0) << 10) | (Math.min(31, (g * 31.99) | 0) << 5) | Math.min(31, (b * 31.99) | 0);
      if (lut[k] !== 255) return lut[k];
      let best = 0, bd = 1e9;
      for (let i = 0; i < matchLimit; i++) {
        const dr = P[i][0] - r, dg = P[i][1] - g, db = P[i][2] - b;
        const d = 0.3 * dr * dr + 0.5 * dg * dg + 0.2 * db * db;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return (lut[k] = best);
    };
    return { P, nearest };
  }

  function buildSpritesForPalette(paletteHex, cellW) {
    const sprites = [];
    const sw = Math.max(4, Math.ceil(cellW));
    const radii = [0, Math.max(0.8, sw * 0.14), Math.max(1.5, sw * 0.27), Math.max(2.3, sw * 0.41)];
    for (let step = 0; step <= 3; step++) {
      const row = [];
      if (step > 0) {
        for (let pi = 0; pi < paletteHex.length; pi++) {
          const c = document.createElement("canvas");
          c.width = sw;
          c.height = sw;
          const sctx = c.getContext("2d");
          sctx.fillStyle = paletteHex[pi];
          sctx.beginPath();
          sctx.arc(sw * 0.5, sw * 0.5, radii[step], 0, Math.PI * 2);
          sctx.fill();
          row.push(c);
        }
      }
      sprites.push(row);
    }
    return sprites;
  }

  function renderHalftoneGrid(outStep, outColor, sprites, groundHex) {
    const cell = Math.max(width / W, height / H);
    const offsetX = (width - W * cell) * 0.5;
    const offsetY = (height - H * cell) * 0.5;

    ctx.globalAlpha = 1;
    ctx.fillStyle = groundHex;
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 0.64;
    for (let r = 0; r < H; r++) {
      const y = offsetY + r * cell;
      if (y + cell < 0 || y > height) continue;
      const rowOff = r * W;
      for (let x = 0; x < W; x++) {
        const k = rowOff + x;
        const step = outStep[k];
        if (!step) continue;
        const px = offsetX + x * cell;
        if (px + cell < 0 || px > width) continue;
        ctx.drawImage(sprites[step][outColor[k]], px, y, cell, cell);
      }
    }
    ctx.globalAlpha = 1;
  }

  // =========================================================================
  // 1. FROG SCENE (DEFAULT)
  // =========================================================================
  function createFrogScene() {
    const BG_HEX = "#090d16";
    const GRID_COLOR = "rgba(148, 163, 184, 0.055)";
    const DOT_COLOR = "rgba(148, 163, 184, 0.09)";

    // Frog palette (matching ASCII Animals frog)
    const C_BODY = [104, 184, 76];
    const C_LEG = [92, 164, 66];
    const C_SPOT = [30, 70, 30];
    const C_SPOT_RIM = [190, 222, 130];
    const C_RIDGE = [206, 226, 150];
    const C_BAND = [36, 80, 32];
    const C_TOE = [120, 190, 90];
    const C_EYE_WHITE = [240, 240, 228];
    const C_EYE_PUPIL = [16, 16, 12];
    const C_RIPPLE = [110, 200, 220];

    const GLYPH_RAMP = " .:-=+*#%@";
    const FROG_COUNT = 9;
    const STEP_DT = 1 / 60;

    let cellW = 14;
    let cellH = 14;
    let cols = 0;
    let rows = 0;
    let totalCells = 0;

    const bgCanvas = document.createElement("canvas");
    const bgCtx = bgCanvas.getContext("2d", { alpha: false });

    let cellFlag = new Uint8Array(0);
    let cellFillR = new Uint8Array(0);
    let cellFillG = new Uint8Array(0);
    let cellFillB = new Uint8Array(0);
    let cellFillA = new Float32Array(0);
    let cellTextR = new Uint8Array(0);
    let cellTextG = new Uint8Array(0);
    let cellTextB = new Uint8Array(0);
    let cellTextA = new Float32Array(0);
    let cellGlyph = new Uint16Array(0);
    let cellPriority = new Float32Array(0);

    let rippleField = new Float32Array(0);
    let rippleNext = new Float32Array(0);

    const frogs = [];
    let accumulator = 0;
    let elapsed = 0;

    function rand(min, max) {
      return min + Math.random() * (max - min);
    }

    function clamp(v, lo, hi) {
      return v < lo ? lo : v > hi ? hi : v;
    }

    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    function paintBackground() {
      bgCanvas.width = Math.max(1, Math.floor(width * dpr));
      bgCanvas.height = Math.max(1, Math.floor(height * dpr));
      bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

      bgCtx.fillStyle = BG_HEX;
      bgCtx.fillRect(0, 0, width, height);

      bgCtx.strokeStyle = GRID_COLOR;
      bgCtx.lineWidth = 1;
      bgCtx.beginPath();
      for (let c = 0; c <= cols; c++) {
        const x = Math.round(c * cellW) + 0.5;
        bgCtx.moveTo(x, 0);
        bgCtx.lineTo(x, height);
      }
      for (let r = 0; r <= rows; r++) {
        const y = Math.round(r * cellH) + 0.5;
        bgCtx.moveTo(0, y);
        bgCtx.lineTo(width, y);
      }
      bgCtx.stroke();

      bgCtx.fillStyle = DOT_COLOR;
      for (let r = 0; r < rows; r++) {
        const cy = r * cellH + cellH * 0.5;
        for (let c = 0; c < cols; c++) {
          const cx = c * cellW + cellW * 0.5;
          bgCtx.fillRect(cx - 0.5, cy - 0.5, 1, 1);
        }
      }
    }

    function createFrog(id, scatter) {
      const scaleTier = id % 3 === 0 ? rand(1.18, 1.52) : id % 3 === 1 ? rand(0.88, 1.15) : rand(0.68, 0.88);
      const baseSpan = 68 * scaleTier;
      const course = Math.atan2(-height || -900, width || 1440) + rand(-0.12, 0.12);

      let x, y;
      if (scatter) {
        x = rand(-baseSpan, width + baseSpan);
        y = rand(-baseSpan, height + baseSpan);
      } else {
        if (Math.random() < 0.55) {
          x = rand(-baseSpan * 1.5, width * 0.75);
          y = height + baseSpan * rand(1.2, 2.5);
        } else {
          x = -baseSpan * rand(1.2, 2.5);
          y = rand(height * 0.25, height + baseSpan * 1.5);
        }
      }

      return {
        id,
        x,
        y,
        baseSpan,
        span: baseSpan,
        course,
        heading: course,
        state: Math.random() < 0.5 ? "rest" : "leap",
        restTimer: rand(0.2, 1.4),
        restDur: rand(0.7, 1.9),
        leapT: Math.random(),
        leapDur: rand(0.56, 0.88),
        leapDist: rand(155, 255) * scaleTier,
        leapHeight: rand(0.65, 1.05),
        startX: x,
        startY: y,
        targetX: x + Math.cos(course) * 140 * scaleTier,
        targetY: y + Math.sin(course) * 140 * scaleTier,
        blinkTimer: rand(1.5, 5.5),
        blinkProgress: 0,
        arc: 0,
        ext: 0,
        armPhase: 0,
        landedRipple: false
      };
    }

    function initFrogs() {
      frogs.length = 0;
      for (let i = 0; i < FROG_COUNT; i++) {
        frogs.push(createFrog(i, true));
      }
    }

    function onResize() {
      cellW = width < 768 ? 12 : 14;
      cellH = cellW;
      cols = Math.ceil(width / cellW) + 1;
      rows = Math.ceil(height / cellH) + 1;
      totalCells = cols * rows;

      cellFlag = new Uint8Array(totalCells);
      cellFillR = new Uint8Array(totalCells);
      cellFillG = new Uint8Array(totalCells);
      cellFillB = new Uint8Array(totalCells);
      cellFillA = new Float32Array(totalCells);
      cellTextR = new Uint8Array(totalCells);
      cellTextG = new Uint8Array(totalCells);
      cellTextB = new Uint8Array(totalCells);
      cellTextA = new Float32Array(totalCells);
      cellGlyph = new Uint16Array(totalCells);
      cellPriority = new Float32Array(totalCells);

      rippleField = new Float32Array(totalCells);
      rippleNext = new Float32Array(totalCells);

      paintBackground();

      if (frogs.length === 0) {
        initFrogs();
      }
    }

    function startLeap(f) {
      const baseCourse = Math.atan2(-height || -900, width || 1440);
      f.course = baseCourse + rand(-0.14, 0.14);
      f.heading = f.course;
      f.startX = f.x;
      f.startY = f.y;
      const dist = f.leapDist * rand(0.88, 1.15);
      f.targetX = f.x + Math.cos(f.course) * dist;
      f.targetY = f.y + Math.sin(f.course) * dist;
      f.leapT = 0;
      f.state = "leap";
      f.landedRipple = false;
    }

    function addRipple(wx, wy, strength, radius) {
      const c0 = Math.floor((wx - radius) / cellW);
      const c1 = Math.ceil((wx + radius) / cellW);
      const r0 = Math.floor((wy - radius) / cellH);
      const r1 = Math.ceil((wy + radius) / cellH);
      const r2 = radius * radius;

      for (let r = r0; r <= r1; r++) {
        if (r < 0 || r >= rows) continue;
        const cy = r * cellH + cellH * 0.5;
        const dy = cy - wy;
        for (let c = c0; c <= c1; c++) {
          if (c < 0 || c >= cols) continue;
          const cx = c * cellW + cellW * 0.5;
          const dx = cx - wx;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) {
            const dist = Math.sqrt(d2);
            const ring = Math.exp(-Math.pow((dist - radius * 0.55) / (radius * 0.28), 2));
            const idx = r * cols + c;
            rippleField[idx] = Math.min(1, rippleField[idx] + strength * ring);
          }
        }
      }
    }

    function updateFrogs(dt, timeSec) {
      for (let i = 0; i < frogs.length; i++) {
        const f = frogs[i];

        f.blinkTimer -= dt;
        if (f.blinkTimer <= 0) {
          f.blinkProgress += dt * 7.5;
          if (f.blinkProgress >= 1) {
            f.blinkProgress = 0;
            f.blinkTimer = rand(2.2, 6.2);
          }
        }

        if (f.state === "rest") {
          f.restTimer += dt;
          const breathe = 1 + 0.045 * Math.sin(timeSec * 5.2 + f.id * 1.7);
          f.span = f.baseSpan * breathe;
          f.arc = 0;
          f.ext = lerp(f.ext, 0, Math.min(1, dt * 14));
          f.armPhase = lerp(f.armPhase, 0, Math.min(1, dt * 12));

          if (f.restTimer >= f.restDur) {
            f.restTimer = 0;
            f.restDur = rand(0.45, 1.35);
            startLeap(f);
          }
        } else {
          f.leapT += dt / f.leapDur;
          if (f.leapT >= 1) {
            f.leapT = 1;
            f.x = f.targetX;
            f.y = f.targetY;
            f.arc = 0;
            f.ext = 0;
            f.armPhase = 0;
            f.span = f.baseSpan;
            f.state = "rest";
            f.restTimer = 0;
            addRipple(f.x, f.y, 0.55, f.baseSpan * 1.15);
          } else {
            const s = f.leapT;
            const ease = s < 0.5 ? 2 * s * s : 1 - Math.pow(-2 * s + 2, 2) / 2;
            f.x = lerp(f.startX, f.targetX, ease);
            f.y = lerp(f.startY, f.targetY, ease);
            f.arc = 4 * s * (1 - s) * f.leapHeight;
            f.span = f.baseSpan * (1 + 0.36 * f.arc);
            f.ext = s < 0.72 ? Math.sin((s / 0.72) * Math.PI) : 0;
            f.armPhase = Math.sin(s * Math.PI);
          }
        }

        const margin = f.baseSpan * 2.8;
        if (f.x > width + margin || f.y < -margin) {
          frogs[i] = createFrog(f.id, false);
        }
      }
    }

    function updateRipples(dt) {
      const decay = Math.exp(-dt * 2.6);
      for (let r = 0; r < rows; r++) {
        const rowOff = r * cols;
        for (let c = 0; c < cols; c++) {
          const idx = rowOff + c;
          let sum = rippleField[idx] * 0.6;
          let cnt = 0.6;
          if (c > 0) { sum += rippleField[idx - 1] * 0.1; cnt += 0.1; }
          if (c + 1 < cols) { sum += rippleField[idx + 1] * 0.1; cnt += 0.1; }
          if (r > 0) { sum += rippleField[idx - cols] * 0.1; cnt += 0.1; }
          if (r + 1 < rows) { sum += rippleField[idx + cols] * 0.1; cnt += 0.1; }
          const val = (sum / cnt) * decay;
          rippleNext[idx] = val < 0.015 ? 0 : val;
        }
      }
      const tmp = rippleField;
      rippleField = rippleNext;
      rippleNext = tmp;
    }

    function setCell(idx, priority, fr, fg, fb, fa, tr, tg, tb, ta, glyphCode) {
      if (priority < cellPriority[idx]) return;
      cellPriority[idx] = priority;
      cellFlag[idx] = 1;
      cellFillR[idx] = fr;
      cellFillG[idx] = fg;
      cellFillB[idx] = fb;
      cellFillA[idx] = fa;
      cellTextR[idx] = tr;
      cellTextG[idx] = tg;
      cellTextB[idx] = tb;
      cellTextA[idx] = ta;
      cellGlyph[idx] = glyphCode;
    }

    function distToSegment(px, py, ax, ay, bx, by) {
      const vx = bx - ax;
      const vy = by - ay;
      const wx = px - ax;
      const wy = py - ay;
      const len2 = vx * vx + vy * vy;
      const t = len2 > 1e-6 ? clamp((wx * vx + wy * vy) / len2, 0, 1) : 0;
      const dx = px - (ax + t * vx);
      const dy = py - (ay + t * vy);
      return Math.sqrt(dx * dx + dy * dy);
    }

    function rasterizeFrog(f) {
      const S = f.span;
      const cosH = Math.cos(f.heading);
      const sinH = Math.sin(f.heading);

      const reach = S * (1.25 + 1.05 * f.ext);
      const c0 = Math.max(0, Math.floor((f.x - reach) / cellW));
      const c1 = Math.min(cols - 1, Math.ceil((f.x + reach) / cellW));
      const r0 = Math.max(0, Math.floor((f.y - reach) / cellH));
      const r1 = Math.min(rows - 1, Math.ceil((f.y + reach) / cellH));

      const hipX = -0.34 * S;
      const hipY = 0.28 * S;
      const kneeX = lerp(-0.18, -0.82, f.ext) * S;
      const kneeY = lerp(0.56, 0.34, f.ext) * S;
      const ankleX = lerp(-0.56, -1.35, f.ext) * S;
      const ankleY = lerp(0.46, 0.22, f.ext) * S;
      const footX = lerp(-0.36, -1.62, f.ext) * S;
      const footY = lerp(0.62, 0.28, f.ext) * S;

      const shX = 0.26 * S;
      const shY = 0.30 * S;
      const elX = lerp(0.32, 0.56, f.armPhase) * S;
      const elY = lerp(0.52, 0.44, f.armPhase) * S;
      const handX = lerp(0.52, 0.72, f.armPhase) * S;
      const handY = lerp(0.44, 0.32, f.armPhase) * S;

      const legRad = 0.115 * S;
      const armRad = 0.085 * S;
      const eyeX = 0.44 * S;
      const eyeY = 0.24 * S;
      const eyeRad = 0.145 * S;
      const isBlinking = f.blinkTimer <= 0 && f.blinkProgress > 0.15 && f.blinkProgress < 0.85;

      const alphaBoost = 0.88 + 0.12 * f.arc;

      for (let r = r0; r <= r1; r++) {
        const cy = r * cellH + cellH * 0.5;
        const wy = cy - f.y;
        const rowOff = r * cols;

        for (let c = c0; c <= c1; c++) {
          const cx = c * cellW + cellW * 0.5;
          const wx = cx - f.x;

          const lx = wx * cosH + wy * sinH;
          const ly = -wx * sinH + wy * cosH;
          const aly = Math.abs(ly);

          const idx = rowOff + c;

          const dEye = Math.hypot(lx - eyeX, aly - eyeY);
          if (dEye < eyeRad) {
            if (isBlinking) {
              setCell(idx, 10, C_BODY[0], C_BODY[1], C_BODY[2], 0.92, C_BAND[0], C_BAND[1], C_BAND[2], 0.95, 45);
            } else if (dEye < eyeRad * 0.48) {
              setCell(idx, 11, C_EYE_PUPIL[0], C_EYE_PUPIL[1], C_EYE_PUPIL[2], 0.96, C_EYE_WHITE[0], C_EYE_WHITE[1], C_EYE_WHITE[2], 0.95, 111);
            } else {
              setCell(idx, 10, C_EYE_WHITE[0], C_EYE_WHITE[1], C_EYE_WHITE[2], 0.95, C_EYE_PUPIL[0], C_EYE_PUPIL[1], C_EYE_PUPIL[2], 0.9, 46);
            }
            continue;
          }

          const bx = lx / (0.62 * S);
          const widthTaper = 1 - 0.24 * clamp((lx + 0.2 * S) / (0.8 * S), -0.5, 1);
          const by = aly / (0.44 * S * widthTaper);
          const bodyDist = bx * bx + by * by;

          if (bodyDist <= 1.0) {
            const shade = clamp(1 - bodyDist * 0.55, 0.3, 1);
            if (aly < 0.08 * S && lx > -0.45 * S && lx < 0.45 * S) {
              setCell(idx, 8, C_RIDGE[0], C_RIDGE[1], C_RIDGE[2], 0.78 * alphaBoost, C_BODY[0], C_BODY[1], C_BODY[2], 0.95, 58);
              continue;
            }

            const s1 = Math.hypot(lx + 0.05 * S, aly - 0.19 * S);
            const s2 = Math.hypot(lx + 0.26 * S, aly - 0.14 * S);
            if (s1 < 0.095 * S || s2 < 0.08 * S) {
              setCell(idx, 7, C_SPOT[0], C_SPOT[1], C_SPOT[2], 0.85 * alphaBoost, C_SPOT_RIM[0], C_SPOT_RIM[1], C_SPOT_RIM[2], 0.9, 37);
              continue;
            }

            const gIdx = Math.min(GLYPH_RAMP.length - 1, Math.floor(shade * (GLYPH_RAMP.length - 1)));
            const glyph = GLYPH_RAMP.charCodeAt(gIdx);
            setCell(
              idx,
              6 + shade,
              C_BODY[0],
              C_BODY[1],
              C_BODY[2],
              (0.45 + 0.42 * shade) * alphaBoost,
              C_SPOT_RIM[0],
              C_SPOT_RIM[1],
              C_SPOT_RIM[2],
              0.82 * shade,
              glyph
            );
            continue;
          }

          const dThigh = distToSegment(lx, aly, hipX, hipY, kneeX, kneeY);
          const dCalf = distToSegment(lx, aly, kneeX, kneeY, ankleX, ankleY);
          const dFoot = distToSegment(lx, aly, ankleX, ankleY, footX, footY);
          const dHind = Math.min(dThigh, dCalf);

          if (dHind < legRad) {
            const isBand = Math.abs(dThigh - legRad * 0.4) < legRad * 0.18 && f.ext < 0.5;
            const col = isBand ? C_BAND : C_LEG;
            const g = f.ext > 0.4 ? 47 : 35;
            setCell(idx, 5, col[0], col[1], col[2], 0.72 * alphaBoost, C_RIDGE[0], C_RIDGE[1], C_RIDGE[2], 0.78, g);
            continue;
          }
          if (dFoot < legRad * 0.78) {
            setCell(idx, 4.5, C_TOE[0], C_TOE[1], C_TOE[2], 0.65 * alphaBoost, C_RIDGE[0], C_RIDGE[1], C_RIDGE[2], 0.75, 47);
            continue;
          }

          const dArm1 = distToSegment(lx, aly, shX, shY, elX, elY);
          const dArm2 = distToSegment(lx, aly, elX, elY, handX, handY);
          const dArm = Math.min(dArm1, dArm2);
          if (dArm < armRad) {
            setCell(idx, 4.8, C_LEG[0], C_LEG[1], C_LEG[2], 0.68 * alphaBoost, C_RIDGE[0], C_RIDGE[1], C_RIDGE[2], 0.75, 42);
          }
        }
      }
    }

    function rasterizeRipples() {
      for (let i = 0; i < totalCells; i++) {
        if (cellFlag[i]) continue;
        const e = rippleField[i];
        if (e > 0.02) {
          cellFlag[i] = 1;
          cellFillR[i] = C_RIPPLE[0];
          cellFillG[i] = C_RIPPLE[1];
          cellFillB[i] = C_RIPPLE[2];
          cellFillA[i] = e * 0.22;
          cellTextR[i] = C_RIPPLE[0];
          cellTextG[i] = C_RIPPLE[1];
          cellTextB[i] = C_RIPPLE[2];
          cellTextA[i] = Math.min(0.65, e * 0.75);
          cellGlyph[i] = e > 0.3 ? 126 : 45;
        }
      }
    }

    const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function drawFrame(dt) {
      if (!reducedMotion) {
        accumulator += dt;
        let steps = 0;
        while (accumulator >= STEP_DT && steps < 4) {
          elapsed += STEP_DT;
          updateFrogs(STEP_DT, elapsed);
          updateRipples(STEP_DT);
          accumulator -= STEP_DT;
          steps++;
        }
        if (steps === 4) accumulator = 0;
      }

      ctx.drawImage(bgCanvas, 0, 0, width, height);

      cellFlag.fill(0);
      cellPriority.fill(0);

      for (let i = 0; i < frogs.length; i++) {
        rasterizeFrog(frogs[i]);
      }
      rasterizeRipples();

      ctx.font = `${Math.max(10, Math.floor(cellW * 0.82))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let r = 0; r < rows; r++) {
        const y = r * cellH;
        const cy = y + cellH * 0.5;
        const rowOff = r * cols;

        for (let c = 0; c < cols; c++) {
          const idx = rowOff + c;
          if (!cellFlag[idx]) continue;

          const x = c * cellW;
          const fa = cellFillA[idx];
          if (fa > 0.01) {
            ctx.fillStyle = `rgba(${cellFillR[idx]},${cellFillG[idx]},${cellFillB[idx]},${fa.toFixed(2)})`;
            ctx.fillRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
          }

          const ta = cellTextA[idx];
          if (ta > 0.02 && cellGlyph[idx]) {
            ctx.fillStyle = `rgba(${cellTextR[idx]},${cellTextG[idx]},${cellTextB[idx]},${ta.toFixed(2)})`;
            ctx.fillText(String.fromCharCode(cellGlyph[idx]), x + cellW * 0.5, cy + 0.5);
          }
        }
      }
    }

    return { onResize, drawFrame, fps: 60 };
  }

  // =========================================================================
  // 2. CLOUD SEA SCENE
  // =========================================================================
  function createCloudSeaScene() {
    const GROUND = "#090d16";
    const PALETTE = [
      "#0e0e0f", "#161617", "#1f1f20", "#2a2a2b", "#353536", "#404041", "#545456", "#6c6c6e", "#8a8a8c",
      "#a39a94", "#2c211c", "#43302a", "#5e3c2a", "#7c4826", "#9c521f",
      "#c2601c", "#dc6f1e", "#f38020", "#f6922e", "#faae40", "#fbbd5c", "#fccb7c", "#fdda9e", "#feeac4", "#fff6e6"
    ];
    const HZ = 40, SUN = [150, HZ + 1.5], SR = 10, SKY = 0, SEA = 1;
    const { nearest } = makePaletteMatcher(PALETTE);
    const outStep = new Uint8Array(N), outColor = new Uint8Array(N);

    function ramp(stops, v, out) {
      let i = 1;
      while (i < stops.length - 1 && v > stops[i][0]) i++;
      const a = stops[i - 1], b = stops[i];
      const k = clamp01((v - a[0]) / (b[0] - a[0]));
      out[0] = mix(a[1], b[1], k); out[1] = mix(a[2], b[2], k); out[2] = mix(a[3], b[3], k);
    }

    const SKY_STOPS = [[0, 0.035, 0.035, 0.04], [0.4, 0.075, 0.075, 0.08], [0.72, 0.16, 0.155, 0.16], [0.9, 0.2, 0.185, 0.18], [1, 0.25, 0.2, 0.18]];
    const SEA_STOPS = [[0, 0.06, 0.06, 0.065], [0.2, 0.13, 0.125, 0.13], [0.38, 0.3, 0.2, 0.15], [0.55, 0.62, 0.3, 0.1], [0.7, 0.953, 0.502, 0.125], [0.84, 0.98, 0.682, 0.251], [0.94, 1.0, 0.84, 0.55], [1, 1.0, 0.94, 0.8]];

    const DY = [];
    for (let d = 0.7; d < 120; d *= 1.1) DY.push(d);
    const NL = DY.length, WB = 1.7, PU = 50, RES = 16, US = PU * RES;

    const gTmp = [0, 0, 0], SEAT = new Float32Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      ramp(SEA_STOPS, i / 255, gTmp);
      SEAT[i * 3] = gTmp[0]; SEAT[i * 3 + 1] = gTmp[1]; SEAT[i * 3 + 2] = gTmp[2];
    }

    const sky = new Float32Array(N * 3);
    for (let r = 0; r < H; r++) {
      for (let x = 0; x < W; x++) {
        const y = r + 0.5, dx = x + 0.5 - SUN[0], v = Math.min(1, y / HZ), near = Math.exp(-Math.abs(dx) / 60);
        ramp(SKY_STOPS, Math.pow(v, 1.15 - 0.2 * near), gTmp);
        const haze = 0.9 + 0.2 * fbm(x * 0.025, y * 0.14, 3, 0);
        const hot = Math.pow(smooth(0.6, 1, v), 1.6) * (0.08 + 0.92 * near);
        const k = (r * W + x) * 3;
        sky[k] = (gTmp[0] + 0.75 * hot) * haze;
        sky[k + 1] = (gTmp[1] + 0.33 * hot) * haze;
        sky[k + 2] = (gTmp[2] * (1 - 0.3 * hot) + 0.03 * hot) * haze;
        const ci = smooth(0.6, 0.78, fbm(x * 0.011 + y * 0.02, y * 0.42, 4, 0)) * smooth(4, 14, y) * smooth(34, 20, y);
        const lit = ci * 0.5 * near;
        sky[k] = mix(sky[k], 0.95, lit); sky[k + 1] = mix(sky[k + 1], 0.5, lit); sky[k + 2] = mix(sky[k + 2], 0.18, lit);
      }
    }

    const HT = new Float32Array(NL * US), SL = new Float32Array(NL * US);
    const prof = (j, u) => 0.05 + 0.36 * Math.pow(smooth(0.28, 0.74, fbm(u * 0.9, j * 4.7, 4, PU * 0.9)), 0.85);
    for (let j = 0; j < NL; j++) {
      for (let i = 0; i < US; i++) {
        const u = i / RES;
        HT[j * US + i] = prof(j, u);
        SL[j * US + i] = (prof(j, u + 0.05) - prof(j, u - 0.05)) * 10;
      }
    }

    const mat = new Uint8Array(N), lay = new Uint8Array(N);
    const sv = new Float32Array(N), sl = new Float32Array(N), uu = new Float32Array(N), dtop = new Float32Array(N);
    const FR = new Float32Array(N), FG = new Float32Array(N), FB = new Float32Array(N);
    let sprites = [];

    function onResize() {
      sprites = buildSpritesForPalette(PALETTE, Math.max(width / W, height / H));
    }

    function drawFrame(_dt, t) {
      const drift = t * 0.12, pulse = Math.sin((t / 4) * Math.PI * 2);
      mat.fill(SKY);
      for (let x = 0; x < W; x++) {
        const xc = x + 0.5;
        let ub = H;
        for (let j = NL - 1; j >= 0 && ub > 0; j--) {
          const dy = DY[j], base = HZ + dy;
          const u = ((xc - 100) / dy) * WB + drift + j * 13.7;
          let su = ((u * RES) % US + US) % US;
          const i0 = su | 0, f = su - i0, i1 = (i0 + 1) % US, o = j * US;
          const h = (HT[o + i0] + (HT[o + i1] - HT[o + i0]) * f) * dy;
          const top = base - h, r0 = Math.max(0, Math.ceil(top - 0.5));
          if (r0 >= ub) continue;
          const slope = SL[o + i0] + (SL[o + i1] - SL[o + i0]) * f;
          for (let r = r0; r < ub; r++) {
            const k = r * W + x;
            mat[k] = SEA; lay[k] = j; sv[k] = (base - r - 0.5) / h; sl[k] = slope; uu[k] = u; dtop[k] = r + 0.5 - top;
          }
          ub = r0;
        }
      }

      const sr = SR + 0.35 * pulse, glowK = 1 + 0.12 * pulse;
      for (let r = 0; r < H; r++) {
        const y = r + 0.5;
        for (let x = 0; x < W; x++) {
          const k = r * W + x, m = mat[k], dx = x + 0.5 - SUN[0], dsy = y - SUN[1];
          const ds = Math.sqrt(dx * dx + dsy * dsy * 2.2), near = Math.exp(-Math.abs(dx) / 55);
          let cr = 0, cg = 0, cb = 0;
          if (m === SKY) {
            const s = k * 3;
            cr = sky[s]; cg = sky[s + 1]; cb = sky[s + 2];
            const glow = (Math.exp(-ds / 30) * 0.3 + Math.exp(-ds / 11) * 0.35) * glowK;
            cr += glow; cg += glow * 0.55; cb += glow * 0.18;
            const dd = Math.sqrt(dx * dx + dsy * dsy);
            if (dd < sr + 0.6) {
              const e = dd / sr, a = smooth(sr + 0.45, sr - 0.45, dd);
              cr = mix(cr, 1.0, a); cg = mix(cg, 0.94 - 0.3 * e * e * e, a); cb = mix(cb, 0.78 - 0.5 * e * e, a);
            }
            if (r < 16 && hash(x, r * 5 + 3) > 0.992) {
              const tw = 0.55 + 0.45 * Math.sin(t * (0.8 + hash(r, x) * 1.6) + hash(x, r) * 6.28);
              const st = tw * smooth(16, 2, r) * 0.7;
              cr = Math.max(cr, st * 0.95); cg = Math.max(cg, st * 0.92); cb = Math.max(cb, st * 0.86);
            }
          } else {
            const j = lay[k], dy = DY[j], s = sv[k], u = uu[k], dt = dtop[k];
            const rim = Math.exp(-dt / (0.7 + 0.06 * dy)), face = clamp01(s);
            const side = clamp01(0.5 - sl[k] * (dx < 0 ? -1 : 1) * 0.9);
            const tex = (noise(u * 3.2, s * 2.5 + j * 5.3, 0) - 0.5) * 0.18 * smooth(3, 14, dy);
            const sh = noise(u * 2.2 - t * 0.35, j * 1.7 + t * 0.25, 0);
            const shimmer = smooth(0.55, 0.85, sh) * rim * (0.1 + 0.45 * near);
            const az = 0.25 + 0.9 * near;
            let b = (0.07 + 0.17 * face + 0.22 * (side - 0.5) * face + tex) * az + rim * (0.22 + 0.55 * near) + shimmer;
            b -= 0.2 * smooth(0, -0.6, s);
            b = clamp01(b * (0.9 + 0.12 * smooth(30, 4, dy)));
            const ci = ((b * 255) | 0) * 3;
            cr = SEAT[ci]; cg = SEAT[ci + 1]; cb = SEAT[ci + 2];
            const cool = (1 - near) * (1 - rim) * 0.7;
            cr = mix(cr, 0.07 * az, cool); cg = mix(cg, 0.068 * az, cool); cb = mix(cb, 0.072 * az, cool);
            const haze = Math.exp(-dy / 5) * 0.85, hg = (Math.exp(-ds / 26) * 0.5 + 0.5 * near) * glowK;
            cr = mix(cr, 0.17 + 0.83 * hg, haze); cg = mix(cg, 0.16 + 0.48 * hg, haze); cb = mix(cb, 0.17, haze);
            const bloom = Math.exp(-ds / 13) * 0.5 * glowK * (0.4 + rim);
            cr += bloom; cg += bloom * 0.62; cb += bloom * 0.25;
          }
          FR[k] = cr; FG[k] = cg; FB[k] = cb;
        }
      }

      for (let i = 0; i < 3; i++) {
        const bx = Math.floor(((t * (4.5 + i * 0.4) + i * 11 + 30) % (W + 40)) - 20);
        const by = Math.round(16 + i * 2.6 + 0.8 * Math.sin(t * 0.9 + i * 2));
        const up = Math.sin(t * 7 + i * 1.9) > 0;
        const cells = up ? [[0, 0], [-1, -1], [1, -1], [-2, -1], [2, -1]] : [[0, 0], [-1, 0], [1, 0], [-2, 1], [2, 1]];
        for (const [ox, oy] of cells) {
          const x = bx + ox, r = by + oy;
          if (x < 0 || x >= W || r < 0 || r >= H) continue;
          const k = r * W + x;
          if (mat[k] !== SKY) continue;
          FR[k] = 0.3; FG[k] = 0.18; FB[k] = 0.12;
        }
      }

      for (let r = 0; r < H; r++) {
        const fade = smooth(H + 4, H - 6, r + 0.5);
        for (let x = 0; x < W; x++) {
          const k = r * W + x, m = mat[k], floor = m === SKY ? 0.04 : 0.06, fd = m === SEA ? fade : 1;
          const cr = FR[k], cg = FG[k], cb = FB[k], peak = Math.max(cr, cg, cb, 1e-4);
          const level = clamp01(floor + (1 - floor) * Math.pow(peak, 0.85) * 0.95) * fd;
          const step = Math.max(0, Math.min(3, Math.round(level * 3 + BAYER[(r & 3) * 4 + (x & 3)])));
          outStep[k] = step;
          if (step) {
            const want = Math.min(1, (level + 0.06) / COVER[step]);
            const s = ((0.3 + 0.7 * want) * (0.4 + 0.6 * smooth(0.14, 0.5, level))) / peak;
            outColor[k] = nearest(clamp01(cr * s), clamp01(cg * s), clamp01(cb * s));
          }
        }
      }
      renderHalftoneGrid(outStep, outColor, sprites, GROUND);
    }

    return { onResize, drawFrame, fps: 15 };
  }

  // =========================================================================
  // 3. LANTERN LAKE SCENE
  // =========================================================================
  function createLanternLakeScene() {
    const GROUND = "#04060d";
    const PALETTE = [
      "#141b30", "#1c2a52", "#22346a", "#2a4080", "#324c96", "#3c58a8",
      "#33306e", "#433c88", "#54449a",
      "#62407e", "#7a4a88", "#934e86",
      "#a4546e", "#bc5e66", "#d06a62",
      "#dc7650", "#e88444", "#f09238",
      "#d4581a", "#ea6c1e", "#f78226", "#ff9530", "#ffa83c", "#ffbb4e", "#ffcc66", "#ffdc86", "#ffe8a8",
      "#fff3cf", "#fffbec",
      "#b8341a", "#d84420",
      "#2f3748", "#4f586c", "#5e5a7e", "#7a6a8c",
      "#5a3220", "#7c4628",
      "#4a5578", "#5d6a92", "#7381ab",
      "#c4cdec", "#e4e9fb", "#ffffff"
    ];
    const WL = 64, SRC = 100, BX = 108.5, BW = 90, SC = 1.4, FX = BX - 3 * SC;
    const CYCLE = 20, LET_GO = 3, LIT = 6, HELD = 5 * SC;
    const AIR = 0, FAR = 1, BACK = 2, PEAK = 3, TREE = 4;
    const STAR = PALETTE.length - 3, SL = STAR - 3, S = WL * W;

    const { nearest } = makePaletteMatcher(PALETTE, SL);
    const outStep = new Uint8Array(N), outColor = new Uint8Array(N);

    const PEAKS = [[22, 42, 1.2], [-4, 33, 0.9], [172, 33, 1.05], [215, 22, 0.6]];
    const SHOULDERS = [[50, 25, 1], [64, 12, 0.75], [150, 17, 0.95], [196, 21, 0.75]];
    const DISTANT = [[98, 17, 0.42], [122, 14, 0.5], [82, 12, 0.45], [140, 11, 0.5]];

    function range(x, peaks, seed, rough) {
      let m = -99, px = 0;
      for (const [cx, h, s] of peaks) {
        const v = h - Math.abs(x - cx) * s;
        if (v > m) { m = v; px = cx; }
      }
      const j = rough * (fbm(x * 0.09, seed, 3) - 0.5) + rough * 0.45 * (noise(x * 0.45, seed + 5) - 0.5);
      return [m + j * Math.min(1, Math.max(0, m) / 6), px];
    }

    function insideLantern(u, v) {
      if (v < 0 || v > 1) return false;
      let hw = 0.34 - 0.08 * v;
      if (v < 0.14) hw *= Math.sqrt(1 - 0.6 * ((0.14 - v) / 0.14) ** 2);
      return u <= hw && u >= -hw;
    }

    const mat = new Uint8Array(S), far = new Uint8Array(S);
    const sR = new Float32Array(S), sG = new Float32Array(S), sB = new Float32Array(S), take = new Float32Array(S);
    const backTop = new Float32Array(W), backX = new Float32Array(W), frontTop = new Float32Array(W), frontX = new Float32Array(W), farTop = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const [hb, pb] = range(x + 0.5, PEAKS, 3.1, 4);
      const [hf, pf] = range(x + 0.5, SHOULDERS, 7.7, 3);
      const [hd] = range(x + 0.5, DISTANT, 11.3, 2.2);
      backTop[x] = WL - Math.max(hb, 0); backX[x] = pb;
      frontTop[x] = WL - Math.max(hf, 0); frontX[x] = pf;
      farTop[x] = WL - Math.max(hd, 0);
    }

    const dome = (x, y) => {
      const up = Math.max(0, WL - 6 - y), dx = (x - SRC - 0.3 * up) / (44 + up);
      return Math.exp(-dx * dx) * (0.6 * Math.exp(-up / 14) + 0.4 * Math.exp(-up / 40));
    };
    const HUES = [[0.22, 0.36, 1], [0.46, 0.36, 1], [0.76, 0.42, 0.92], [1, 0.48, 0.58], [1, 0.54, 0.34], [1, 0.58, 0.2]];
    const hue = (w, j) => {
      const f = clamp01(w) * 5, i = Math.min(4, Math.floor(f));
      return mix(HUES[i][j], HUES[i + 1][j], f - i);
    };
    const slopeFn = (k, x, y, top, px, haze, relief, edge, warm) => {
      const xc = x + 0.5, depth = y - top, inward = px < SRC ? 1 : -1;
      const ridge = px + (depth + 1) * 0.6 * (noise(y * 0.1, px) - 0.5);
      const face = smooth(-4, 4, (xc - ridge) * inward);
      const u = x + depth * 0.45 * Math.sign(xc - px || 1);
      const rib = (q) => fbm(q * 0.13, px * 0.37, 3);
      const lit = clamp01(0.3 + 0.5 * face + ((rib(u + 1) - rib(u - 1)) * 7 * inward) * 0.5);
      const tex = 0.8 + 0.4 * fbm(x * 0.35, y * 0.35, 2);
      const w = lit * Math.exp(-(((xc - SRC) / 70) ** 2)) * (0.4 + 0.6 * smooth(top + 2, WL, y)) * 0.9;
      const b = (haze + relief * lit * lit) * tex + 0.16 * w, rim = smooth(1.8, 0.3, depth) * edge, sky = dome(xc, top - 1);
      sR[k] = b * hue(w * warm, 0) + rim * hue(sky, 0);
      sG[k] = b * hue(w * warm, 1) + rim * hue(sky, 1);
      sB[k] = b * hue(w * warm, 2) + rim * hue(sky, 2);
      return w;
    };

    for (let r = 0; r < WL; r++) {
      for (let x = 0; x < W; x++) {
        const k = r * W + x, y = r + 0.5, xc = x + 0.5;
        if (y >= frontTop[x]) {
          mat[k] = PEAK;
          slopeFn(k, x, y, frontTop[x], frontX[x], 0.05, 0.06, 0.3, 1);
        } else if (y >= backTop[x]) {
          mat[k] = BACK;
          if (slopeFn(k, x, y, backTop[x], backX[x], 0.24, 0.3, 0.35, 0.5) < 0.3 && y - backTop[x] > 1.2) far[k] = 1;
        } else if (y >= farTop[x]) {
          mat[k] = FAR;
          const tex = fbm(x * 0.2, y * 0.3, 3), w = dome(xc, y), b = 0.06 + 0.04 * tex + 0.3 * w + 0.7 * w ** 3;
          sR[k] = b * hue(w, 0); sG[k] = b * hue(w, 1); sB[k] = b * hue(w, 2);
        } else {
          const v = Math.pow(y / WL, 1.5), hz = 0.85 + 0.3 * fbm(x * 0.04, r * 0.07, 3), w = dome(xc, y);
          const b = (0.18 + 0.32 * v) * hz + 0.5 * w;
          sR[k] = b * hue(w, 0); sG[k] = b * hue(w, 1); sB[k] = b * hue(w, 2);
          take[k] = w;
        }
      }
    }

    const scrub = (x) => WL - 2.4 - 1.4 * fbm(x * 0.15, 5.5, 3);
    for (let r = 0; r < WL; r++) for (let x = 0; x < W; x++) if (r + 0.5 >= scrub(x + 0.5)) mat[r * W + x] = TREE;
    const spruce = (tx, th, tw, tb) => {
      for (let r = Math.max(0, Math.floor(tb - th)); r < WL; r++) {
        const y = r + 0.5, dy = y - (tb - th);
        if (dy < 0 || y >= tb + 0.5) continue;
        const tier = (dy + th * 0.3) / 1.6, w = (dy / th) * tw * (0.7 + 0.45 * (tier - Math.floor(tier))) + 0.3;
        for (let x = Math.max(0, Math.floor(tx - tw - 1)); x <= Math.min(W - 1, tx + tw + 1); x++) {
          if (Math.abs(x + 0.5 - tx) <= w) mat[r * W + x] = TREE;
        }
      }
    };
    for (let x = -2; x < W + 2;) {
      const h = hash(Math.floor(x * 7), 21), clearing = smooth(22, 0, Math.abs(x - SRC));
      const th = (2.6 + 4.4 * hash(Math.floor(x * 3), 5) ** 1.2) * (1 - 0.3 * clearing);
      spruce(x + hash(Math.floor(x), 2), th, 1 + 0.8 * hash(Math.floor(x), 4), scrub(x) + 1);
      x += 1.2 + 1.8 * h;
    }
    for (let k = 0; k < S; k++) {
      if (mat[k] !== TREE) continue;
      const x = k % W, r = (k / W) | 0, h = hash(x * 13 + r, 5);
      sR[k] = 0.004 + 0.004 * h; sG[k] = 0.006 + 0.006 * h; sB[k] = 0.012 + 0.008 * h;
      const edge = r === 0 || mat[k - W] !== TREE ? 1 : r > 1 && mat[k - 2 * W] !== TREE ? 0.35 : 0;
      const g = edge * dome(x + 0.5, r + 0.5) * 0.45;
      sR[k] += g; sG[k] += g * 0.5; sB[k] += g * 0.18;
      take[k] = edge * 0.5;
    }

    const floorS = new Float32Array(S);
    for (let k = 0; k < S; k++) floorS[k] = mat[k] === AIR ? 0.04 + 0.08 * ((k / W) | 0) / WL : mat[k] === FAR || mat[k] === BACK ? 0.03 : 0;

    const shoreLights = [];
    for (let i = 0, x = SRC - 24; i < 8; i++) {
      shoreLights.push([Math.round(x), WL - 1 - (hash(i, 62) > 0.6 ? 1 : 0), hash(i, 63) * 6.28]);
      x += 2 + 9 * hash(i, 61) ** 2;
    }
    const stars = [];
    for (let k = 0; k < S; k++) {
      if (mat[k] !== AIR) continue;
      const h = hash(k % W, Math.floor(k / W) + 101);
      if (h > 0.985 && take[k] < 0.25) stars.push([k, hash(k, 3) * 6.28, 0.8 + hash(k, 4) * 2.5, (0.45 + (h - 0.985) * 40) * (1 - take[k] * 2.5)]);
    }
    const gap = new Uint8Array(H);
    for (let r = WL; r < H; r++) gap[r] = hash(r, 404) < 0.3 ? 1 : 0;

    const shore = [];
    for (let i = 0; i < 240; i++) {
      const near = i >= 196, s = near ? 1.5 + 1.7 * hash(i, 11) ** 1.5 : 0.45 + 0.9 * hash(i, 11) ** 1.4;
      const v = 0.3 + 0.62 * s, out = near && hash(i, 12) < 0.7, climb = out ? WL + 3 * s + 4 : 12 + 46 * hash(i, 13) ** 0.8;
      shore.push({
        i, s, v, life: (climb + s + 1) / v, off: hash(i, 14), wd: 0.12 + 0.3 * hash(i, 15),
        sw: 0.25 * s + 0.2, sf: 0.3 + 0.5 * hash(i, 16), ph: hash(i, 17) * 6.28, f1: 2 + 3 * hash(i, 18), f2: 5 + 4 * hash(i, 19),
        out, wide: near || hash(i, 20) < 0.08
      });
    }
    shore.sort((a, b) => a.s - b.s);
    const startX = (f, lap) => {
      const n = f.i * 7 + lap * 131;
      return f.wide ? 12 + 176 * hash(n, 23) : SRC - 6 + 30 * (hash(n, 23) + hash(n, 24) + hash(n, 25) - 1.5);
    };
    const lean = (f, climb) => climb * f.wd + climb * climb * 0.004;

    const NEAR = [[12.5, 34, 30], [8.5, 178, 14], [6.5, 66, 74], [5.2, 154, 46], [4.4, 18, 86], [4.6, 136, 4], [9.5, 190, 116], [10.5, 150, 160], [5.8, 80, 128], [7, 28, 190], [4.2, 172, 150]];
    const close = NEAR.map(([s, x, y], i) => {
      const v = 0.35 + 0.42 * s, path = H + 5 * s, life = (path / v) * (1.08 + 0.3 * hash(i, 41));
      return { i, s, v, x, path, life, off: (H + 2.5 * s - y) / v / life, wd: s * 0.05, sw: 0.35 * s, sf: 0.2 + 0.2 * hash(i, 42), ph: hash(i, 43) * 6.28 };
    });

    const ARMS = { up: [[1.3, 9.4], [3, 11.5], [2, 14.1]], down: [[1.3, 9.4], [2, 6.6], [1.9, 4.4]], chest: [[1.3, 9.4], [2.4, 7.2], [1.2, 6]] };
    const gunwale = (dx) => 2.4 + (dx > 0 ? 3 : 1.8) * smooth(4, 12.5, Math.abs(dx)) ** 2;
    const hull = (dx, up) => up <= gunwale(dx) && up > -0.6 && Math.abs(dx) <= 12.5 - Math.max(0, 1.8 - up) * 2.4;
    const body = (dx, up, arms) => {
      if ((dx * dx) / 1.3 + (up - 11.2) ** 2 / 1.5 < 1) return true;
      if (up <= 9.8 && up > 1 && Math.abs(dx) <= 1.35 + 0.5 * smooth(9.8, 2, up)) return true;
      const ax = Math.abs(dx);
      return seg(ax, up, arms[0][0], arms[0][1], arms[1][0], arms[1][1])[0] < 0.66 || seg(ax, up, arms[1][0], arms[1][1], arms[2][0], arms[2][1])[0] < 0.58;
    };
    const BOX = [Math.floor(BX - 13 * SC), BW - Math.ceil(16 * SC), Math.ceil(27 * SC), Math.ceil(16 * SC) + 2];
    const hulls = new Uint8Array(BOX[2] * BOX[3]), shape = new Uint8Array(BOX[2] * BOX[3]);
    for (let j = 0; j < BOX[3]; j++) for (let i = 0; i < BOX[2]; i++) if (hull((BOX[0] + i + 0.5 - BX) / SC, (BW - (BOX[1] + j + 0.5)) / SC)) hulls[j * BOX[2] + i] = 1;
    const arms = ARMS.up.map((p) => [...p]);
    const pose = (a, b, k) => {
      for (let i = 0; i < 3; i++) { arms[i][0] = mix(a[i][0], b[i][0], k); arms[i][1] = mix(a[i][1], b[i][1], k); }
      for (let j = 0; j < BOX[3]; j++) for (let i = 0; i < BOX[2]; i++) {
        const q = j * BOX[2] + i;
        shape[q] = hulls[q] || (body((BOX[0] + i + 0.5 - FX) / SC, (BW - (BOX[1] + j + 0.5)) / SC, arms) ? 2 : 0);
      }
    };
    const BOWX = BX + 11.2 * SC, BOWY = BW - (gunwale(11.2) + 1.2) * SC;

    const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), FL = new Float32Array(N);
    const paint = (k, pr, pg, pb, a) => {
      R[k] += (pr - R[k]) * a; G[k] += (pg - G[k]) * a; B[k] += (pb - B[k]) * a;
      if (FL[k] < 0.12 * a) FL[k] = 0.12 * a;
    };
    const lantern = (cx, cy, h, I, a, limit, hide) => {
      if (h < 1.4) {
        const x = Math.floor(cx), r = Math.floor(cy);
        if (x < 0 || x >= W || r < 0 || r >= limit) return;
        const k = r * W + x;
        if (hide && hide[k]) return;
        const q = I * (0.85 + 0.15 * h);
        paint(k, q, q * (0.42 + 0.3 * q), q * (0.1 + 0.18 * q * q), a);
        return;
      }
      if (h < 2.6) {
        const x = Math.floor(cx), top = cy - 1, r0 = Math.floor(top);
        if (x < 0 || x >= W) return;
        for (let r = r0; r <= r0 + 2; r++) {
          if (r < 0 || r >= limit) continue;
          const k = r * W + x;
          if (hide && hide[k]) continue;
          const up = Math.max(0, Math.min(r + 1, top + 1) - Math.max(r, top)), dn = Math.max(0, Math.min(r + 1, top + 2) - Math.max(r, top + 1));
          if (up + dn < 0.02) continue;
          const q = I * (0.8 * up + 1.1 * dn) / (up + dn);
          paint(k, q, q * (0.34 + 0.36 * q), q * (0.06 + 0.2 * q * q), a * (up + dn));
        }
        return;
      }
      const top = cy - h / 2, x0 = Math.max(0, Math.floor(cx - 0.36 * h)), x1 = Math.min(W - 1, Math.floor(cx + 0.36 * h));
      const r0 = Math.max(0, Math.floor(top)), r1 = Math.min(limit - 1, Math.floor(top + h));
      for (let r = r0; r <= r1; r++) {
        for (let x = x0; x <= x1; x++) {
          const k = r * W + x;
          if (hide && hide[k]) continue;
          let cov = 0;
          for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) if (insideLantern((x + (sx + 0.5) / 3 - cx) / h, (r + (sy + 0.5) / 3 - top) / h)) cov++;
          if (!cov) continue;
          const u = (x + 0.5 - cx) / h, v = clamp01((r + 0.5 - top) / h), xn = Math.min(1, Math.abs(u) / (0.34 - 0.08 * v));
          const q = I * (1 - 0.3 * xn * xn) * (0.78 + 0.42 * v), fl = Math.exp(-((u / 0.13) ** 2) - ((v - 0.9) / 0.1) ** 2) * I;
          paint(k, q + fl * 0.3, q * (0.3 + 0.42 * q) + fl * 0.6, q * (0.04 + 0.2 * q * q) + fl * 0.5, (cov / 9) * a);
        }
      }
    };
    const halo = (cx, cy, h, g, limit) => {
      const e = 0.4 + 0.32 * h, reach = Math.ceil(e * 4);
      const r0 = Math.max(0, Math.floor(cy - reach)), r1 = Math.min(limit - 1, Math.floor(cy + reach));
      const x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(W - 1, Math.floor(cx + reach));
      for (let r = r0; r <= r1; r++) {
        const dy = r + 0.5 - cy;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx, d = Math.max(0, Math.sqrt(dx * dx + dy * dy) - 0.3 * h);
          const q = g * (Math.exp(-d / e) + 0.25 * Math.exp(-d / (e * 2.5))), k = r * W + x;
          R[k] += q; G[k] += q * 0.5; B[k] += q * 0.17;
        }
      }
    };
    const hide = new Uint8Array(S);
    for (let k = 0; k < S; k++) hide[k] = mat[k] === TREE ? 1 : 0;
    const roadX = new Float32Array(H), roadW = new Float32Array(H), roadA = new Float32Array(H);
    for (let r = WL; r < H; r++) {
      const dw = r + 0.5 - WL;
      roadX[r] = SRC + 4 + dw * 0.12; roadW[r] = 7 + dw * 0.9; roadA[r] = 0.9 * smooth(3, 16, dw) * Math.exp(-dw / 60);
    }

    let sprites = [];
    function onResize() {
      sprites = buildSpritesForPalette(PALETTE, Math.max(width / W, height / H));
    }

    function drawFrame(_dt, t) {
      const breathe = 0.06 * Math.sin(t * 0.5) + 0.04 * Math.sin(t * 1.7 + 1);
      for (let k = 0; k < S; k++) {
        const g = 1 + take[k] * breathe;
        R[k] = sR[k] * g; G[k] = sG[k] * g; B[k] = sB[k] * g; FL[k] = floorS[k];
      }
      for (const f of shore) {
        const u = t / f.life + f.off, lap = Math.floor(u), a = (u - lap) * f.life;
        const cx = startX(f, lap) + lean(f, f.v * a) + f.sw * (Math.sin(a * f.sf + f.ph) - Math.sin(f.ph));
        const cy = WL + f.s * 0.5 + 0.6 - f.v * a;
        if (cy < -2 * f.s - 2) continue;
        let I = (0.7 + 0.45 * Math.min(1, f.s)) * (0.88 + 0.08 * Math.sin(t * f.f1 + f.ph) + 0.04 * Math.sin(t * f.f2)), alpha = 1;
        if (!f.out) {
          const end = smooth(f.life - 4, f.life, a);
          I *= 1 - 0.55 * end * (0.6 + 0.4 * Math.sin(a * 11 + f.ph)); alpha = 1 - end;
        }
        if (alpha <= 0.01) continue;
        if (f.s >= 1.4) halo(cx, cy, f.s, 0.07 * I * alpha * smooth(0, 2, a), WL);
        lantern(cx, cy, f.s, I, alpha, WL, hide);
      }
      for (const [x, r, ph] of shoreLights) {
        const k = r * W + x, q = 0.9 + 0.15 * Math.sin(t * 3.1 + ph) + 0.1 * Math.sin(t * 7.3 + ph * 2);
        R[k] = q; G[k] = q * 0.62; B[k] = q * 0.24; FL[k] = 0.2;
      }
      for (let r = WL; r < H; r++) {
        const y = r + 0.5, dw = y - WL, deep = mix(1, 0.65, dw / (H - WL)), ry = WL - 1 - (r - WL);
        const r0 = Math.max(0, ry) * W, r1 = Math.max(0, ry - 1) * W, r2 = Math.max(0, ry - 2) * W;
        const fade = smooth(H + 4, H - 7, y), rx = roadX[r], rw = roadW[r], ra = roadA[r];
        for (let x = 0; x < W; x++) {
          const k = r * W + x, wave = noise(x * 0.04 + t * 0.05, r * 0.55 - t * 0.35);
          const sx = x + (0.45 + dw * 0.075) * Math.sin(r * 1.3 + t * 1.6 + wave * 4);
          let ix = Math.floor(sx); const fx = sx - ix; ix = Math.max(0, Math.min(W - 2, ix));
          const a0 = r0 + ix, a1 = r1 + ix, a2 = r2 + ix, sky = mat[a0] !== TREE;
          const streak = smooth(0.25, 0.75, noise(x * 0.035 + t * 0.04, r * 0.75 - t * 0.3));
          let kr = 0.9 * (0.5 + 0.5 * streak) * (0.85 + 0.25 * wave) * deep;
          if (gap[r] && wave < 0.45) kr *= 0.2;
          const gx = 1 - fx;
          let cr = ((R[a0] * gx + R[a0 + 1] * fx) * 0.5 + (R[a1] * gx + R[a1 + 1] * fx) * 0.3 + (R[a2] * gx + R[a2 + 1] * fx) * 0.2) * kr + 0.006;
          let cg = ((G[a0] * gx + G[a0 + 1] * fx) * 0.5 + (G[a1] * gx + G[a1 + 1] * fx) * 0.3 + (G[a2] * gx + G[a2 + 1] * fx) * 0.2) * kr + 0.012;
          let cb = ((B[a0] * gx + B[a0 + 1] * fx) * 0.5 + (B[a1] * gx + B[a1 + 1] * fx) * 0.3 + (B[a2] * gx + B[a2 + 1] * fx) * 0.2) * kr + 0.028;
          let g = 0; const qx = (x + 0.5 - rx) / rw;
          if (qx > -2.2 && qx < 2.2) g = ra * Math.exp(-qx * qx) * (0.3 + 0.7 * smooth(0.42, 0.72, noise(x * 0.11 + t * 0.1, r * 0.9 - t * 0.55))) * (gap[r] ? 0.55 : 1);
          if (dw < 10) for (const [lx, , ph] of shoreLights) {
            const d = x - lx; if (d > 3 || d < -3) continue;
            g += Math.exp(-d * d * 1.5) * Math.exp(-dw / 4) * smooth(0.35, 0.7, noise(x * 0.6 + ph, y * 1.3 - t * 1.4)) * 0.8;
          }
          if (g > 0) { const keep = 1 - Math.min(0.9, g * 4); cr = cr * keep + g; cg = cg * keep + g * 0.56; cb = cb * keep + g * 0.2; }
          if (g < 0.2) {
            const sheen = smooth(0.6, 0.85, noise(x * 0.07 + t * 0.03, r * 1.1 - t * 0.25)) * 0.12 * (1 - g * 5) * deep;
            cr += sheen * 0.3; cg += sheen * 0.48; cb += sheen;
          }
          R[k] = cr * fade; G[k] = cg * fade; B[k] = cb * fade; FL[k] = (sky ? 0.07 * deep : 0.03) * fade;
        }
      }

      const tc = ((t % CYCLE) + CYCLE) % CYCLE, bob = (at) => 0.3 * Math.sin(at * 1.3), holdY = BW - 14.1 * SC - HELD / 2;
      const flick = (m) => 1.1 + 0.05 * Math.sin(t * 4.7 + m * 2.1) + 0.03 * Math.sin(t * 11.3 + m * 5.3);
      const n = Math.floor(t / CYCLE), mine = flick(tc < LET_GO ? n : n + 1);
      let hy = 0, hs = HELD, ha = 0;
      if (tc < LET_GO || tc >= LIT + 5) { hy = holdY + bob(t); ha = 1; }
      else if (tc >= LIT) {
        ha = smooth(LIT, LIT + 2.5, tc); hs = HELD * (0.75 + 0.25 * smooth(LIT, LIT + 3, tc));
        hy = mix(BW - 8.6 * SC, holdY + bob(t), smooth(LIT + 3.5, LIT + 5, tc));
      }
      if (tc < LET_GO + 2) pose(ARMS.up, ARMS.down, smooth(LET_GO + 1, LET_GO + 2, tc));
      else if (tc < LIT + 1) pose(ARMS.down, ARMS.chest, smooth(LIT - 0.6, LIT, tc));
      else pose(ARMS.chest, ARMS.up, smooth(LIT + 3.5, LIT + 5, tc));

      const flights = [];
      for (let m = n; m >= n - 2; m--) {
        const tr = m * CYCLE + LET_GO, age = t - tr; if (age < 0) continue;
        const y = holdY + bob(tr) - 2.8 * (age - 1.5 * (1 - Math.exp(-age / 1.5)));
        if (y < -3 * HELD) continue;
        flights.push([FX + 0.3 * age + 1.2 * Math.sin(age * 0.35), y, flick(m)]);
      }

      const lights = [], lamp = 1.2 + 0.04 * Math.sin(t * 5.3) + 0.03 * Math.sin(t * 12.7);
      lights.push([BOWX, BOWY + 1, 0.4 * lamp, 0.4]);
      halo(BOWX, BOWY, 2, 0.07 * lamp, H);
      if (ha > 0) lights.push([FX, hy + hs / 2, ha * mine, 1]);
      for (const [x, y, l] of flights) {
        halo(x, y, HELD, 0.2 * l, H);
        lights.push([x, y + HELD / 2, l * Math.exp(-Math.max(0, holdY - y) / 8), 1]);
      }
      if (ha > 0) halo(FX, hy, HELD, 0.2 * ha * mine, H);
      for (const [lx, , q, sz] of lights) {
        if (q < 0.003) continue;
        for (let r = Math.floor(BW - 9 * SC); r < H; r++) {
          const y = r + 0.5, dw = y - BW;
          for (let x = Math.max(0, Math.floor(lx - 34 * sz)); x < Math.min(W, lx + 34 * sz); x++) {
            const k = r * W + x, dx = x + 0.5 - lx;
            let g = Math.exp(-Math.sqrt((dx / (16 * SC * 0.8 * sz)) ** 2 + (dw / ((dw < 0 ? 2.6 : 3.6) * SC * sz)) ** 2)) * 0.5;
            if (dw > -1) {
              const w = (1.4 + 0.2 * Math.max(0, dw)) * (0.5 + 0.5 * sz);
              g += Math.exp(-((dx / w) ** 2)) * Math.exp(-Math.max(0, dw) / (16 * sz)) * smooth(0.4, 0.72, noise(x * 0.45 + 3, y * 1.2 - t * 1.3)) * 1.1;
            }
            g *= q;
            const keep = 1 - Math.min(0.9, g * 4);
            R[k] = R[k] * keep + g; G[k] = G[k] * keep + g * 0.62; B[k] = B[k] * keep + g * 0.26;
          }
        }
      }
      for (let j = 0; j < BOX[3]; j++) {
        for (let i = 0; i < BOX[2]; i++) {
          const m = shape[j * BOX[2] + i]; if (!m) continue;
          const x = BOX[0] + i, r = BOX[1] + j; if (x < 0 || x >= W || r >= H) continue;
          const k = r * W + x;
          let g = m === 2 && (i === 0 || i === BOX[2] - 1 || !shape[j * BOX[2] + i - 1] || !shape[j * BOX[2] + i + 1]) ? 0.16 : 0;
          const top = j === 0 || !shape[(j - 1) * BOX[2] + i];
          for (const [lx, ly, lq] of lights) {
            if (lq < 0.003) continue;
            const dx = lx - (x + 0.5), dy = ly - (r + 0.5), d = Math.sqrt(dx * dx + dy * dy) || 1;
            if (m === 2) {
              const ni = i + Math.round(dx / d), nj = j + Math.round(dy / d);
              const open = ni < 0 || nj < 0 || ni >= BOX[2] || nj >= BOX[3] || !shape[nj * BOX[2] + ni];
              g += lq * (open ? 0.95 : 0.05) * Math.exp(-d / (6 * SC));
            } else g += lq * (top ? 0.6 * Math.exp(-Math.abs(dx) / (11 * SC)) : 0.02);
          }
          R[k] = 0.01 + g; G[k] = 0.008 + g * 0.55; B[k] = 0.014 + g * 0.22; FL[k] = 0;
        }
      }
      lantern(BOWX, BOWY, 2, lamp, 1, H, null);
      for (const [x, y, q] of flights) lantern(x, y, HELD, q, 1, H, null);
      if (ha > 0) lantern(FX, hy, hs, ha * mine, Math.min(1, ha * 1.4), H, null);

      for (const c of close) {
        const u = t / c.life + c.off, lap = Math.floor(u), a = (u - lap) * c.life;
        if (lap < 0 || a * c.v > c.path) continue;
        let x0 = c.x;
        if (lap) {
          x0 = 6 + 188 * hash(c.i * 17 + lap, 44);
          if (x0 > 84 && x0 < 132) x0 = x0 < 108 ? x0 - 32 : x0 + 32;
        }
        const cx = x0 + c.wd * a + c.sw * (Math.sin(a * c.sf + c.ph) - Math.sin(c.ph)), cy = H + 2.5 * c.s - c.v * a;
        const I = 1.15 + 0.05 * Math.sin(t * 3.3 + c.ph) + 0.03 * Math.sin(t * 8.1 + c.i);
        halo(cx, cy, c.s, 0.1 * I, H);
        lantern(cx, cy, c.s, I, 1, H, null);
      }

      for (let r = 0; r < H; r++) {
        for (let x = 0; x < W; x++) {
          const k = r * W + x, cr = R[k], cg = G[k], cb = B[k], floor = FL[k], peak = Math.max(cr, cg, cb, 1e-4);
          const level = clamp01(floor + (1 - floor) * Math.pow(peak, 0.85) * 0.95);
          const step = Math.max(0, Math.min(3, Math.round(level * 3 + BAYER[(r & 3) * 4 + (x & 3)])));
          outStep[k] = step;
          if (step) {
            if (k < S && far[k] && FL[k] < 0.05 && cb >= cr) {
              outColor[k] = SL + (level > 0.42 ? 2 : level > 0.3 ? 1 : 0);
              continue;
            }
            const want = Math.min(1, (level + 0.06) / COVER[step]);
            const s = (0.3 + 0.7 * want) / peak;
            outColor[k] = nearest(clamp01(cr * s), clamp01(cg * s), clamp01(cb * s));
          }
        }
      }
      for (const [k, ph, rate, b] of stars) {
        const s = b * (0.7 + 0.3 * Math.sin(t * rate + ph));
        if (s < 0.3 || Math.max(R[k], G[k], B[k]) > 0.4) continue;
        outStep[k] = s > 0.95 ? 3 : s > 0.45 ? 2 : 1;
        outColor[k] = STAR + (s > 0.8 ? 2 : s > 0.55 ? 1 : 0);
      }
      renderHalftoneGrid(outStep, outColor, sprites, GROUND);
    }

    return { onResize, drawFrame, fps: 15 };
  }

  // =========================================================================
  // 4. AURORA FJORD SCENE
  // =========================================================================
  function createAuroraFjordScene() {
    const GROUND = "#05080f";
    const PALETTE = [
      "#0b1322", "#101b30", "#16243f", "#1e3050", "#2a3f63",
      "#0e3a33", "#11573f", "#167a4c", "#22a05c", "#3ccb73", "#7cf0a0", "#c8ffdc",
      "#0f5f5c", "#16877f", "#2cb5a6", "#7fe6d6",
      "#2a1f52", "#432b78", "#6a3c9f", "#9558c6", "#c48ae4", "#363a72", "#4f5596", "#1b4f63",
      "#1a2236", "#283350", "#3b4a6e", "#566a92", "#7d91b8", "#a9bad9", "#d6e0f2", "#9fc9cf",
      "#0f1a1c", "#173128", "#24493a",
      "#4a1517", "#7c2420", "#b23a2a", "#d65aa8",
      "#ffd27c", "#ffb04a", "#fff2c4",
      "#eef3ff"
    ];
    const { nearest } = makePaletteMatcher(PALETTE);
    let sprites = [];
    function onResize() {
      const cell = Math.max(width / W, height / H);
      sprites = buildSpritesForPalette(PALETTE, cell);
    }

    const WL = 62;
    const AIR = 0, NEAR = 1, FAR = 2, SHORE = 3, WALL = 4, ROOF = 5, PANE = 6, TREE = 7, DOOR = 8;
    const CAB = [142, 161];
    const PANES = [[145, 148], [156, 159]];
    const DOOR_X = [150, 152];
    const LAMPS = [[147, 1], [158, 0.8]];

    const LEFT = [[25, 38, 1.3], [6, 29, 0.9], [50, 25, 1.0], [72, 13, 0.6]];
    const RIGHT = [[172, 30, 1.15], [194, 24, 0.85], [151, 16, 1.0], [212, 22, 0.6]];
    const DISTANT = [[100, 10, 0.5], [119, 12, 0.55], [86, 7, 0.45], [134, 8, 0.5]];

    function range(x, peaks, seed, rough) {
      let m = -99, px = 0;
      for (const [cx, h, s] of peaks) {
        const v = h - Math.abs(x - cx) * s;
        if (v > m) { m = v; px = cx; }
      }
      const j = rough * (fbm(x * 0.09, seed, 3) - 0.5) + rough * 0.45 * (noise(x * 0.45, seed + 5) - 0.5);
      return [m + j * Math.min(1, Math.max(0, m) / 6), px];
    }

    const mat = new Uint8Array(N);
    const sr = new Float32Array(N), sg = new Float32Array(N), sb = new Float32Array(N);
    const rec = new Float32Array(N);
    const rim = new Float32Array(N);
    const nearTop = new Float32Array(W), farTop = new Float32Array(W), peakX = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const [hl, pl] = range(x + 0.5, LEFT, 3.1, 4);
      const [hr, pr] = range(x + 0.5, RIGHT, 7.7, 4);
      const [hd] = range(x + 0.5, DISTANT, 11.3, 2.2);
      nearTop[x] = WL - Math.max(hl, hr, 0);
      peakX[x] = hl > hr ? pl : pr;
      farTop[x] = WL - Math.max(hd, 0);
    }
    const shoreTop = (x) => WL - 2.2 * smooth(134, 140, x) * smooth(178, 168, x) - 0.6 * noise(x * 0.3, 2);
    const cabBase = WL - 2.2;

    for (let r = 0; r < WL; r++) {
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        const y = r + 0.5;
        if (y >= nearTop[x]) {
          mat[k] = NEAR;
          const px = peakX[x];
          const side = x + 0.5 - px;
          const depth = y - nearTop[x];
          const heightVal = WL - nearTop[x];
          const ridge = px + (depth + 1) * 0.6 * (noise(y * 0.1, px) - 0.5);
          const inward = px < 100 ? 1 : -1;
          const face = smooth(-4, 4, (x + 0.5 - ridge) * inward);
          const u = x + depth * 0.45 * Math.sign(side || 1);
          const rib = (v) => fbm(v * 0.13, px * 0.37, 3);
          const grad = (rib(u + 1) - rib(u - 1)) * 7 * inward;
          const reach = 3 + heightVal * (0.62 + 0.42 * rib(u + 40));
          const streak = smooth(0.56, 0.64, fbm(u * 0.32, y * 0.035 + px, 3)) * smooth(1, 5, depth);
          const cx = x + 0.5 - 152;
          const wood = WL - 18.5 + 9 * (cx / 19) ** 2 + 1.5 * (noise(x * 0.7, 9) - 0.5) - 2.6 * hash(x, 77) * ((x & 1) ? 1 : 0.3);
          const snow = smooth(reach + 1.6, reach - 1.6, depth) * (1 - smooth(WL - 3, WL - 0.5, y)) * (1 - 0.5 * streak);
          const lit = clamp01(0.35 + 0.55 * face + grad * 0.5);
          const rv = 0.75 + 0.5 * fbm(x * 0.4, y * 0.4, 2);
          const rr = (0.05 + 0.03 * lit) * rv, rg = (0.065 + 0.035 * lit) * rv, rb = (0.11 + 0.05 * lit) * rv;
          const s = 0.34 + 0.66 * Math.pow(lit, 1.5);
          sr[k] = mix(rr, 0.62 * s + 0.04, snow);
          sg[k] = mix(rg, 0.7 * s + 0.05, snow);
          sb[k] = mix(rb, 0.86 * s + 0.09, snow);
          rec[k] = snow * (0.25 + 0.75 * lit) + 0.06;
          rim[k] = smooth(2.2, 0.3, depth) * 0.5;
          if (y > wood && cx > -14 - 2 * hash(r, 3) && cx < 13 + 2 * hash(r, 4)) {
            mat[k] = TREE;
            const h = hash(x * 13 + r, 5);
            sr[k] = 0.02 + 0.03 * h; sg[k] = 0.045 + 0.045 * h; sb[k] = 0.06 + 0.04 * h;
            rec[k] = 0.05;
            rim[k] = smooth(wood + 1.6, wood + 0.2, y) * (0.7 + 0.3 * h);
          }
        } else if (y >= farTop[x]) {
          mat[k] = FAR;
          const depth = y - farTop[x];
          const snow = smooth(0.5, 0.62, fbm(x * 0.18, y * 0.25, 3) * 0.6 + (1 - depth / 7) * 0.55);
          const lit = 0.5 + 0.3 * (noise(x * 0.25, y * 0.1) - 0.5);
          sr[k] = mix(0.075, 0.22 * lit + 0.12, snow);
          sg[k] = mix(0.1, 0.27 * lit + 0.15, snow);
          sb[k] = mix(0.17, 0.36 * lit + 0.24, snow);
          rec[k] = 0.2 + 0.3 * snow;
        }
        if (x > 132 && x < 180 && y >= shoreTop(x)) {
          mat[k] = SHORE;
          const f = 0.6 + 0.3 * fbm(x * 0.3, y * 0.5, 2);
          sr[k] = 0.26 * f; sg[k] = 0.3 * f; sb[k] = 0.42 * f;
          rec[k] = 0.4;
          rim[k] = 0;
        }
      }
    }

    const spruce = (tx, th, tw, tb, guard) => {
      for (let r = Math.max(0, Math.floor(tb - th)); r < WL; r++) {
        const y = r + 0.5, dy = y - (tb - th);
        if (dy < 0 || y >= tb + 0.5) continue;
        const tier = (dy + th * 0.3) / 1.8;
        const w = (dy / th) * tw * (0.7 + 0.45 * (tier - Math.floor(tier))) + 0.35;
        for (let x = Math.max(0, Math.floor(tx - tw - 1)); x <= Math.min(W - 1, tx + tw + 1); x++) {
          const k = r * W + x;
          const ex = x + 0.5 - tx;
          if (Math.abs(ex) > w || (guard && guard(k))) continue;
          mat[k] = TREE;
          const h = hash(x * 13 + r, 5);
          const s = ex < 0 ? 0.7 : 0.3;
          sr[k] = 0.02 + 0.03 * s * h; sg[k] = 0.04 + 0.05 * s; sb[k] = 0.055 + 0.045 * s;
          rec[k] = 0.05;
          rim[k] = Math.max(smooth(1.6, 0.2, dy), ex < 0 && ex < -w + 1 ? 0.45 * smooth(th, 0, dy) : 0);
        }
      }
    };
    const solid = (k) => mat[k] === WALL || mat[k] === ROOF || mat[k] === PANE || mat[k] === DOOR || mat[k] === SHORE;
    for (let x = -1; x < W + 2;) {
      const h = hash(Math.floor(x * 7), 21);
      const open = smooth(96, 80, x) + smooth(122, 136, x);
      const onShelf = x > 132 && x < 180;
      if (open > 0.05 && !(x > 136 && x < 166)) {
        const th = (3.2 + hash(Math.floor(x * 3), 5) * 3 + (hash(Math.floor(x * 5), 8) > 0.7 ? 2.4 : 0)) * Math.min(1, open) * (onShelf ? 0.7 : 1);
        if (th > 1.5) spruce(x + hash(Math.floor(x), 2), th, 1 + hash(Math.floor(x), 4) * 0.6, onShelf ? shoreTop(x) - 0.4 : WL + 0.3, onShelf ? solid : null);
      }
      x += 2 + 2.2 * h;
    }

    const eave = cabBase - 7;
    const roofTop = eave - 8;
    const CHIM = CAB[1] - 5, CHIM_TOP = eave - 8.5;
    for (let r = 0; r < WL; r++) {
      for (let x = CAB[0] - 3; x <= CAB[1] + 3; x++) {
        const k = r * W + x;
        const y = r + 0.5;
        const cx = (CAB[0] + CAB[1] + 1) / 2;
        if (x >= CAB[0] && x <= CAB[1] && y >= eave && y < cabBase + 0.5) {
          mat[k] = WALL;
          const boards = r & 1 ? 0.82 : 1;
          const s = (0.5 + 0.5 * ((CAB[1] - x) / (CAB[1] - CAB[0]))) * boards;
          sr[k] = 0.7 * s; sg[k] = 0.14 * s; sb[k] = 0.11 * s;
          rim[k] = 0;
          for (const [a, b] of PANES) if (x >= a && x <= b && y >= eave + 1.5 && y < cabBase - 2) mat[k] = PANE;
          if (x >= DOOR_X[0] && x <= DOOR_X[1] && y >= eave + 1.5) {
            mat[k] = DOOR;
            sr[k] = 0.16; sg[k] = 0.06; sb[k] = 0.05;
          }
        }
        const half = 12.5 - (eave - y) * 1.45;
        if (y >= roofTop && y < eave && Math.abs(x + 0.5 - cx) <= half) {
          mat[k] = ROOF;
          const snowy = y < eave - 1;
          const s = 0.78 + 0.22 * ((cx - x - 0.5) / 12);
          if (snowy) { sr[k] = 0.78 * s; sg[k] = 0.84 * s; sb[k] = 0.96 * s; }
          else { sr[k] = 0.12; sg[k] = 0.05; sb[k] = 0.06; }
          rec[k] = snowy ? 0.5 : 0;
          rim[k] = 0;
        }
        if (x >= CHIM && x <= CHIM + 1 && y >= CHIM_TOP && y < eave - 4) {
          mat[k] = WALL;
          const s = x === CHIM ? 1 : 0.55;
          sr[k] = 0.2 * s; sg[k] = 0.21 * s; sb[k] = 0.27 * s;
          rim[k] = 0;
        }
      }
    }

    for (const [tx, th] of [[134, 7], [137.8, 10], [166.5, 9], [170, 6], [174.5, 8]]) {
      spruce(tx, th, 2.2, shoreTop(tx) + 0.5, (k) => mat[k] === WALL || mat[k] === ROOF || mat[k] === PANE || mat[k] === DOOR);
    }

    const lampLand = new Float32Array(WL * W);
    for (let r = 0; r < WL; r++) {
      for (let x = 0; x < W; x++) {
        const k = r * W + x, m = mat[k];
        if (m === PANE || m === WALL || m === ROOF || m === DOOR) continue;
        let g = 0;
        for (const [lx, s] of LAMPS) {
          const wx = x + 0.5 - lx, wy = r + 0.5 - (cabBase - 2.5);
          const d = Math.sqrt(wx * wx * 0.6 + wy * wy * 2.2);
          g += s * Math.exp(-d / 5.5) * 0.6;
        }
        lampLand[k] = g * (m === AIR ? 0.3 : m === TREE ? 0.4 : 0.75 + 0.5 * hash(x, r + 31));
      }
    }

    const haze = new Float32Array(WL * W);
    for (let k = 0; k < WL * W; k++) haze[k] = fbm((k % W) * 0.04, Math.floor(k / W) * 0.07, 3);
    const star = new Float32Array(WL * W);
    for (let k = 0; k < WL * W; k++) {
      const h = hash(k % W, Math.floor(k / W) + 101);
      if (h > 0.986) star[k] = 0.35 + (h - 0.986) * 45;
    }
    const gap = new Uint8Array(H);
    for (let r = WL; r < H; r++) gap[r] = hash(r, 404) < 0.3 ? 1 : 0;

    const baseA = new Float32Array(W), tallA = new Float32Array(W), envA = new Float32Array(W);
    const baseB = new Float32Array(W), envB = new Float32Array(W);
    const RAYS = 4 * W;
    const raysA = new Float32Array(RAYS + 2), raysB = new Float32Array(RAYS + 2);
    const R = new Float32Array(WL * W), G = new Float32Array(WL * W), B = new Float32Array(WL * W);
    const lightX = new Float32Array(W);
    const outStep = new Uint8Array(N), outColor = new Uint8Array(N);

    const ray = (arr, u) => {
      const s = u * 4;
      let i = Math.floor(s);
      const f = s - i;
      i = ((i % RAYS) + RAYS) % RAYS;
      return arr[i] + (arr[i + 1] - arr[i]) * f;
    };

    function drawFrame(_dt, t) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        baseA[x] = 5 + 40 * Math.pow(Math.sin(Math.min(1, u / 0.6) * Math.PI / 2), 1.5) - 13 * smooth(0.6, 0.95, u)
          + 2.6 * Math.sin(x * 0.07 - t * 0.55) + 1.4 * Math.sin(x * 0.17 + t * 0.9 + 1.3) + 2.2 * Math.sin(x * 0.22 + t * 1.2)
          + 4 * (fbm(x * 0.015 + t * 0.03, 4.2, 2) - 0.5);
        tallA[x] = 11 + 8 * fbm(x * 0.03 - t * 0.05, 1.7, 2);
        envA[x] = smooth(0.0, 0.2, u) * smooth(0.98, 0.72, u) * (0.4 + 0.8 * fbm(x * 0.022 - t * 0.07, 8.8, 3));
        baseB[x] = 14 + 4 * Math.sin(x * 0.035 + t * 0.3 + 2) + 1.6 * Math.sin(x * 0.11 - t * 0.7);
        envB[x] = smooth(0.45, 0.7, u) * smooth(1.05, 0.85, u) * (0.25 + 0.5 * fbm(x * 0.03 + t * 0.05, 3.3, 2));
      }
      for (let i = 0; i <= RAYS + 1; i++) {
        const u = i / 4;
        raysA[i] = 0.14 + Math.pow(fbm(u * 0.6 + t * 0.35, t * 0.12, 3), 2.4) * 2.5;
        raysB[i] = 0.1 + Math.pow(fbm(u * 0.45 - t * 0.2, 5 + t * 0.1, 3), 2.2) * 2.0;
      }
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let d = -24; d <= 24; d += 6) {
          const xx = Math.min(W - 1, Math.max(0, x + d));
          s += envA[xx] + 0.4 * envB[xx];
        }
        lightX[x] = s / 9;
      }
      const flick = 0.92 + 0.05 * Math.sin(t * 2.3) + 0.03 * Math.sin(t * 7.1);

      for (let r = 0; r < WL; r++) {
        const y = r + 0.5;
        const v = y / WL;
        for (let x = 0; x < W; x++) {
          const k = r * W + x;
          const m = mat[k];
          let cr, cg, cb;
          if (m === AIR) {
            const hz = 0.85 + 0.3 * haze[k];
            cr = (0.025 + 0.03 * v * v) * hz;
            cg = (0.04 + 0.07 * v * v) * hz;
            cb = (0.1 + 0.11 * v * v) * hz;
            let a = 0;
            const d = baseA[x] - y;
            if (d > -4 && d < 46) {
              const bend = Math.abs(baseA[Math.min(W - 1, x + 1)] - baseA[Math.max(0, x - 1)]);
              const hc = tallA[x];
              const lean = ray(raysA, x + d * 0.22);
              const prof = d < 0 ? Math.exp(-d * d * 0.9) : (1 - Math.exp(-(d + 0.4) * 1.1)) * Math.exp(-d / hc);
              const band = d < 0 ? Math.exp(-d * d) : Math.exp(-d / 3);
              a = (prof * lean + 0.3 * band * (0.55 + 0.45 * Math.min(1.4, lean))) * envA[x] * (1.15 + 0.35 * bend);
              const up = clamp01(d / (hc * 1.6));
              const gk = 1 - smooth(0, 0.5, up), vk = smooth(0.4, 0.9, up);
              const tk = 1 - gk - vk;
              cr += a * (0.18 * gk + 0.06 * tk + 0.42 * vk);
              cg += a * (1.0 * gk + 0.78 * tk + 0.16 * vk);
              cb += a * (0.48 * gk + 0.7 * tk + 0.75 * vk);
              const hem = Math.exp(-((d + 0.6) ** 2) * 1.2) * smooth(0.3, 0.8, a) * 0.8 * (0.45 + 0.55 * Math.min(1, lean));
              cr += hem * 0.95; cg *= 1 - 0.55 * Math.min(1, hem * 1.6); cb += hem * 0.4;
            }
            const db = baseB[x] - y;
            if (db > -3 && db < 30) {
              const prof = db < 0 ? Math.exp(-db * db) : (1 - Math.exp(-(db + 0.4))) * Math.exp(-db / 9);
              const b = prof * ray(raysB, x + db * 0.18) * envB[x] * 0.85 * smooth(0, 8, y);
              const up = clamp01(db / 12);
              cr += b * (0.1 + 0.4 * up);
              cg += b * (0.75 - 0.5 * up);
              cb += b * (0.7 + 0.2 * up);
              a += b;
            }
            const below = y - baseA[x];
            const gl = envA[x] * (below > 0 ? Math.exp(-below / 6) * 0.1 : Math.exp(below / 8) * 0.18);
            cr += gl * 0.12; cg += gl * 0.62; cb += gl * 0.52;
            const ag = Math.exp(-(WL - y) / 10) * (0.1 + 0.16 * lightX[x]);
            cg += ag * 0.7; cb += ag * 0.75; cr += ag * 0.2;
            const st = star[k];
            if (st > 0) {
              const tw = 0.7 + 0.3 * Math.sin(t * (1.3 + 3 * hash(x, r)) + 6.28 * hash(r, x));
              const s = st * tw * clamp01(1 - a * 1.6) * smooth(WL - 2, 30, y);
              cr = Math.max(cr, s * 0.9); cg = Math.max(cg, s * 0.94); cb = Math.max(cb, s);
            }
          } else {
            cr = sr[k]; cg = sg[k]; cb = sb[k];
            const L = lightX[x] * rec[k];
            cr += L * 0.03; cg += L * 0.14; cb += L * 0.1;
            const e = rim[k];
            if (e > 0) {
              const q = e * (m === TREE ? 0.2 + 0.45 * lightX[x] : 0.05 + 0.22 * lightX[x]);
              cr += q * 0.25; cg += q * 0.95; cb += q * 0.7;
            }
            if (m === PANE) {
              const f = flick + 0.04 * Math.sin(t * 5.3 + x);
              cr = f; cg = 0.76 * f; cb = 0.38 * f;
            } else if (m === DOOR) {
              if (x === DOOR_X[1] && r > eave + 1) { cr = 0.55 * flick; cg = 0.36 * flick; cb = 0.14 * flick; }
            }
          }
          const lg = lampLand[k] * flick;
          if (lg > 0) { cr += lg; cg += lg * 0.62; cb += lg * 0.26; }
          R[k] = cr; G[k] = cg; B[k] = cb;
        }
      }

      for (let r = 0; r < H; r++) {
        const y = r + 0.5;
        let floor = 0.1, fade = 1;
        const dw = y - WL;
        const deep = r >= WL ? mix(1, 0.45, dw / (H - WL)) : 1;
        const ry = WL - 1 - (r - WL) - Math.round(0.4 * Math.sin(r * 0.9 + t * 0.6));
        const r0 = Math.max(0, ry) * W, r1 = Math.max(0, ry - 1) * W, r2 = Math.max(0, ry - 2) * W;
        for (let x = 0; x < W; x++) {
          const k = r * W + x;
          let cr, cg, cb;
          if (r < WL) {
            cr = R[k]; cg = G[k]; cb = B[k];
            const m = mat[k];
            floor = m === AIR ? 0.1 : m === NEAR ? 0.05 : m === TREE ? 0.04 : 0.06;
          } else {
            const wave = noise(x * 0.04 + t * 0.05, r * 0.55 - t * 0.35);
            const sx = x + (0.5 + dw * 0.12) * Math.sin(r * 1.3 + t * 1.6 + wave * 4);
            let ix = Math.floor(sx);
            const fx = sx - ix;
            ix = Math.max(0, Math.min(W - 2, ix));
            const a0 = r0 + ix, a1 = r1 + ix, a2 = r2 + ix;
            const sky = mat[a0] === AIR;
            let kr = (sky ? 0.55 : 0.64) * (0.82 + 0.3 * wave) * deep;
            if (sky && gap[r] && wave < 0.45) kr *= 0.12;
            const ms = mat[a0];
            if (ms === PANE) kr *= 0.4;
            else if (ms === WALL || ms === ROOF || ms === DOOR) kr *= 0.7;
            const gx = 1 - fx;
            cr = ((R[a0] * gx + R[a0 + 1] * fx) * 0.5 + (R[a1] * gx + R[a1 + 1] * fx) * 0.3 + (R[a2] * gx + R[a2 + 1] * fx) * 0.2) * kr;
            cg = ((G[a0] * gx + G[a0 + 1] * fx) * 0.5 + (G[a1] * gx + G[a1 + 1] * fx) * 0.3 + (G[a2] * gx + G[a2 + 1] * fx) * 0.2) * kr;
            cb = ((B[a0] * gx + B[a0 + 1] * fx) * 0.5 + (B[a1] * gx + B[a1 + 1] * fx) * 0.3 + (B[a2] * gx + B[a2 + 1] * fx) * 0.2) * kr;
            if (ms !== WALL && ms !== DOOR) { cr += 0.02; cg += 0.035; cb += 0.065; }
            if (r === WL) {
              const e = 0.3 * (0.3 + 0.7 * smooth(0.25, 0.75, noise(x * 0.3, t * 0.4)));
              cr += e * 0.6; cg += e * 0.85; cb += e;
            }
            if (dw < 14 && x > 138 && x < 166) {
              const rip = noise(x * 0.5 - t * 0.2, r * 1.4 - t * 1.5);
              for (const [lx, s] of LAMPS) {
                const lw = 1 + dw * 0.1;
                const q = (x + 0.5 - lx) / lw;
                const g = Math.exp(-q * q) * Math.exp(-dw / 8) * smooth(0.3, 0.65, rip) * s * 1.6 * flick;
                cr += g; cg += g * 0.68; cb += g * 0.28;
              }
            }
            floor = sky ? 0.07 * deep : 0.03;
            fade = smooth(H + 3, H - 12, y);
          }
          const peak = Math.max(cr, cg, cb, 1e-4);
          const level = clamp01(floor + (1 - floor) * Math.pow(peak, 0.85) * 0.95) * fade;
          const step = Math.max(0, Math.min(3, Math.round(level * 3 + BAYER[(r & 3) * 4 + (x & 3)])));
          outStep[k] = step;
          if (step) {
            const want = Math.min(1, (level + 0.06) / COVER[step]);
            const s = (0.3 + 0.7 * want) / peak;
            outColor[k] = nearest(clamp01(cr * s), clamp01(cg * s), clamp01(cb * s));
          }
        }
      }
      renderHalftoneGrid(outStep, outColor, sprites, GROUND);
    }

    return { onResize, drawFrame, fps: 15 };
  }

  // =========================================================================
  // 5. KYOTO DUSK SCENE
  // =========================================================================
  function createKyotoDuskScene() {
    const GROUND = "#0b0a16";
    const PALETTE = [
      "#1c1d4a", "#262759", "#33316b", "#433d7c", "#574a8c", "#6e5a9a",
      "#8a5a92", "#a8668f", "#c4748f", "#db8a95", "#ec9f9c", "#f6b8a8", "#fbd0b8",
      "#fff1d8", "#fffaf0", "#7e5f9e",
      "#f9d3dc", "#f2b2c4", "#e28fab", "#c66e92", "#9c5279", "#74405f",
      "#ffd9a0", "#ffbb6a", "#f29a4a", "#d0763a", "#a35a35",
      "#2a2240", "#3a2c50", "#4a3860",
      "#5b4f86", "#7a6aa0",
      "#2c3a3a", "#3d4c46", "#56604f",
      "#9a6aa0", "#b47ea6",
      "#4a3038", "#6a4448",
      "#2b3a6a", "#3e4f86"
    ];
    const SHORE = 80, PX = 141, MOON = [176, 17], LX = 53, LB = 98, LS = 1.8, LAMP = [LX, LB - (LB - 83) * LS];
    const SKY = 0, HILL = 1, TOWN = 2, PAGODA = 3, POND = 4, BANK = 5, TREE = 6, BLOOM = 7, STONE = 8, FLAME = 9;
    const { nearest } = makePaletteMatcher(PALETTE);
    const outStep = new Uint8Array(N), outColor = new Uint8Array(N);

    const EAVE = [68.5, 58, 48.5, 40, 32.5], ROOF = [14.5, 13.4, 12.3, 11.2, 10.1], BODY = [6.4, 5.9, 5.4, 4.9, 4.4];
    function pagoda(dx, y) {
      const ax = Math.abs(dx);
      if (y >= 76 && y < SHORE + 0.5) return ax <= 9.5 - (y < 77 ? 1 : 0) ? 1 : 0;
      for (let i = 0; i < 5; i++) {
        const e = EAVE[i], R = ROOF[i], u = ax / R;
        if (u <= 1) {
          const lift = 3.5 * u * u * u * u, bottom = e - lift + 0.6, top = e - lift - 1.2 - 3.6 * Math.pow(1 - u, 1.7);
          if (y >= top && y < bottom) return y < top + 0.9 ? 4 : y > bottom - 1.0 ? 3 : 2;
        }
        const floor = i === 0 ? 76 : EAVE[i - 1] - 3.6;
        if (y >= e + 0.6 && y < floor && ax <= BODY[i]) {
          if (i === 0 && ax <= 1 && y > 72 && y < 75.5) return 6;
          if (y < e + 2 && ax <= BODY[i] + 1.2) return 3;
          return 1;
        }
        if (i > 0 && y >= e + 0.6 && y < e + 2 && ax <= BODY[i] + 1.2) return 3;
      }
      const top = EAVE[4] - 1.2 - 3.6 - 0.2;
      if (y < top && y >= 9) {
        if (y >= top - 1.5) return ax <= 2.4 ? 3 : 0;
        if (y >= 15 && y < top - 1.5) return ax <= (Math.floor((y - 15) / 1.2) & 1 ? 1.4 : 0.55) ? 5 : 0;
        if (y >= 12) return ax <= 1.3 - (y - 12) * 0.2 ? 5 : 0;
        return ax <= 0.6 ? 5 : 0;
      }
      return 0;
    }

    const mat = new Uint8Array(N), R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
    const floorA = new Float32Array(N).fill(0.12), warmth = new Float32Array(N);

    const skyAt = (x, y) => {
      const v = clamp01(y / SHORE), west = Math.exp(-Math.abs(x - 80) / 120);
      let a = smooth(0, 0.5, v), r = mix(0.07, 0.22, a), g = mix(0.07, 0.14, a), b = mix(0.25, 0.38, a);
      a = smooth(0.42, 0.86, v); r = mix(r, 0.52, a); g = mix(g, 0.32, a); b = mix(b, 0.58, a);
      a = smooth(0.78, 0.98, v) * (0.55 + 0.45 * west); r = mix(r, 1.0, a); g = mix(g, 0.62, a); b = mix(b, 0.48, a);
      const band = Math.exp(-Math.abs(y - 74) / 4) * west * 0.18; r += band; g += band * 0.66; b += band * 0.45;
      const veil = 0.86 + 0.28 * fbm(x * 0.035, y * 0.09, 3, 0); r *= veil; g *= veil; b *= veil;
      const dx = x - MOON[0], dy = y - MOON[1], d = Math.sqrt(dx * dx + dy * dy), halo = Math.exp(-d / 5) * 0.24 + Math.exp(-d / 16) * 0.07;
      return [r + halo * 0.75, g + halo * 0.72, b + halo];
    };

    const hillA = (x) => 77.5 - (3 + 13 * smooth(70, 175, x)) * (0.3 + 1.1 * fbm(x * 0.022 + 3, 1, 4, 0));
    const hillB = (x) => 77 - 2.5 * fbm(x * 0.04 + 9, 2, 4, 0);
    const town = (x) => {
      const i = Math.floor((x + 3) / 11), f = (x + 3) / 11 - i, h = 2 + hash(i, 5) * 2.5, e = Math.abs(f - 0.5) * 2;
      return e > 0.86 ? SHORE : SHORE - 1 - h + Math.max(0, e - 0.35) * 6;
    };

    const branches = [
      [16, 101, 20, 86, 5.2, 4.4], [20, 86, 27, 70, 4.4, 3.6], [27, 70, 31, 58, 3.6, 3],
      [31, 58, 50, 46, 3, 2.1], [50, 46, 74, 37, 2.1, 1.4], [74, 37, 98, 31, 1.4, 0.9], [98, 31, 116, 30, 0.9, 0.5],
      [31, 58, 24, 40, 2.6, 1.8], [24, 40, 12, 26, 1.8, 1.1], [12, 26, 0, 18, 1.1, 0.7],
      [29, 50, 42, 30, 2, 1.3], [42, 30, 52, 19, 1.3, 0.8], [52, 19, 70, 13, 0.8, 0.5],
      [50, 46, 60, 52, 1.2, 0.7], [74, 37, 86, 44, 1, 0.5], [42, 30, 66, 24, 1, 0.6], [66, 24, 90, 21, 0.6, 0.4],
      [24, 40, 34, 25, 1, 0.6], [12, 26, 6, 16, 0.7, 0.4], [98, 31, 104, 40, 0.6, 0.35],
      [40, 51, 44, 58, 1.1, 0.4], [58, 43, 62, 55, 0.9, 0.35], [70, 38, 76, 47, 0.7, 0.3]
    ];
    const limbs = branches.length;
    for (let b = 3; b < limbs; b++) {
      const [ax, ay, bx, by, w0, w1] = branches[b], ang = Math.atan2(by - ay, bx - ax);
      for (let j = 0; j < 3; j++) {
        const k = 0.25 + 0.65 * hash(b * 7 + j, 31), sx = mix(ax, bx, k), sy = mix(ay, by, k);
        const turn = (j & 1 ? 1 : -1) * (0.5 + 0.6 * hash(b, j + 40)), len = 4 + 7 * hash(b + j, 41), a2 = ang + turn - 0.25;
        branches.push([sx, sy, sx + Math.cos(a2) * len, sy + Math.sin(a2) * len, mix(w0, w1, k) * 0.55, 0.3]);
      }
    }
    const clusters = [];
    for (let b = 3; b < branches.length; b++) {
      const [ax, ay, bx, by, w0] = branches[b], len = Math.hypot(bx - ax, by - ay), n = 1 + Math.round(len / 1.7);
      for (let i = 0; i <= n; i++) {
        const k = i / n; if (k < 0.3 && w0 > 2) continue;
        const h1 = hash(b * 13 + i, 7), h2 = hash(b * 5 + i, 11), h3 = hash(b * 3 + i, 17);
        const cx = mix(ax, bx, k) + (h1 - 0.5) * 6, cy = mix(ay, by, k) + (h2 - 0.5) * 4.5 - 1;
        const spray = (b >= limbs - 3 && b < limbs) || b >= limbs + 3 * (limbs - 6);
        const dome = 9 + 10 * Math.pow(clamp01(Math.abs(cx - 52) / 70), 1.6);
        if (cx > 122 || cy < dome || cy > (spray ? 55 : 47)) continue;
        clusters.push([cx, cy, 1.4 + 1.6 * h3 + 0.8 * k]);
      }
    }
    const bankX = (y) => 38 + (y - SHORE) * 2.3 + 4 * fbm(y * 0.2, 4, 2, 0);

    for (let r = 0; r < H; r++) {
      for (let x = 0; x < W; x++) {
        const k = r * W + x, y = r + 0.5, xc = x + 0.5;
        let m = SKY, cr = 0, cg = 0, cb = 0, fl = 0.12, warm = 0;
        if (y < SHORE) {
          [cr, cg, cb] = skyAt(xc, y); fl = 0.04;
          if (y >= hillA(xc)) {
            m = HILL;
            const s = skyAt(xc, hillA(xc)), d = smooth(hillA(xc), hillA(xc) + 8, y), tex = fbm(xc * 0.3, y * 0.45, 3, 0);
            const a = 0.6 + 0.2 * d + 0.25 * (tex - 0.5), lip = smooth(hillA(xc) + 1.4, hillA(xc), y) * 0.3;
            cr = mix(mix(s[0], 0.14, a), s[0] * 1.1, lip); cg = mix(mix(s[1], 0.08, a), s[1] * 1.05, lip); cb = mix(mix(s[2], 0.24, a), s[2], lip);
          }
          if (y >= hillB(xc)) {
            m = HILL;
            const tex = fbm(xc * 0.3, y * 0.3, 3, 0), mist = smooth(hillB(xc) + 1, SHORE, y) * 0.5;
            cr = mix(0.1 + 0.05 * tex, 0.7, mist); cg = mix(0.07 + 0.03 * tex, 0.44, mist); cb = mix(0.17 + 0.05 * tex, 0.58, mist);
          }
          if (y >= town(xc) && xc > 70) {
            m = TOWN; cr = 0.08; cg = 0.06; cb = 0.14;
            const tf = Math.abs(((xc + 3) / 11) % 1 - 0.5) * 2;
            if (y < town(xc) + 0.9 && tf < 0.45) { cr = 0.5; cg = 0.31; cb = 0.44; fl = 0.06; }
            const wi = Math.floor(xc / 4);
            if (y > SHORE - 1.6 && y < SHORE - 0.5 && (xc % 4) < 1.2 && hash(wi, 7) > 0.74) { cr = 1; cg = 0.66; cb = 0.32; fl = 0.3; }
          }
          const p = pagoda(xc - PX, y);
          if (p) {
            m = PAGODA;
            const dx = xc - PX, rim = Math.exp(-Math.abs(dx + 4) / 30);
            if (p === 1) { cr = 0.07; cg = 0.05; cb = 0.12; }
            else if (p === 2) { cr = 0.2 + 0.08 * rim; cg = 0.13 + 0.03 * rim; cb = 0.27 + 0.04 * rim; }
            else if (p === 3) { cr = 0.05; cg = 0.04; cb = 0.1; }
            else if (p === 4) { cr = 0.9 * rim + 0.25; cg = 0.5 * rim + 0.15; cb = 0.5 * rim + 0.3; }
            else if (p === 5) { cr = 0.3 + 0.2 * (dx < 0 ? 1 : 0); cg = 0.22; cb = 0.32; }
            else if (p === 6) { cr = 0.7; cg = 0.42; cb = 0.24; fl = 0.2; }
          }
        } else {
          if (xc < bankX(y)) {
            m = BANK;
            const tex = fbm(xc * 0.3, y * 0.5, 3, 0);
            cr = 0.08 + 0.05 * tex; cg = 0.08 + 0.05 * tex; cb = 0.1 + 0.05 * tex;
            if (hash(x * 7, r * 3) > 0.975 - 0.015 * smooth(SHORE + 4, H, y)) { cr = 0.42; cg = 0.22; cb = 0.3; fl = 0.06; }
            if (xc > bankX(y) - 2.6) { const s = 0.85 + 0.3 * hash(x * 3, r * 5); cr = 0.45 * s; cg = 0.38 * s; cb = 0.46 * s; fl = 0.1; }
            warm = 1;
          } else m = POND;
        }
        mat[k] = m; R[k] = cr; G[k] = cg; B[k] = cb; floorA[k] = fl; warmth[k] = warm;
      }
    }
    const RR = R.slice(), RG = G.slice(), RB = B.slice();

    const lanternShape = (dx, y) => {
      const ax = Math.abs(dx);
      if (y >= 93.5 && y < LB) return ax <= 4.2 - (y < 94.5 ? 0.8 : 0) ? 1 : 0;
      if (y >= 87 && y < 93.5) return ax <= 1.4 ? 1 : 0;
      if (y >= 85.5 && y < 87) return ax <= 3.6 - (y < 86.2 ? 0.6 : 0) ? 1 : 0;
      if (y >= 80 && y < 85.5) {
        if (ax <= 1.7 && y >= 80.8 && y < 84.8) return 2;
        return ax <= 2.9 ? 1 : 0;
      }
      if (y >= 76.5 && y < 80) {
        const u = (80 - y) / 3.5, hw = 5.6 - 4.1 * Math.pow(u, 0.8) + (y > 79.2 ? 0.6 : 0);
        return ax <= hw ? 3 : 0;
      }
      if (y >= 73.5 && y < 76.5) return ax <= 1.3 - Math.abs(y - 75) * 0.25 ? 3 : ax <= 0.5 ? 3 : 0;
      return 0;
    };
    const at = (xc, y) => lanternShape((xc - LX) / LS, LB - (LB - y) / LS);
    for (let r = 45; r < H; r++) {
      for (let x = LX - 14; x <= LX + 14; x++) {
        const y = r + 0.5, xc = x + 0.5, l = at(xc, y);
        if (!l) continue;
        const k = r * W + x, py = LB - (LB - y) / LS, pdx = (xc - LX) / LS;
        if (l === 2) {
          mat[k] = FLAME;
          const c = Math.exp(-(pdx * pdx * 0.5 + (py - 82.8) * (py - 82.8) * 0.35));
          R[k] = 0.85 + 0.15 * c; G[k] = 0.5 + 0.38 * c; B[k] = 0.2 + 0.4 * c * c; floorA[k] = 0.35;
        } else {
          mat[k] = STONE;
          const g = 0.8 + 0.4 * hash(x * 5, r * 3), edge = !at(xc, y - 1) ? 1 : 0;
          R[k] = (0.05 + 0.22 * edge) * g; G[k] = (0.04 + 0.14 * edge) * g; B[k] = (0.08 + 0.2 * edge) * g;
          if ((l === 3 && py > 78.6) || (py >= 85.5 && py < 86.4)) {
            const f = Math.exp(-Math.abs(py - 82.8) / 3) * 0.75;
            R[k] += f; G[k] += f * 0.5; B[k] += f * 0.18;
          }
          floorA[k] = 0.02;
        }
        warmth[k] = l === 2 ? 0 : 0.75;
      }
    }

    for (let r = 0; r < H; r++) {
      for (let x = 0; x < 130; x++) {
        const k = r * W + x, y = r + 0.5, xc = x + 0.5;
        let d = 0, best = 0, up = 0;
        for (const [cx, cy, rad] of clusters) {
          const dx = xc - cx, dy = (y - cy) * 1.15, q = (dx * dx + dy * dy) / (rad * rad);
          if (q < 3) { const c = Math.exp(-q * 1.4); d += c; if (c > best) { best = c; up = (dy + dx * 0.4) / rad; } }
        }
        const n = fbm(xc * 0.11, y * 0.15, 3, 0), n2 = noise(xc * 0.5, y * 0.6, 0);
        const bloom = (1 - Math.exp(-d * 1.5)) * (0.15 + 1.35 * n) * (0.75 + 0.5 * n2);
        let onBranch = false, bw = 0;
        for (const [ax, ay, bx, by, w0, w1] of branches) {
          const [dist, kk] = seg(xc, y, ax, ay, bx, by), w = mix(w0, w1, kk) * 0.5 + 0.15;
          if (dist < w) { onBranch = true; bw = Math.max(bw, (dist / w) * (xc < ax + (bx - ax) * kk ? -1 : 1)); }
        }
        if (onBranch && bloom < 0.85) {
          mat[k] = TREE;
          const lit = smooth(0.35, 1, bw);
          R[k] = 0.05 + 0.03 * lit; G[k] = 0.035 + 0.01 * lit; B[k] = 0.07; floorA[k] = 0; warmth[k] = 0.8;
        } else if (bloom > 0.5) {
          mat[k] = BLOOM;
          const inner = hash(x * 3, r * 7);
          let b = clamp01(0.62 - 0.6 * up + 0.26 * (inner - 0.5) - 0.3 * smooth(0.75, 0.5, bloom));
          b = mix(b, 0.12, smooth(0.3, 1.1, up)) * (1 - 0.3 * smooth(28, 48, y));
          R[k] = 0.34 + 0.64 * b; G[k] = 0.08 + 0.62 * b * b; B[k] = 0.2 + 0.5 * b; floorA[k] = 0.1; warmth[k] = 1;
        }
      }
    }

    const glow = new Float32Array(N);
    for (let r = 0; r < H; r++) {
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - LAMP[0], dy = (r + 0.5 - LAMP[1]) * 1.1, d = Math.sqrt(dx * dx + dy * dy);
        glow[r * W + x] = Math.exp(-d / 4) * 0.6 + Math.exp(-d / 11) * 0.32 + Math.exp(-d / 32) * 0.1;
        const m = mat[r * W + x];
        if (m === BLOOM || m === TREE) glow[r * W + x] += Math.exp(-d / 11) * 1.6;
        if (m === BANK) {
          const px = (x + 0.5 - LX) / 20, py = (r + 0.5 - LB + 3) / 8;
          glow[r * W + x] += Math.exp(-(px * px + py * py)) * 0.6;
        }
      }
    }

    const stars = [];
    for (let i = 0; i < 400; i++) {
      const x = Math.floor(hash(i, 91) * W), r = Math.floor(hash(i, 92) * 40), k = r * W + x;
      if (mat[k] === SKY && hash(i, 93) > 0.72) stars.push([k, hash(i, 94) * 6.28, 0.6 + hash(i, 95) * 1.6]);
    }

    const CW = 500, C0 = 34, C1 = 68;
    const cdens = (x, y) => fbm(x * 0.014, y * 0.13, 4, CW * 0.014) - 0.3 * (1 - smooth(C0, C0 + 10, y) * smooth(C1, C1 - 8, y));
    const ccov = new Float32Array(CW * (C1 - C0)), clit = new Float32Array(CW * (C1 - C0));
    for (let r = C0; r < C1; r++) for (let x = 0; x < CW; x++) {
      const y = r + 0.5, d = cdens(x, y);
      ccov[(r - C0) * CW + x] = smooth(0.56, 0.7, d);
      clit[(r - C0) * CW + x] = clamp01(0.5 + (d - cdens(x - 1, y + 2.2)) * 7);
    }

    const petals = [];
    for (let i = 0; i < 50; i++) petals.push({
      x: Math.pow(hash(i, 101), 2.2) * 140, y: hash(i, 102) * (H + 20),
      vx: 3 + hash(i, 103) * 4, vy: 1.6 + hash(i, 104) * 2.2,
      sw: 1 + hash(i, 105) * 2, sf: 0.6 + hash(i, 106) * 1.2, ph: hash(i, 107) * 6.28, tum: 2 + hash(i, 108) * 4
    });
    const floaters = [];
    for (let i = 0; i < 26; i++) floaters.push([hash(i, 111) * W, SHORE + 3 + hash(i, 112) * 20, 0.3 + hash(i, 113) * 0.5]);

    const dith = new Float32Array(N);
    for (let k = 0; k < N; k++) dith[k] = BAYER[(Math.floor(k / W) & 3) * 4 + ((k % W) & 3)] * 0.4 + (hash(k, 77) - 0.5) * 0.5;
    const tone = new Float32Array(1025);
    for (let i = 0; i <= 1024; i++) { const v = i / 256; tone[i] = v < 0.75 ? v : 0.75 + 0.25 * (1 - Math.exp(-(v - 0.75) * 4)); }

    const pr = new Float32Array(N), pg = new Float32Array(N), pb = new Float32Array(N), pmask = new Uint8Array(N);
    let sprites = [];
    function onResize() {
      sprites = buildSpritesForPalette(PALETTE, Math.max(width / W, height / H));
    }

    function drawFrame(_dt, t) {
      const flick = 0.82 + 0.1 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1) + 0.12 * (noise(t * 4, 3.3, 0) - 0.5) * 2;
      const cdrift = (((t * 0.8) % CW) + CW) % CW;
      pmask.fill(0);
      for (const p of petals) {
        const xx = ((((p.x + p.vx * t + p.sw * Math.sin(t * p.sf + p.ph)) % (W + 40)) + W + 40) % (W + 40)) - 20;
        const yy = ((((p.y + p.vy * t + 0.6 * Math.sin(t * p.sf * 1.7 + p.ph)) % (H + 20)) + H + 20) % (H + 20)) - 10;
        const x = Math.round(xx), r = Math.round(yy);
        if (x < 0 || x >= W || r < 0 || r >= H) continue;
        const k = r * W + x, face = (0.55 + 0.45 * Math.abs(Math.sin(t * p.tum + p.ph))) * (mat[k] === POND || mat[k] === BANK ? 0.6 : 1), lg = glow[k] * flick * 1.6;
        pr[k] = 1.0 * face + lg * 0.6; pg[k] = 0.76 * face + lg * 0.35; pb[k] = 0.84 * face + lg * 0.1; pmask[k] = 1;
      }

      for (let r = 0; r < H; r++) {
        const y = r + 0.5;
        for (let x = 0; x < W; x++) {
          const k = r * W + x, m = mat[k];
          let cr, cg, cb, fl = floorA[k], fade = 1;
          if (m === POND) {
            const depth = (y - SHORE) / (H - SHORE), wob = Math.sin(y * 1.7 - t * 2 + Math.sin(x * 0.13 + t * 0.6) * 1.4) * (0.05 + 0.8 * depth);
            let sx = Math.round(x + wob); sx = sx < 0 ? 0 : sx > W - 1 ? W - 1 : sx;
            const w = noise(x * 0.14 + t * 0.2, y * 1.1 - t * 0.8, 0);
            let sr = Math.round(SHORE - 1 - (r - SHORE) * 1.35 + (w - 0.5) * 3 * depth); sr = sr < 0 ? 0 : sr > SHORE - 1 ? SHORE - 1 : sr;
            const j = sr * W + sx, lit = mix(0.95, 0.6, smooth(SHORE + 1, SHORE + 6, y)) * (0.8 + 0.4 * w);
            cr = RR[j] * lit * 0.9; cg = RG[j] * lit * 0.92; cb = RB[j] * lit + 0.03;
            const glint = smooth(0.74, 0.95, w) * 0.06; cr += glint; cg += glint * 0.8; cb += glint;
            const sl = Math.exp(-Math.abs(x + 0.5 - LX - 9 - (y - SHORE) * 0.25) / (3.5 + depth * 3)) * smooth(0.45, 0.8, w) * 1.0 * flick;
            cr += sl; cg += sl * 0.62; cb += sl * 0.25;
            fade = smooth(H + 2, H - 9, y);
          } else {
            cr = R[k]; cg = G[k]; cb = B[k];
            if (m === SKY && r >= C0 && r < C1) {
              const sx = x + cdrift, ix = Math.floor(sx), fx = sx - ix, i0 = (r - C0) * CW + (ix % CW), i1 = (r - C0) * CW + ((ix + 1) % CW), c = ccov[i0] + (ccov[i1] - ccov[i0]) * fx;
              if (c > 0.01) {
                const l = clit[i0] + (clit[i1] - clit[i0]) * fx, sun = l * (0.45 + 0.55 * smooth(C0, C1, y)) * (0.6 + 0.4 * Math.exp(-Math.abs(x - 80) / 90)), a = c * 0.85;
                cr = mix(cr, mix(0.2, 1.0, sun), a); cg = mix(cg, mix(0.12, 0.58, sun), a); cb = mix(cb, mix(0.27, 0.5, sun), a);
              }
            }
          }
          const wm = warmth[k];
          if (wm > 0) { const g = glow[k] * flick * wm; cr += g * 1.0; cg += g * 0.58; cb += g * 0.22; }
          else if (m === SKY || m === POND) { const g = glow[k] * flick * 0.6; cr += g; cg += g * 0.6; cb += g * 0.3; }
          if (m === FLAME) { const f = 0.85 + 0.25 * flick; cr = f; cg = 0.72 * f; cb = 0.38 * f; }
          if (pmask[k] && m !== FLAME) { cr = pr[k]; cg = pg[k]; cb = pb[k]; fl = 0.3; }

          cr = tone[Math.min(1024, (cr * 256) | 0)]; cg = tone[Math.min(1024, (cg * 256) | 0)]; cb = tone[Math.min(1024, (cb * 256) | 0)];
          const peak = Math.max(cr, cg, cb, 1e-4);
          const level = clamp01(fl + (1 - fl) * Math.pow(peak, 1.1) * 1.02) * fade;
          const step = Math.max(0, Math.min(3, Math.round(level * 3 + dith[k])));
          outStep[k] = step;
          if (step) {
            const want = Math.min(1, (level + 0.06) / COVER[step]);
            const s = (0.3 + 0.7 * want) / peak;
            outColor[k] = nearest(clamp01(cr * s), clamp01(cg * s), clamp01(cb * s));
          }
        }
      }

      for (let r = MOON[1] - 6; r <= MOON[1] + 6; r++) {
        for (let x = MOON[0] - 6; x <= MOON[0] + 6; x++) {
          const dx = x + 0.5 - MOON[0], dy = r + 0.5 - MOON[1], ex = dx - 2.2, ey = dy + 1.6;
          if (dx * dx + dy * dy < 5.2 * 5.2 && ex * ex + ey * ey > 4.9 * 4.9) {
            const k = r * W + x;
            outStep[k] = 3;
            outColor[k] = nearest(1, 0.96, 0.86);
          }
        }
      }
      for (const [k, ph, sp] of stars) {
        const s = Math.sin(t * sp + ph);
        if (s > -0.3) {
          outStep[k] = s > 0.7 ? 2 : 1;
          outColor[k] = nearest(0.9, 0.88, 1);
        }
      }
      for (const [fx, fy, sp] of floaters) {
        const x = Math.round((fx + t * sp) % W), r = Math.round(fy + 0.3 * Math.sin(t * 0.8 + fx));
        if (r >= H) continue;
        const k = r * W + x;
        if (mat[k] !== POND) continue;
        outStep[k] = 2;
        outColor[k] = nearest(0.95, 0.72, 0.8);
      }
      renderHalftoneGrid(outStep, outColor, sprites, GROUND);
    }

    return { onResize, drawFrame, fps: 15 };
  }

  // =========================================================================
  // SCENE 0: VOLCANO NIGHT
  // =========================================================================
  function createVolcanoNightScene() {
    const GROUND = "#070405";
    const PALETTE = [
      "#5a1a10", "#7a2410", "#982e0e", "#b8380b", "#d4480b", "#ea5e10", "#f77a18", "#ff9628",
      "#ffb244", "#ffcc63", "#ffe28c", "#fff3c0", "#fffcec",
      "#4a3a37", "#63504b", "#7d6863", "#98827b", "#b39d94", "#cdb9af",
      "#8a4a3a", "#a85a40", "#c87048",
      "#3c4258", "#5d6280", "#8a90b4", "#b4b9dc", "#dfe2f7", "#b9a8ff", "#f4f0ff",
      "#1a1012", "#2c1a18",
    ];
    const { nearest } = makePaletteMatcher(PALETTE);
    let sprites = [];
    function onResize() {
      const cell = Math.max(width / W, height / H);
      sprites = buildSpritesForPalette(PALETTE, cell);
    }

    const CX = 100, RIM = 40, BASE = 86, HIGH = BASE - RIM, SPAN = 32, PLAIN = 76, SHORE = 81;
    const SKY = 0, ROCK = 1, LAKE = 2;

    function noise2(x, y, px = 0, py = 0) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = x - xi, fy = y - yi;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      let x0 = xi, x1 = xi + 1, y0 = yi, y1 = yi + 1;
      if (px) { x0 = ((xi % px) + px) % px; x1 = (x0 + 1) % px; }
      if (py) { y0 = ((yi % py) + py) % py; y1 = (y0 + 1) % py; }
      const a = hash(x0, y0), b = hash(x1, y0), c = hash(x0, y1), d = hash(x1, y1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    function fbm2(x, y, octaves, py = 0) {
      let s = 0, n = 0, amp = 0.5, f = 1;
      for (let i = 0; i < octaves; i++) {
        s += amp * noise2(x * f, y * f, 0, py * f);
        n += amp;
        amp *= 0.5;
        f *= 2;
      }
      return s / n;
    }

    const coneY = (x) => {
      const d = Math.abs(x - CX);
      if (d < 6) return RIM + 0.9 * (1 - (d / 6) ** 2) - 0.6;
      return BASE - HIGH / (1 + ((d - 6) / SPAN) ** 1.6) + 1.4 * (fbm2(x * 0.13, 1.3, 3) - 0.5) * smooth(6, 20, d);
    };
    const reach = (y) => {
      const f = (BASE - y) / HIGH;
      if (f >= 1) return 6;
      if (f <= 0.05) return 95;
      return Math.min(95, 6 + SPAN * Math.pow(1 / f - 1, 1 / 1.6));
    };
    const plumeX = (y) => CX + 0.01 * (RIM - y) ** 2;
    const plumeW = (y) => 8 + 27 * Math.pow(Math.max(0, RIM - y) / RIM, 0.55) + 16 * smooth(14, -3, y);

    const mat = new Uint8Array(N);
    const rock = new Float32Array(N);
    const crack = new Float32Array(N);
    const phase = new Float32Array(N);
    const shoreAt = new Float32Array(W);
    const topAt = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      shoreAt[x] = SHORE + 2 * (fbm2(x * 0.045, 9, 3) - 0.5) * 2 + 0.7 * noise2(x * 0.3, 2);
      topAt[x] = Math.min(coneY(x + 0.5), PLAIN + 1.6 * (fbm2(x * 0.06, 5, 3) - 0.5));
    }
    const cellPt = (i, j) => [i + hash(i, j * 7 + 1), j + hash(i * 3 + 5, j)];
    for (let r = 0; r < H; r++) {
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        const y = r + 0.5;
        if (y >= shoreAt[x]) mat[k] = LAKE;
        else if (y >= topAt[x]) {
          mat[k] = ROCK;
          rock[k] = 0.55 * fbm2(x * 0.3 + y * 0.04 * (x < CX ? -1 : 1) * 3, y * 0.07, 3) + 0.45 * fbm2(x * 0.5, y * 0.5, 2);
          if (y > PLAIN - 3) {
            const sx = x / 7, sy = (y - PLAIN) / 2.6 + 40;
            const ix = Math.floor(sx), iy = Math.floor(sy);
            let f1 = 9, f2 = 9;
            for (let j = iy - 1; j <= iy + 1; j++) {
              for (let i = ix - 1; i <= ix + 1; i++) {
                const [px, py] = cellPt(i, j);
                const d = Math.hypot(px - sx, py - sy);
                if (d < f1) { f2 = f1; f1 = d; }
                else if (d < f2) f2 = d;
              }
            }
            const near = smooth(PLAIN - 3, PLAIN + 3, y);
            crack[k] = smooth(0.16, 0.02, f2 - f1) * near * (0.4 + 0.6 * fbm2(x * 0.08, y * 0.2, 2));
            phase[k] = fbm2(x * 0.05, y * 0.1, 2) * 12;
          }
        }
      }
    }

    const RIVERS = [
      [41.5, 75, -0.55, -0.5, 1, 0.09, 0.3],
      [41.5, 77, 0.45, 0.32, 1, 0.08, 2.1],
      [42, 80, -0.08, -0.22, 1.3, 0.06, 4.0],
      [43, 70, 0.15, 0.7, 0.8, 0.07, 5.2],
      [45, 73, -0.3, -0.85, 0.75, 0.05, 1.4],
    ];
    const rivId = new Uint8Array(N).fill(255);
    const rivS = new Float32Array(N);
    const rivA = new Float32Array(N);
    const rivK = new Float32Array(N);
    const rivGlow = new Float32Array(N);
    RIVERS.forEach(([y0, y1, f0, f1, wm, amp, ph], id) => {
      const pts = [];
      let s = 0, lx = 0, ly = 0;
      for (let y = y0; y <= y1; y += 0.25) {
        const k = (y - y0) / (y1 - y0);
        const f = f0 + (f1 - f0) * smooth(0, 1, k) + amp * Math.sin(k * Math.PI * 4 + ph) + 0.05 * (noise2(k * 7, id * 7) - 0.5);
        const x = CX + f * reach(y);
        if (pts.length) s += Math.hypot(x - lx, y - ly);
        pts.push([x, y, s, k]);
        lx = x; ly = y;
      }
      for (let r = Math.floor(y0) - 3; r < Math.min(H, y1 + 5); r++) {
        for (let x = 0; x < W; x++) {
          const k = r * W + x;
          if (mat[k] !== ROCK) continue;
          const y = r + 0.5;
          let bd = 1e9, bi = 0;
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (Math.abs(p[1] - y) > 7) continue;
            const d = (p[0] - x - 0.5) ** 2 + (p[1] - y) ** 2;
            if (d < bd) { bd = d; bi = i; }
          }
          if (bd > 1e8) continue;
          const [px, , ps, pk] = pts[bi];
          const d = Math.sqrt(bd);
          const hw = (0.55 + 1.3 * pk + 1.4 * smooth(0.85, 1, pk)) * wm;
          const heat = 1 - 0.55 * pk;
          rivGlow[k] = Math.max(rivGlow[k], Math.exp(-Math.max(0, d - hw) / 2.2) * heat);
          if (d < hw && (rivId[k] === 255 || d / hw < Math.abs(rivA[k]))) {
            rivId[k] = id;
            rivS[k] = ps;
            rivA[k] = (x + 0.5 < px ? -1 : 1) * (d / hw);
            rivK[k] = pk;
          }
        }
      }
    });

    const PH = 160;
    const texA = new Float32Array(W * PH);
    const texB = new Float32Array(W * PH);
    for (let r = 0; r < PH; r++) {
      for (let x = 0; x < W; x++) {
        const q = fbm2(x * 0.03, r * 0.03, 3, PH * 0.03);
        texA[r * W + x] = fbm2(x * 0.07 + q * 1.5, r * 0.07, 4, PH * 0.07);
        texB[r * W + x] = fbm2(x * 0.12 + 40, r * 0.12, 3, PH * 0.12);
      }
    }
    const sample = (tex, x, y) => {
      const yi = Math.floor(y), fy = y - yi;
      const r0 = ((yi % PH) + PH) % PH, r1 = (r0 + 1) % PH;
      const xi = Math.max(0, Math.min(W - 1, x | 0));
      return tex[r0 * W + xi] + (tex[r1 * W + xi] - tex[r0 * W + xi]) * fy;
    };

    const haze = new Float32Array(N);
    for (let k = 0; k < N; k++) haze[k] = fbm2((k % W) * 0.04, Math.floor(k / W) * 0.07, 3);

    const ARCS = 34, SPARKS = 110, G = 50;
    const sp = Array.from({ length: ARCS + SPARKS }, (_, i) => ({
      vx: (hash(i, 1) - 0.5) * 2,
      vy: hash(i, 2),
      period: 2.6 + 1.4 * hash(i, 3),
      off: hash(i, 4) * 10,
      x0: (hash(i, 5) - 0.5) * 4,
    }));

    const R = new Float32Array(N), Gc = new Float32Array(N), B = new Float32Array(N);
    const fadeAt = new Float32Array(N).fill(1);
    for (let k = 0; k < N; k++) {
      const r = Math.floor(k / W);
      if (mat[k] === LAKE) fadeAt[k] = smooth(H + 6, H - 6, r + 0.5);
    }
    const addR = new Float32Array(N), addG = new Float32Array(N), addB = new Float32Array(N);
    const outStep = new Uint8Array(N), outColor = new Uint8Array(N);

    const splat = (x, y, a, cr, cg, cb) => {
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || xi >= W || yi < 0 || yi >= H) return;
      const k = yi * W + xi;
      if (mat[k] === LAKE) return;
      if (cr * a > addR[k]) { addR[k] = cr * a; addG[k] = cg * a; addB[k] = cb * a; }
    };

    function drawFrame(_dt, t) {
      addR.fill(0); addG.fill(0); addB.fill(0);

      const surge = 0.65 + 0.35 * Math.sin(t * 1.3) * Math.sin(t * 0.47 + 1);
      for (let i = 0; i < ARCS + SPARKS; i++) {
        const s = sp[i];
        const tt = t + s.off;
        const n = Math.floor(tt / s.period);
        const tau = tt - n * s.period;
        const arc = i < ARCS;
        const kick = (0.82 + 0.3 * hash(i, n + 99)) * (0.8 + 0.25 * surge);
        const vy = (arc ? 30 + 18 * s.vy : 18 + 24 * s.vy) * kick;
        const vx = (arc ? (0.35 + 0.65 * Math.abs(s.vx)) * Math.sign(s.vx) * 20 : s.vx * 11) * kick + 1;
        const life = (2 * vy) / G + 0.7;
        if (tau > life) continue;
        const tail = arc ? 0.34 : 0.04;
        const steps = arc ? 26 : 2;
        for (let j = 0; j <= steps; j++) {
          const u = tau - (j / steps) * tail;
          if (u < 0) break;
          const x = CX + s.x0 + vx * u;
          const y = RIM - 0.8 - vy * u + 0.5 * G * u * u;
          if (y > coneY(x) + 1.5) continue;
          const age = u / life;
          const f = j / steps;
          const a = (1 - 0.75 * f) * (1 - 0.5 * age) * (arc ? 1.1 : 0.75);
          splat(x, y, a, 1, mix(0.95, 0.35, Math.min(1, age + f * 0.6)), mix(0.65, 0.04, Math.min(1, age * 1.4 + f)));
        }
      }

      const slot = Math.floor(t / 0.3), sf = t / 0.3 - slot;
      let bolt = 0, bx = 0, by = 0;
      const boltCells = [];
      if (hash(slot, 77) > 0.8) {
        bolt = sf < 0.15 ? 1 : sf < 0.3 ? 0.25 : sf < 0.5 ? 0.85 : Math.max(0, 0.85 - (sf - 0.5) * 2);
        let y = 4 + hash(slot, 3) * 8;
        let x = plumeX(y) + (hash(slot, 4) - 0.5) * plumeW(y) * 1.1;
        const len = 10 + hash(slot, 5) * 12;
        bx = x; by = y + len / 2;
        const branchAt = 3 + Math.floor(hash(slot, 6) * 5);
        let brx = 0, bry = 0;
        for (let i = 0; i < len; i++) {
          const nx = x + (hash(slot * 31 + i, 8) - 0.5) * 3.2;
          const ny = y + 1;
          for (let q = 0; q <= 2; q++) boltCells.push(Math.round(mix(x, nx, q / 2)) + Math.round(mix(y, ny, q / 2)) * W);
          x = nx; y = ny;
          if (i === branchAt) { brx = x; bry = y; }
        }
        for (let i = 0; i < 6 && brx; i++) {
          brx += hash(slot, 40 + i) < 0.5 ? 1.3 : -1.3;
          bry += 0.8;
          boltCells.push(Math.round(brx) + Math.round(bry) * W);
        }
      }

      const rise = t * 3.2;
      for (let r = 0; r < H; r++) {
        const y = r + 0.5;
        for (let x = 0; x < W; x++) {
          const k = r * W + x;
          const m = mat[k];
          let cr = 0, cg = 0, cb = 0;
          const dcx = x + 0.5 - CX, dcy = (y - RIM + 1) * 1.4;
          const dc = Math.sqrt(dcx * dcx + dcy * dcy);

          if (m === SKY) {
            const v = y / PLAIN;
            const veil = 0.85 + 0.3 * haze[k];
            const gx = dcx / 66, gy = (y - RIM - 12) / 38;
            const glow = 0.5 * Math.exp(-(gx * gx + gy * gy) * 2.2) + 0.16 * Math.exp(-dc / 14) + 0.2 * Math.pow(v, 6);
            const warm = smooth(0, RIM + 20, y);
            cr = (0.005 + glow) * veil;
            cg = (0.005 + glow * (0.1 + 0.22 * warm)) * veil;
            cb = (0.012 + glow * 0.05) * veil;

            let c = 0;
            if (y < RIM + 1) {
              const px = plumeX(y), pw = plumeW(y) * (1 + 0.13 * Math.sin((y + rise) * 0.42) + 0.07 * Math.sin((y + rise) * 0.9 + 2));
              const e = 1 - Math.abs(x + 0.5 - px) / pw;
              if (e > -0.5) {
                const a = sample(texA, x, y + rise);
                const b = sample(texB, x - t * 1.5, y + rise * 1.6);
                const d = 0.65 * a + 0.35 * b;
                c = smooth(0.0, 0.2, e + (a - 0.5) * 2.5 + (b - 0.5) * 0.7) * smooth(-1, 3, y);
                if (c > 0.01) {
                  const below = 0.65 * sample(texA, x, y + 3.5 + rise) + 0.35 * sample(texB, x - t * 1.5, y + 3.5 + rise * 1.6);
                  const lb = clamp01(0.45 + (d - below) * 13);
                  const up = RIM - y;
                  const heat = Math.exp(-up / 10) * 0.6 + 0.16 * Math.exp(-up / 30);
                  const young = 0.3 + 0.7 * smooth(RIM - 4, RIM - 20, y);
                  const l2 = lb * lb;
                  const body = (0.15 + 0.5 * l2) * (0.7 + 0.3 * clamp01(e * 2)) * young;
                  const fire = heat * (0.2 + 1.1 * l2) * (0.45 + 0.55 * smooth(RIM - 2, RIM - 12, y));
                  let pr = body + fire * 0.95;
                  let pg = body * 0.86 + fire * (0.18 + 0.25 * Math.exp(-up / 6));
                  let pb = body * 0.8 + fire * 0.05;
                  if (bolt) {
                    const dl = Math.hypot(x + 0.5 - bx, (y - by) * 0.8);
                    const L = bolt * (Math.exp(-dl / 5) * 0.6 + Math.exp(-dl / 16) * 0.22) * (0.3 + 0.9 * lb);
                    pr += 0.7 * L; pg += 0.66 * L; pb += 0.95 * L;
                  }
                  const al = Math.min(1, c * 1.15);
                  cr = mix(cr, pr, al);
                  cg = mix(cg, pg, al);
                  cb = mix(cb, pb, al);
                }
              }
            }
            if (c < 0.05 && hash(x, r * 3 + 11) > 0.982) {
              const tw = 0.6 + 0.4 * Math.sin(t * (1.5 + hash(x, r) * 3) + hash(r, x) * 6.28);
              const s = (0.35 + 0.5 * tw) * smooth(0.25, 0.04, glow) * smooth(PLAIN - 4, 20, y);
              cr = Math.max(cr, s * 0.85); cg = Math.max(cg, s * 0.87); cb = Math.max(cb, s);
            }
          } else if (m === ROCK) {
            const s = rock[k];
            cr = 0.012 + 0.04 * s;
            cg = 0.01 + 0.024 * s;
            cb = 0.012 + 0.024 * s;
            const rg = rivGlow[k];
            const up = Math.exp(-dc / 6) * 0.9 + Math.exp(-dc / 22) * 0.06;
            const brow = smooth(topAt[x] + 1.4, topAt[x], y) * 0.55 * Math.exp(-dc / 90);
            const lit = (rg * 0.22 + rg * rg * 0.3 + up + brow) * (0.4 + 0.9 * s);
            cr += lit * 0.9;
            cg += lit * 0.22;
            cb += lit * 0.05;
            const id = rivId[k];
            if (id !== 255) {
              const a = rivA[k], kk = rivK[k], sv = rivS[k];
              const heat = clamp01((1 - 0.75 * a * a) * (1 - 0.5 * kk) + 0.2 * (noise2(sv * 0.9 - t * 4.5, a * 2 + id * 9) - 0.5));
              let lr = 0.75 + 0.3 * heat, lg = 0.12 + 0.75 * heat * heat, lb = 0.02 + 0.35 * heat ** 4;
              const pn = noise2(sv * 0.32 - t * 0.95, a * 1.3 + id * 13) * 0.7 + noise2(sv * 0.8 - t * 2.4, a * 2.6 + id * 5) * 0.3;
              const th = 0.6 - 0.22 * kk + 0.12 * a * a;
              const plate = smooth(th, th + 0.05, pn);
              const seam = smooth(th - 0.05, th, pn) * (1 - plate);
              const dark = 0.13 + 0.12 * noise2(sv * 1.5 - t * 0.95 * 4.7, a * 4);
              lr = mix(lr, dark, plate) + seam * 0.3;
              lg = mix(lg, dark * 0.3, plate) + seam * 0.15;
              lb = mix(lb, dark * 0.2, plate);
              const edge = smooth(1, 0.75, Math.abs(a));
              cr = mix(cr, lr, edge);
              cg = mix(cg, lg, edge);
              cb = mix(cb, lb, edge);
            } else if (crack[k] > 0.01) {
              const pulse = 0.55 + 0.45 * Math.sin(t * 0.9 + phase[k]);
              const g = crack[k] * pulse * (0.5 + rg);
              cr += 0.75 * g;
              cg += 0.18 * g;
              cb += 0.03 * g;
            }
          } else {
            const sh = shoreAt[x];
            const depth = y - sh;
            const w = noise2(x * 0.05 + t * 0.15, y * 0.9 - t * 0.9) * 0.6 + noise2(x * 0.15 - t * 0.3, y * 1.6 - t * 1.6) * 0.4;
            const sx = Math.max(1, Math.min(W - 2, Math.round(x + (w - 0.5) * 4)));
            const sy = Math.max(0, Math.min(Math.floor(shoreAt[sx]) - 1, Math.round(sh - depth * 3 - 1 - (w - 0.5) * 4)));
            const sk = sy * W + sx;
            const band = 0.3 + 1.1 * smooth(0.35, 0.7, w);
            const dim = 1.05 * (1 - depth / 45);
            const rr = 0.5 * R[sk] + 0.25 * (R[sk - 1] + R[sk + 1]);
            const rg = 0.5 * Gc[sk] + 0.25 * (Gc[sk - 1] + Gc[sk + 1]);
            const rb = 0.5 * B[sk] + 0.25 * (B[sk - 1] + B[sk + 1]);
            cr = 0.01 + rr * band * dim;
            cg = 0.01 + rg * band * dim * 0.9;
            cb = 0.02 + rb * band * dim * 0.9;
            const lip = smooth(1.5, 0, depth);
            cr *= 1 - 0.7 * lip; cg *= 1 - 0.7 * lip; cb *= 1 - 0.7 * lip;
          }

          if (m !== LAKE) {
            const vg = Math.exp(-dc / 1.4) * 1.3 + Math.exp(-dc / 5) * 0.2;
            cr += vg + addR[k];
            cg += vg * 0.55 + addG[k];
            cb += vg * 0.18 + addB[k];
          }
          R[k] = cr; Gc[k] = cg; B[k] = cb;
        }
      }

      for (const c of boltCells) {
        if (c < 0 || c >= N || mat[c] !== SKY) continue;
        const v = Math.min(1, bolt * 1.4);
        R[c] = mix(R[c], 0.92, v); Gc[c] = mix(Gc[c], 0.9, v); B[c] = mix(B[c], 1, v);
      }

      for (let r = 0; r < H; r++) {
        for (let x = 0; x < W; x++) {
          const k = r * W + x;
          const cr = Math.max(0, R[k] - 0.025), cg = Math.max(0, Gc[k] - 0.025), cbl = Math.max(0, B[k] - 0.025);
          const peak = Math.max(cr, cg, cbl, 1e-4);
          const level = clamp01(Math.pow(peak, 0.85) * 0.95) * fadeAt[k];
          const step = Math.max(0, Math.min(3, Math.round(level * 3 + BAYER[(r & 3) * 4 + (x & 3)])));
          outStep[k] = step;
          if (step) {
            const want = Math.min(1, (level + 0.06) / COVER[step]);
            const s = (0.3 + 0.7 * want) / peak;
            outColor[k] = nearest(clamp01(cr * s), clamp01(cg * s), clamp01(cbl * s));
          }
        }
      }
      renderHalftoneGrid(outStep, outColor, sprites, GROUND);
    }

    return { onResize, drawFrame, fps: 15 };
  }

  // =========================================================================
  // SCENE 6: BLACK HOLE (ASCII ACCRETION DISK)
  // =========================================================================
  function createBlackHoleScene() {
    const GROUND = "#030204";
    const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
    const RAMP_LEN = RAMP.length;
    const COLORS = [
      "#360d06",
      "#591608",
      "#82230a",
      "#ad340c",
      "#d44b10",
      "#ef6918",
      "#ff8a26",
      "#ffaa44",
      "#ffc96b",
      "#ffe3a1",
      "#fff5d6"
    ];

    let cols = 140;
    let rows = 60;
    let cellW = 9;
    let cellH = 14;
    let fontSize = 13;

    function onResize() {
      const minDim = Math.min(width, height);
      fontSize = Math.max(10, Math.min(14, Math.round(minDim / 62)));
      cellW = Math.round(fontSize * 0.62);
      cellH = Math.round(fontSize * 1.12);
      cols = Math.max(60, Math.ceil(width / cellW) + 2);
      rows = Math.max(30, Math.ceil(height / cellH) + 2);
    }

    function drawFrame(_dt, t) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = GROUND;
      ctx.fillRect(0, 0, width, height);

      ctx.font = `600 ${fontSize}px ui-monospace, "Cascadia Mono", "Consolas", monospace`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";

      const cx = width * 0.5;
      const cy = height * 0.5;
      const scale = Math.min(width, height) * 0.44;
      const startX = (width - cols * cellW) * 0.5;
      const startY = (height - rows * cellH) * 0.5;

      // Slight diagonal tilt matching the relativistic accretion disk
      const cosR = Math.cos(-0.24);
      const sinR = Math.sin(-0.24);
      const shadowR = 0.255;

      // Pre-bucket characters by color index to minimize fillStyle switches
      const buckets = Array.from({ length: COLORS.length }, () => []);

      for (let r = 0; r < rows; r++) {
        const py = startY + r * cellH;
        const dy = (py + cellH * 0.5 - cy) / scale;
        for (let c = 0; c < cols; c++) {
          const px = startX + c * cellW;
          const dx = (px + cellW * 0.5 - cx) / scale;

          // Rotate into disk frame
          const rx = dx * cosR - dy * sinR;
          const ry = dx * sinR + dy * cosR;
          const dist = Math.hypot(rx, ry);

          // Pitch-black event horizon shadow (slightly flattened/warped by spin)
          const shadowEdge = shadowR + 0.012 * Math.sin(Math.atan2(ry, rx) * 2 + 0.6);
          if (dist < shadowEdge) continue;

          // Gravitational lensing coordinates:
          // 1) Main tilted accretion disk
          const diskY = ry * 2.15;
          const diskR = Math.hypot(rx, diskY);

          // 2) Lensed upper/lower halo bending around the shadow
          const haloR = dist;

          // Blend between equatorial disk and lensed sphere
          const diskBand = Math.exp(-Math.pow((diskR - 0.58) / 0.34, 2));
          const haloBand = Math.exp(-Math.pow((haloR - 0.44) / 0.30, 2)) * 0.85;
          const innerRing = Math.exp(-Math.pow((dist - shadowEdge - 0.028) / 0.036, 2)) * 1.15;

          const angle = Math.atan2(ry, rx);
          const diskAngle = Math.atan2(diskY, rx);

          // Keplerian differential rotation (faster near the event horizon)
          const spinDisk = diskAngle + t * (1.55 / (0.28 + diskR));
          const spinHalo = angle + t * (1.25 / (0.25 + haloR));

          // Swirling plasma filaments
          const swirl1 = fbm(
            Math.cos(spinDisk) * (1.8 + diskR * 3.0) + 10,
            Math.sin(spinDisk) * (1.8 + diskR * 3.0) + diskR * 4.5,
            3
          );
          const swirl2 = fbm(
            Math.cos(spinHalo * 2.0) * 2.4 + haloR * 5.0,
            Math.sin(spinHalo * 2.0) * 2.4 - t * 0.35,
            2
          );
          const spiral = 0.5 + 0.5 * Math.sin(spinDisk * 3.0 - diskR * 16.0);

          // Relativistic Doppler beaming: approaching side (bottom-left) is hotter & brighter
          const doppler = 0.62 + 0.45 * Math.cos(angle - 2.35);

          // Outer radial falloff so edges dissolve cleanly into space
          const outerFade = smooth(1.06, 0.42, dist);
          const innerFade = smooth(shadowEdge, shadowEdge + 0.035, dist);

          let lum = (diskBand * (0.45 + 0.75 * swirl1) + haloBand * (0.35 + 0.65 * swirl2) + innerRing * (0.65 + 0.35 * spiral))
            * doppler * outerFade * innerFade;

          // Subtle background starfield outside the bright disk
          if (lum < 0.045 && dist > 0.72) {
            const starH = hash(c * 13 + 7, r * 29 + 3);
            if (starH > 0.9935) {
              const tw = 0.45 + 0.55 * Math.sin(t * (1.5 + starH * 4) + c);
              lum = 0.16 * tw;
            }
          }

          if (lum <= 0.035) continue;

          lum = clamp01(lum);
          const jitter = (hash(c + Math.floor(t * 6), r) - 0.5) * 0.08;
          const charIdx = Math.max(1, Math.min(RAMP_LEN - 1, Math.floor(clamp01(lum + jitter) * (RAMP_LEN - 1))));
          const ch = RAMP[charIdx];
          if (ch === " ") continue;

          const colorIdx = Math.max(0, Math.min(COLORS.length - 1, Math.floor(Math.pow(lum, 0.85) * (COLORS.length - 0.01))));
          buckets[colorIdx].push(ch, px, py);
        }
      }

      for (let ci = 0; ci < COLORS.length; ci++) {
        const b = buckets[ci];
        if (!b.length) continue;
        ctx.fillStyle = COLORS[ci];
        for (let i = 0; i < b.length; i += 3) {
          ctx.fillText(b[i], b[i + 1], b[i + 2]);
        }
      }
    }

    return { onResize, drawFrame, fps: 20 };
  }


  // =========================================================================
  // SCENE MANAGER & MAIN LOOP
  // =========================================================================
  const sceneCache = {};
  const factories = {
    "volcano-night": createVolcanoNightScene,
    "cloud-sea": createCloudSeaScene,
    "lantern-lake": createLanternLakeScene,
    "aurora-fjord": createAuroraFjordScene,
    "kyoto-dusk": createKyotoDuskScene,
    "frog": createFrogScene,
    "black-hole": createBlackHoleScene
  };

  function getActiveScene() {
    if (!sceneCache[activeTheme]) {
      sceneCache[activeTheme] = factories[activeTheme]();
      sceneCache[activeTheme].onResize();
    }
    return sceneCache[activeTheme];
  }

  let rafId = 0;

  function isPaused() {
    return window.__rvlPauseBg || document.hidden || document.body.classList.contains("no-anim");
  }

  function resize() {
    dpr = 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const sc = getActiveScene();
    sc.onResize();
    sc.drawFrame(0.016, isPaused() ? 4.2 : performance.now() / 1000);
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function frame(now) {
    rafId = 0;
    if (isPaused()) return;
    const sc = getActiveScene();
    const minMs = 1000 / sc.fps;
    if (now - lastDraw >= minMs - 1) {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      lastDraw = now;
      sc.drawFrame(dt, now / 1000);
    }
    rafId = requestAnimationFrame(frame);
  }

  function syncLoop() {
    if (isPaused()) {
      stopLoop();
      const sc = getActiveScene();
      sc.drawFrame(0.016, 4.2);
    } else if (!rafId) {
      lastTime = performance.now();
      lastDraw = 0;
      rafId = requestAnimationFrame(frame);
    }
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
  window.addEventListener("rvl:anim-change", syncLoop);
  document.addEventListener("visibilitychange", syncLoop);

  requestAnimationFrame(() => {
    resize();
    if (!isPaused()) {
      rafId = requestAnimationFrame(frame);
    }
  });
})();
