/**
 * 图片相似度计算工具模块
 * 提取自 MarketPage.tsx，供模具租/售等多处图片搜索复用
 */

// ============ 基础向量运算 ============
const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
};

const softIoU = (a: number[], b: number[]): number => {
  if (a.length !== b.length || a.length === 0) return 0;
  let inter = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    inter += Math.min(a[i], b[i]);
    union += Math.max(a[i], b[i]);
  }
  return union > 0 ? inter / union : 0;
};

// ============ 图片主体识别 ============
const estimateBackgroundColor = (data: Uint8ClampedArray, w: number, h: number): { r: number; g: number; b: number }[] => {
  const band = Math.max(2, Math.floor(Math.min(w, h) * 0.12));
  const counts = new Map<string, { n: number; r: number; g: number; b: number }>();
  const addPx = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const k = `${data[i] >> 3}_${data[i + 1] >> 3}_${data[i + 2] >> 3}`;
    const e = counts.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2];
    counts.set(k, e);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < band || x >= w - band || y < band || y >= h - band) addPx(x, y);
    }
  }
  const arr = Array.from(counts.values()).map(e => ({ n: e.n, r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }));
  arr.sort((a, b) => b.n - a.n);
  const total = arr.reduce((s, e) => s + e.n, 0) || 1;
  const colors: { r: number; g: number; b: number }[] = [];
  let acc = 0;
  for (const e of arr) {
    colors.push({ r: e.r, g: e.g, b: e.b });
    acc += e.n / total;
    if (acc >= 0.55 || colors.length >= 3) break;
  }
  return colors;
};

const detectSubjectMask = (data: Uint8ClampedArray, w: number, h: number): { mask: Uint8Array; x0: number; y0: number; x1: number; y1: number } | null => {
  const n = w * h;
  let ar = 0, ag = 0, ab = 0;
  for (let i = 0; i < data.length; i += 4) { ar += data[i]; ag += data[i + 1]; ab += data[i + 2]; }
  ar /= n; ag /= n; ab /= n;
  const bgColors = estimateBackgroundColor(data, w, h);
  const nearBgDist = (i: number): number => {
    let dmin = Infinity;
    for (const c of bgColors) {
      const dr = data[i] - c.r, dg = data[i + 1] - c.g, db = data[i + 2] - c.b;
      const d = Math.sqrt(dr * dr + dg * dg + db * db);
      if (d < dmin) dmin = d;
    }
    return dmin;
  };
  const tryBg = (thr: number): { mask: Uint8Array; ratio: number } | null => {
    const mask = new Uint8Array(n);
    let cnt = 0;
    for (let p = 0; p < n; p++) {
      if (nearBgDist(p * 4) > thr) { mask[p] = 1; cnt++; }
    }
    const ratio = cnt / n;
    return (ratio >= 0.05 && ratio <= 0.92) ? { mask, ratio } : null;
  };
  let fg = bgColors.length ? tryBg(42) : null;
  if (!fg) fg = tryBg(60);
  if (!fg) {
    const diffs = new Float32Array(n);
    let mean = 0;
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      const dr = data[i] - ar, dg = data[i + 1] - ag, db = data[i + 2] - ab;
      const d = Math.sqrt(dr * dr + dg * dg + db * db);
      diffs[p] = d; mean += d;
    }
    mean /= n;
    const mask = new Uint8Array(n);
    let cnt = 0;
    for (let p = 0; p < n; p++) if (diffs[p] > mean) { mask[p] = 1; cnt++; }
    const ratio = cnt / n;
    if (ratio < 0.03 || ratio > 0.95) return null;
    fg = { mask, ratio };
  }
  const rowCnt = new Int32Array(h), colCnt = new Int32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fg.mask[y * w + x]) { rowCnt[y]++; colCnt[x]++; }
  let rowMax = 0, colMax = 0;
  for (let y = 0; y < h; y++) if (rowCnt[y] > rowMax) rowMax = rowCnt[y];
  for (let x = 0; x < w; x++) if (colCnt[x] > colMax) colMax = colCnt[x];
  const rowThr = Math.max(2, rowMax * 0.08), colThr = Math.max(2, colMax * 0.08);
  let y0 = -1, y1 = -1, x0 = -1, x1 = -1;
  for (let y = 0; y < h; y++) if (rowCnt[y] >= rowThr) { if (y0 < 0) y0 = y; y1 = y; }
  for (let x = 0; x < w; x++) if (colCnt[x] >= colThr) { if (x0 < 0) x0 = x; x1 = x; }
  if (y0 < 0 || x0 < 0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (bw / w < 0.12 || bh / h < 0.12) return null;
  return { mask: fg.mask, x0, y0, x1, y1 };
};

// ============ 主体特征提取 ============
const SUBJECT_SIL_GRID = 24;
const HOG_CELLS = 4;
const HOG_BINS = 8;

export interface SubjectFeatures {
  hist: number[];
  layout: number[];
  sil: number[];
  hog: number[];
  aspect: number;
}

export const computeSubjectFeatures = (imgSrc: string): Promise<SubjectFeatures> => {
  return new Promise((resolve) => {
    const empty: SubjectFeatures = { hist: [], layout: [], sil: [], hog: [], aspect: 0 };
    if (!imgSrc) { resolve(empty); return; }
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const dw = 96, dh = 96;
        const c1 = document.createElement('canvas');
        c1.width = dw; c1.height = dh;
        const ctx1 = c1.getContext('2d');
        if (!ctx1) { resolve(empty); return; }
        ctx1.drawImage(img, 0, 0, dw, dh);
        const px = ctx1.getImageData(0, 0, dw, dh).data;
        const subj = detectSubjectMask(px, dw, dh);

        const size = 64;
        const c2 = document.createElement('canvas');
        c2.width = size; c2.height = size;
        const ctx2 = c2.getContext('2d');
        if (!ctx2) { resolve(empty); return; }
        if (subj) {
          const nx0 = Math.max(0, subj.x0 - (subj.x1 - subj.x0) * 0.06) / dw;
          const nx1 = Math.min(dw - 1, subj.x1 + (subj.x1 - subj.x0) * 0.06) / dw;
          const ny0 = Math.max(0, subj.y0 - (subj.y1 - subj.y0) * 0.06) / dh;
          const ny1 = Math.min(dh - 1, subj.y1 + (subj.y1 - subj.y0) * 0.06) / dh;
          const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
          ctx2.drawImage(img, nx0 * iw, ny0 * ih, (nx1 - nx0) * iw, (ny1 - ny0) * ih, 0, 0, size, size);
        } else {
          ctx2.drawImage(img, 0, 0, size, size);
        }
        const data = ctx2.getImageData(0, 0, size, size).data;
        const bins = new Array(64).fill(0);
        for (let i = 0; i < data.length; i += 4) {
          const r = Math.floor(data[i] / 64);
          const g = Math.floor(data[i + 1] / 64);
          const b = Math.floor(data[i + 2] / 64);
          bins[r * 16 + g * 4 + b]++;
        }
        const hist = bins.map(v => v / (size * size));
        if (!subj) { resolve({ hist, layout: [], sil: [], hog: [], aspect: 0 }); return; }
        const bw = subj.x1 - subj.x0 + 1, bh = subj.y1 - subj.y0 + 1;

        // 剪影描述子
        const G = SUBJECT_SIL_GRID;
        const rawGrid = new Float32Array(G * G);
        const cellTot = new Float32Array(G * G);
        for (let y = subj.y0; y <= subj.y1; y++) {
          const gy = Math.min(G - 1, Math.floor(((y - subj.y0) / bh) * G));
          for (let x = subj.x0; x <= subj.x1; x++) {
            const gx = Math.min(G - 1, Math.floor(((x - subj.x0) / bw) * G));
            cellTot[gy * G + gx]++;
            if (subj.mask[y * dw + x]) rawGrid[gy * G + gx]++;
          }
        }
        for (let i = 0; i < G * G; i++) rawGrid[i] = cellTot[i] > 0 ? rawGrid[i] / cellTot[i] : 0;
        // 3×3 平滑
        const sil: number[] = [];
        for (let y = 0; y < G; y++) {
          for (let x = 0; x < G; x++) {
            let s = 0, c = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const ny = y + dy, nx = x + dx;
              if (ny >= 0 && ny < G && nx >= 0 && nx < G) { s += rawGrid[ny * G + nx]; c++; }
            }
            sil.push(s / c);
          }
        }

        // HOG
        const hogCellW = bw / HOG_CELLS, hogCellH = bh / HOG_CELLS;
        const hog: number[] = new Array(HOG_CELLS * HOG_CELLS * HOG_BINS).fill(0);
        const gray = (x: number, y: number): number => {
          const i = (y * dw + x) * 4;
          return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        };
        for (let cy = 0; cy < HOG_CELLS; cy++) {
          for (let cx = 0; cx < HOG_CELLS; cx++) {
            const x0 = subj.x0 + Math.round(cx * hogCellW);
            const x1 = subj.x0 + Math.round((cx + 1) * hogCellW);
            const y0 = subj.y0 + Math.round(cy * hogCellH);
            const y1 = subj.y0 + Math.round((cy + 1) * hogCellH);
            const bin = new Array(HOG_BINS).fill(0);
            for (let y = Math.max(1, y0); y < Math.min(dh - 1, y1); y++) {
              for (let x = Math.max(1, x0); x < Math.min(dw - 1, x1); x++) {
                const gx = gray(x + 1, y) - gray(x - 1, y);
                const gy = gray(x, y + 1) - gray(x, y - 1);
                const mag = Math.sqrt(gx * gx + gy * gy);
                let angle = Math.atan2(gy, gx) * (180 / Math.PI);
                if (angle < 0) angle += 180;
                const b = Math.min(HOG_BINS - 1, Math.floor(angle / (180 / HOG_BINS)));
                bin[b] += mag;
              }
            }
            const total = bin.reduce((a, b) => a + b, 0) || 1;
            const offset = (cy * HOG_CELLS + cx) * HOG_BINS;
            for (let b = 0; b < HOG_BINS; b++) hog[offset + b] = bin[b] / total;
          }
        }

        // 颜色布局 2×2
        const layout: number[] = [];
        const halfW = size / 2, halfH = size / 2;
        const regionBins = [new Array(16).fill(0), new Array(16).fill(0), new Array(16).fill(0), new Array(16).fill(0)];
        const regionCnt = [0, 0, 0, 0];
        for (let i = 0; i < data.length; i += 4) {
          const px = (i / 4) % size, py = Math.floor((i / 4) / size);
          const ri = (py < halfH ? 0 : 2) + (px < halfW ? 0 : 1);
          const r = Math.floor(data[i] / 128), g = Math.floor(data[i + 1] / 128), b = Math.floor(data[i + 2] / 128);
          regionBins[ri][r * 4 + g * 2 + b]++;
          regionCnt[ri]++;
        }
        for (let ri = 0; ri < 4; ri++) {
          const t = regionCnt[ri] || 1;
          for (let j = 0; j < 16; j++) layout.push(regionBins[ri][j] / t);
        }

        const aspect = bw / bh;
        resolve({ hist, layout, sil, hog, aspect });
      } catch { resolve({ hist: [], layout: [], sil: [], hog: [], aspect: 0 }); }
    };
    img.onerror = () => resolve({ hist: [], layout: [], sil: [], hog: [], aspect: 0 });
    img.src = imgSrc;
  });
};

// ============ 相似度计算 ============
export const subjectSimilarity = (ref: SubjectFeatures, cur: SubjectFeatures): number => {
  const colorSim = cosineSimilarity(ref.hist, cur.hist);
  if (!ref.sil.length || !cur.sil.length || !(ref.aspect > 0) || !(cur.aspect > 0)) return colorSim;
  const silSim = softIoU(ref.sil, cur.sil);
  const hogSim = cosineSimilarity(ref.hog, cur.hog);
  const layoutSim = (ref.layout.length && cur.layout.length) ? cosineSimilarity(ref.layout, cur.layout) : colorSim;
  const aspectSim = Math.max(0, 1 - Math.abs(Math.log(ref.aspect / cur.aspect)) / Math.log(1.75));
  return 0.30 * silSim + 0.30 * hogSim + 0.18 * colorSim + 0.12 * layoutSim + 0.10 * aspectSim;
};
