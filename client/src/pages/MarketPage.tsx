import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Card, Table, Tag, Typography, Space, Empty, Input, InputNumber, Select, Button, message,
  Modal, Form, Popconfirm, Tooltip, Tabs, Row, Col, Statistic, Drawer, Switch, Segmented, Descriptions, DatePicker, Checkbox, Image, Popover, Alert, List, Dropdown, Menu, Radio, Badge,
} from 'antd';
import {
  ShopOutlined, PlusOutlined, SearchOutlined, ReloadOutlined, EditOutlined, CloseOutlined,
  EyeOutlined, DollarOutlined, StarOutlined, StarFilled, ShoppingCartOutlined, SwapOutlined,
  PrinterOutlined, SettingOutlined, AuditOutlined, CheckCircleOutlined, CloseCircleOutlined,
  CameraOutlined, ShareAltOutlined, DeleteOutlined, CopyOutlined, CheckCircleFilled, MoreOutlined,
  UnorderedListOutlined, AppstoreOutlined, MessageOutlined, LinkOutlined, SnippetsOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { safeSetItem } from '../utils/storageQuota';
import { saveDataset } from '../utils/dataStore';
import { getProvinceOptions, getCityOptions, getDistrictOptions } from '../utils/regions';
import { syncOrderReserved } from '../utils/orderOccupied';
import MoldMarketTab from './MoldMarketTab';
import ChatPage from './ChatPage';
import { triggerOpenChat, fetchUnreadCount, onNewMessage as onChatNewMessage } from '../utils/chatSocket';
import { getDataOwner } from '../utils/brandAuth';

const { Text, Paragraph } = Typography;
const PRIMARY = '#1e4a7e';

// ============ 商机市场全局存储与工具 ============
const MARKET_KEY = 'market_publish_orders';

// 发布资格校验：基础价（基础售价）不等于 0 且大于成本价，才能发布到成品市场（自动上架/手动发布同口径）
const isPricePublishable = (p: any): boolean => {
  const base = Number(p?.suggestedPrice) || 0;
  const cost = Number(p?.costPrice) || 0;
  return base !== 0 && base > cost;
};
// 商品标题生成：货号+鞋底材质+鞋面材质+码段+颜色（空字段自动跳过）
const buildProductTitle = (p: any): string => {
  const parts = [p?.productCode, p?.shoeSole, p?.shoeUpper, p?.spec, p?.color].filter(v => String(v || '').trim());
  return parts.length ? parts.join('-') : (p?.shortName || p?.productCode || p?.styleCode || '');
};
const RATINGS_KEY = 'market_ratings';
const TRADE_KEY = 'market_trade_orders';

const loadJson = (k: string, d: any = []) => {
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; }
};
const saveJson = (k: string, v: any) => { const j = JSON.stringify(v); safeSetItem(k, j); saveDataset(k, j); };

// 名称脱敏：保留首尾、中间 ***（非发布方查看报价工厂时使用）
export const maskName = (s: any): string => {
  const t = String(s || '');
  if (!t) return '';
  if (t.length <= 3) return t[0] + '***';
  return t.slice(0, 2) + '***' + t.slice(-2);
};
// 价格脱敏：非发布方隐藏报价价格
export const maskPrice = () => '***';

// 账号信用分：被评分均值（1-5）+ 评分次数
export const creditOf = (username: string): { score: string; count: number } => {
  const list: any[] = loadJson(RATINGS_KEY, []);
  const mine = list.filter(r => r.toUsername === username);
  if (!mine.length) return { score: '', count: 0 };
  const avg = mine.reduce((s, r) => s + (Number(r.score) || 0), 0) / mine.length;
  return { score: avg.toFixed(1), count: mine.length };
};

// 根据 username 从 registeredUsers 查找正确的公司名（修复报价提交时 bidderCompany 可能存错的问题）
const resolveCompany = (username: string): string => {
  if (!username) return '';
  try {
    const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x.username === username);
    if (u?.companyName) return u.companyName;
  } catch { /* ignore */ }
  return '';
};

// 公司编号取数：分享链接不暴露注册账号，用 companyNo（老账号回退 companyShortName）
const companyNoOf = (uname: string): string => {
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = Array.isArray(users) ? users.find((x: any) => x.username === uname) : null;
    return (u && (u.companyNo || u.companyShortName)) || uname;
  } catch { return uname; }
};

const CreditTag: React.FC<{ username: string; company?: string; openShare?: boolean }> = ({ username, company, openShare }) => {
  const c = creditOf(username);
  // openShare：点击供应商名称新开窗口打开该供应商的货盘公开分享页（全部商品，链接用公司编号）
  const nameNode = openShare ? (
    <span
      style={{ color: PRIMARY, cursor: 'pointer', textDecoration: 'underline' }}
      title="点击打开该供应商的货盘分享页"
      onClick={e => { e.stopPropagation(); window.open(`${window.location.origin}/shared/inventory?supplier=${encodeURIComponent(companyNoOf(username))}`, '_blank'); }}
    >{company || username}</span>
  ) : (company || username);
  return (
    <span>
      {nameNode}
      {c.count > 0 ? <Tooltip title={`信用评分 ${c.score} 分（${c.count} 次评价）`}><Tag color="gold" style={{ marginLeft: 6 }}>★ {c.score}</Tag></Tooltip> : <Tag style={{ marginLeft: 6 }}>暂无评分</Tag>}
    </span>
  );
};

const nextMarketId = (list: any[]) => {
  const max = list.reduce((m: number, r: any) => {
    const n = Number(String(r.id || '').replace(/\D/g, ''));
    return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return `FB-${String(max + 1).padStart(6, '0')}`;
};

// 余弦相似度计算
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

// ============ 图片主体识别（显著性检测，纯前端） ============
// 估计背景主色：从图片边缘环带像素按颜色量化聚类，取累计占比前几的簇作为背景候选
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

// 主体前景掩码与包围盒：背景色分离 + 显著性兜底；无法识别时返回 null（回退整图）
const detectSubjectMask = (data: Uint8ClampedArray, w: number, h: number): { mask: Uint8Array; x0: number; y0: number; x1: number; y1: number } | null => {
  const n = w * h;
  // 全图平均色（显著性兜底用）
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
  // 背景分离：与最近背景簇距离超过阈值的像素视为前景；前景占比需在 5%~92% 之间
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
    // 显著性兜底：背景分散（无纯色背景）时，取与全图平均色差异高于均值的像素为前景
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
  // 行列前景计数求稳健包围盒（过滤稀疏噪声行列）
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
  if (bw / w < 0.12 || bh / h < 0.12) return null; // 主体过小视为检测失败
  return { mask: fg.mask, x0, y0, x1, y1 };
};

// 主体特征提取：颜色直方图 + 颜色布局 + 剪影网格 + HOG 梯度方向描述子 + 长宽比（高识别度综合模型）
const SUBJECT_SIL_GRID = 24;
const HOG_CELLS = 4;   // 主体包围盒上 4×4 单元格
const HOG_BINS = 8;    // 每格 8 个无符号梯度方向箱（0~180°）
interface SubjectFeatures { hist: number[]; layout: number[]; sil: number[]; hog: number[]; aspect: number; }
const computeSubjectFeatures = (imgSrc: string): Promise<SubjectFeatures> => {
  return new Promise((resolve) => {
    const empty: SubjectFeatures = { hist: [], layout: [], sil: [], hog: [], aspect: 0 };
    if (!imgSrc) { resolve(empty); return; }
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        // 第一步：缩到 96×96 做主体检测（前景掩码 + 包围盒）
        const dw = 96, dh = 96;
        const c1 = document.createElement('canvas');
        c1.width = dw; c1.height = dh;
        const ctx1 = c1.getContext('2d');
        if (!ctx1) { resolve(empty); return; }
        ctx1.drawImage(img, 0, 0, dw, dh);
        const px = ctx1.getImageData(0, 0, dw, dh).data;
        const subj = detectSubjectMask(px, dw, dh);
        // 第二步：主体区域颜色直方图（识别失败回退整图）
        const size = 64;
        const c2 = document.createElement('canvas');
        c2.width = size; c2.height = size;
        const ctx2 = c2.getContext('2d');
        if (!ctx2) { resolve(empty); return; }
        if (subj) {
          // 包围盒扩张 6%，保留主体边缘轮廓
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
        // 第三步：剪影描述子——包围盒归一化 24×24 网格前景占比 + 3×3 平滑（容忍轻微错位，保留高帮/低帮轮廓差异）
        const G = SUBJECT_SIL_GRID;
        const rawGrid = new Float32Array(G * G);
        const cellTot = new Float32Array(G * G);
        for (let y = subj.y0; y <= subj.y1; y++) {
          const gy = Math.min(G - 1, Math.floor(((y - subj.y0) / bh) * G));
          for (let x = subj.x0; x <= subj.x1; x++) {
            const gx = Math.min(G - 1, Math.floor(((x - subj.x0) / bw) * G));
            const gi = gy * G + gx;
            cellTot[gi]++;
            if (subj.mask[y * dw + x]) rawGrid[gi]++;
          }
        }
        const occ = new Float32Array(G * G);
        for (let i = 0; i < G * G; i++) occ[i] = cellTot[i] > 0 ? rawGrid[i] / cellTot[i] : 0;
        const sil = new Array(G * G).fill(0);
        for (let y = 0; y < G; y++) {
          for (let x = 0; x < G; x++) {
            let s = 0, c = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const yy = y + dy, xx = x + dx;
              if (yy >= 0 && yy < G && xx >= 0 && xx < G) { s += occ[yy * G + xx]; c++; }
            }
            sil[y * G + x] = c > 0 ? s / c : 0;
          }
        }
        // 第四步：颜色布局——包围盒内前景像素 4×4 网格平均色（捕捉黑帮白底这类颜色分布差异）
        const L = 4;
        const lsum = new Float32Array(L * L * 3);
        const lcnt = new Float32Array(L * L);
        for (let y = subj.y0; y <= subj.y1; y++) {
          const gy = Math.min(L - 1, Math.floor(((y - subj.y0) / bh) * L));
          for (let x = subj.x0; x <= subj.x1; x++) {
            const p = y * dw + x;
            if (!subj.mask[p]) continue;
            const gx = Math.min(L - 1, Math.floor(((x - subj.x0) / bw) * L));
            const gi = gy * L + gx;
            lsum[gi * 3] += px[p * 4]; lsum[gi * 3 + 1] += px[p * 4 + 1]; lsum[gi * 3 + 2] += px[p * 4 + 2];
            lcnt[gi]++;
          }
        }
        const layout: number[] = [];
        for (let i = 0; i < L * L; i++) {
          if (lcnt[i] > 0) layout.push(lsum[i * 3] / lcnt[i] / 255, lsum[i * 3 + 1] / lcnt[i] / 255, lsum[i * 3 + 2] / lcnt[i] / 255);
          else layout.push(0, 0, 0);
        }
        // 第五步：HOG 梯度方向描述子——包围盒内灰度梯度 4×4  cell × 8 方向箱，逐格 L2 归一（捕捉帮面/鞋底/鞋带等结构轮廓）
        const gray = new Float32Array(dw * dh);
        for (let p = 0; p < dw * dh; p++) gray[p] = 0.299 * px[p * 4] + 0.587 * px[p * 4 + 1] + 0.114 * px[p * 4 + 2];
        const hog = new Float32Array(HOG_CELLS * HOG_CELLS * HOG_BINS);
        for (let y = subj.y0 + 1; y < subj.y1; y++) {
          for (let x = subj.x0 + 1; x < subj.x1; x++) {
            const gxv = gray[y * dw + x + 1] - gray[y * dw + x - 1];
            const gyv = gray[(y + 1) * dw + x] - gray[(y - 1) * dw + x];
            const mag = Math.sqrt(gxv * gxv + gyv * gyv);
            if (mag < 12) continue; // 忽略平坦背景弱梯度
            let ang = Math.atan2(gyv, gxv) * 180 / Math.PI;
            if (ang < 0) ang += 180; // 无符号方向 0~180
            const cy = Math.min(HOG_CELLS - 1, Math.floor(((y - subj.y0) / bh) * HOG_CELLS));
            const cx = Math.min(HOG_CELLS - 1, Math.floor(((x - subj.x0) / bw) * HOG_CELLS));
            const fi = (ang / 180) * HOG_BINS;
            const b0 = Math.floor(fi) % HOG_BINS;
            const b1 = (b0 + 1) % HOG_BINS;
            const t = fi - Math.floor(fi);
            const base = (cy * HOG_CELLS + cx) * HOG_BINS;
            hog[base + b0] += mag * (1 - t);
            hog[base + b1] += mag * t;
          }
        }
        for (let cIdx = 0; cIdx < HOG_CELLS * HOG_CELLS; cIdx++) {
          let n = 0;
          for (let b = 0; b < HOG_BINS; b++) n += hog[cIdx * HOG_BINS + b] * hog[cIdx * HOG_BINS + b];
          n = Math.sqrt(n) || 1;
          for (let b = 0; b < HOG_BINS; b++) hog[cIdx * HOG_BINS + b] /= n;
        }
        let gn = 0;
        for (let i = 0; i < hog.length; i++) gn += hog[i] * hog[i];
        gn = Math.sqrt(gn) || 1;
        const hogVec = Array.from(hog, v => v / gn);
        resolve({ hist, layout, sil, hog: hogVec, aspect: bw / bh });
      } catch { resolve(empty); }
    };
    img.onerror = () => resolve(empty);
    img.src = imgSrc;
  });
};

// 软 IoU：逐元素 min 之和 / max 之和；比余弦更能惩罚轮廓错位（高帮 vs 低帮直接拉开差距）
const softIoU = (a: number[], b: number[]): number => {
  let inter = 0, union = 0;
  for (let i = 0; i < a.length && i < b.length; i++) { inter += Math.min(a[i], b[i]); union += Math.max(a[i], b[i]); }
  return union > 0 ? inter / union : 0;
};

// 综合相似度：剪影 IoU 30% + HOG 结构 30% + 颜色直方图 18% + 颜色布局 12% + 长宽比 10%（任一侧形状特征缺失时回退纯颜色比对）
const subjectSimilarity = (ref: SubjectFeatures, cur: SubjectFeatures): number => {
  const colorSim = cosineSimilarity(ref.hist, cur.hist);
  if (!ref.sil.length || !cur.sil.length || !(ref.aspect > 0) || !(cur.aspect > 0)) return colorSim;
  const silSim = softIoU(ref.sil, cur.sil);
  const hogSim = cosineSimilarity(ref.hog, cur.hog);
  const layoutSim = (ref.layout.length && cur.layout.length) ? cosineSimilarity(ref.layout, cur.layout) : colorSim;
  const aspectSim = Math.max(0, 1 - Math.abs(Math.log(ref.aspect / cur.aspect)) / Math.log(1.75));
  return 0.30 * silSim + 0.30 * hogSim + 0.18 * colorSim + 0.12 * layoutSim + 0.10 * aspectSim;
};

// 图片解析：优先产品自带 image（URL），回退发布者图片存储键 prodImg_<owner>_<productKey>
const imgOf = (owner: string, p: any): string => {
  if (p && p.image) return String(p.image);
  try { return localStorage.getItem(`prodImg_${owner}_${p && p.key}`) || ''; } catch { return ''; }
};

// 收集款式下各颜色主图（排除代表产品——其图已记入卡片 image 字段，避免 base64 重复存储），
// 嵌入卡片记录随 market_publish_orders 同步服务器，供跨账号展示
const collectVariantImages = (ownerKey: string, prods: any[], styleCode: string, repKey: string): { key: string; color: string; src: string }[] => {
  const out: { key: string; color: string; src: string }[] = [];
  (prods || []).forEach((p: any) => {
    if (!p || p.styleCode !== styleCode || !p.key || p.key === repKey) return;
    let src = p.image || '';
    if (!src) { try { src = localStorage.getItem(`prodImg_${ownerKey}_${p.key}`) || ''; } catch { /* ignore */ } }
    if (src) out.push({ key: p.key, color: p.color || '', src });
  });
  return out;
};

// 收集款式下各 SKU 的规格明细行（颜色/尺码/SKU编码/供货价/库存/状态）嵌入卡片记录随 market_publish_orders 同步：
// 其他账号浏览器没有发布方产品列表键（pageData_ 仅同步当前账号自己的数据集），不嵌入则跨账号查看规格明细为空
const collectVariants = (prods: any[], styleCode: string): any[] => {
  return (prods || []).filter((p: any) => p && p.styleCode === styleCode && p.key).map((p: any) => ({
    key: p.key, color: p.color || '', spec: p.spec || '', productCode: p.productCode || '',
    unit: p.unit || '件', suggestedPrice: Number(p.suggestedPrice) || 0, actualStock: Number(p.actualStock) || 0,
    productStatus: p.productStatus || '', shortName: p.shortName || '',
  }));
};
// 跨账号颜色图解析：本地存储（发布方本机）优先，回退卡片内嵌图（productColor→image / variantImages）
const embeddedSrcOf = (rec: any, color: string): string => {
  if (!rec) return '';
  if (color && color === (rec.productColor || '') && rec.image) return rec.image;
  const emb = (Array.isArray(rec.variantImages) ? rec.variantImages : []).find((e: any) => (e.color || '') === color);
  return emb?.src || '';
};

// 六面图后缀（与 PlanDesignPage SIX_VIEWS 一致：主图+五张视角图）
const SIX_SUFFIX = ['_side', '_back', '_front2', '_top', '_bottom'];
// IndexedDB 图片库读取（prodImages/imgs，键=变体key+后缀）
const idbGet = (key: string): Promise<string> => new Promise(resolve => {
  try {
    const req = indexedDB.open('prodImages', 1);
    req.onupgradeneeded = () => { try { req.result.createObjectStore('imgs'); } catch { /* ignore */ } };
    req.onsuccess = () => {
      try {
        const r = req.result.transaction('imgs', 'readonly').objectStore('imgs').get(key);
        r.onsuccess = () => resolve(r.result || '');
        r.onerror = () => resolve('');
      } catch { resolve(''); }
    };
    req.onerror = () => resolve('');
  } catch { resolve(''); }
});
// 图片异步解析链：localStorage prodImg_<owner>_<key+suffix> → IndexedDB <key+suffix>
const resolveImg = async (owner: string, key: string, suffix = ''): Promise<string> => {
  if (!key) return '';
  try { const ls = localStorage.getItem(`prodImg_${owner}_${key}${suffix}`); if (ls) return ls; } catch { /* ignore */ }
  return idbGet(`${key}${suffix}`);
};

const PROCESS_OPTIONS = ['复合', '针车', '成型', '裁断', '绣花', '印花', '电脑车'].map(v => ({ value: v, label: v }));

// 合同打印内容转义（防注入）
const esc = (s: any): string => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

// ============ 创建货盘弹窗组件 ============
interface CreateInventoryModalProps {
  onCancel: () => void;
  onCreate: (name: string, productKeys: string[]) => void;
  market: any[];
  username: string;
}

const CreateInventoryModal: React.FC<CreateInventoryModalProps> = ({ onCancel, onCreate, market, username }) => {
  const [name, setName] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');

  // 获取当前用户的成品列表（排除已下架墓碑卡片）
  const myFinished = useMemo(() => {
    return market.filter(r => r.type === 'finished' && !r.delisted && r.publisherUsername === username);
  }, [market, username]);

  // 过滤后的产品列表
  const filteredProducts = useMemo(() => {
    if (!searchText.trim()) return myFinished;
    const kw = searchText.toLowerCase();
    return myFinished.filter(p =>
      (p.styleCode || '').toLowerCase().includes(kw) ||
      (p.shortName || '').toLowerCase().includes(kw) ||
      (p.productCode || '').toLowerCase().includes(kw)
    );
  }, [myFinished, searchText]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedKeys(filteredProducts.map(p => p.key));
    } else {
      setSelectedKeys([]);
    }
  };

  const handleSelect = (key: string, checked: boolean) => {
    if (checked) {
      setSelectedKeys(prev => [...prev, key]);
    } else {
      setSelectedKeys(prev => prev.filter(k => k !== key));
    }
  };

  const handleCreate = () => {
    if (!name.trim()) {
      message.warning('请输入货盘名称');
      return;
    }
    if (selectedKeys.length === 0) {
      message.warning('请至少选择一个商品');
      return;
    }
    onCreate(name.trim(), selectedKeys);
  };

  return (
    <div>
      <Form autoComplete="off" layout="vertical" style={{ marginBottom: 16 }}>
        <Form.Item label="货盘名称" required>
          <Input
            placeholder="请输入货盘名称"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={50}
          />
        </Form.Item>
      </Form>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input
          placeholder="搜索款式编码/商品名称"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          allowClear
          style={{ width: 240 }}
        />
        <Checkbox
          checked={selectedKeys.length === filteredProducts.length && filteredProducts.length > 0}
          indeterminate={selectedKeys.length > 0 && selectedKeys.length < filteredProducts.length}
          onChange={e => handleSelectAll(e.target.checked)}
        >
          全选
        </Checkbox>
        <Text type="secondary">已选 {selectedKeys.length} / {filteredProducts.length} 件</Text>
      </div>

      <div style={{ maxHeight: 500, overflowY: 'auto' }}>
        {filteredProducts.length === 0 ? (
          <Empty description="暂无成品数据" style={{ padding: 40 }} />
        ) : (
          <Row gutter={[12, 12]}>
            {filteredProducts.map((item: any) => {
              const isSelected = selectedKeys.includes(item.key);
              const imgSrc = item.image || imgOf(username, { key: item.productKey });
              return (
                <Col xs={12} sm={8} md={6} key={item.key}>
                  <div
                    onClick={() => handleSelect(item.key, !isSelected)}
                    style={{
                      background: isSelected ? '#e6f7ff' : '#fff',
                      border: isSelected ? '2px solid #1890ff' : '1px solid #f0f0f0',
                      borderRadius: 8,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      position: 'relative',
                    }}
                  >
                    {/* 选中标记 */}
                    {isSelected && (
                      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
                        <CheckCircleFilled style={{ fontSize: 24, color: '#1890ff' }} />
                      </div>
                    )}
                    {/* 商品图片 */}
                    <div style={{ width: '100%', aspectRatio: '1 / 1', background: '#f5f5f5', overflow: 'hidden' }}>
                      {imgSrc ? (
                        <img src={imgSrc} alt={item.shortName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <ShopOutlined style={{ fontSize: 36, color: '#d9d9d9' }} />
                        </div>
                      )}
                    </div>
                    {/* 商品信息 */}
                    <div style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
                        <Tag color="blue" style={{ fontSize: 10, marginRight: 4, padding: '0 3px' }}>{item.styleCode}</Tag>
                        {item.shortName || '—'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline' }}>
                        <span style={{ color: '#f5222d', fontSize: 14, fontWeight: 700 }}>¥{Number(item.targetPrice) || 0}</span>
                        <span style={{ color: '#999', fontSize: 11, marginLeft: 2 }}>/{item.unit || '件'}</span>
                      </div>
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>
        )}
      </div>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onCancel}>取消</Button>
        <Button type="primary" onClick={handleCreate} disabled={!name.trim() || selectedKeys.length === 0}>
          创建货盘
        </Button>
      </div>
    </div>
  );
};

// ============ 添加商品到货盘弹窗组件 ============
interface AddProductsToInventoryModalProps {
  inventoryId: string;
  inventoryLists: any[];
  onCancel: () => void;
  onAdd: (productKeys: string[]) => void;
  market: any[];
  username: string;
}

const AddProductsToInventoryModal: React.FC<AddProductsToInventoryModalProps> = ({ 
  inventoryId, inventoryLists, onCancel, onAdd, market, username 
}) => {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');

  // 获取当前货盘
  const currentInventory = inventoryLists.find(l => l.id === inventoryId);
  const existingKeys = currentInventory?.productKeys || [];

  // 获取当前用户的成品列表（排除已下架墓碑卡片）
  const myFinished = useMemo(() => {
    return market.filter(r => r.type === 'finished' && !r.delisted && r.publisherUsername === username);
  }, [market, username]);

  // 过滤后的产品列表（排除已存在的）
  const filteredProducts = useMemo(() => {
    let products = myFinished.filter(p => !existingKeys.includes(p.key));
    if (searchText.trim()) {
      const kw = searchText.toLowerCase();
      products = products.filter(p =>
        (p.styleCode || '').toLowerCase().includes(kw) ||
        (p.shortName || '').toLowerCase().includes(kw) ||
        (p.productCode || '').toLowerCase().includes(kw)
      );
    }
    return products;
  }, [myFinished, searchText, existingKeys]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedKeys(filteredProducts.map(p => p.key));
    } else {
      setSelectedKeys([]);
    }
  };

  const handleSelect = (key: string, checked: boolean) => {
    if (checked) {
      setSelectedKeys(prev => [...prev, key]);
    } else {
      setSelectedKeys(prev => prev.filter(k => k !== key));
    }
  };

  const handleAdd = () => {
    if (selectedKeys.length === 0) {
      message.warning('请至少选择一个商品');
      return;
    }
    onAdd(selectedKeys);
  };

  return (
    <div>
      <Alert
        message={`当前货盘：${currentInventory?.name || ''}（已有 ${existingKeys.length} 件商品）`}
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input
          placeholder="搜索款式编码/商品名称"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          allowClear
          style={{ width: 240 }}
        />
        <Checkbox
          checked={selectedKeys.length === filteredProducts.length && filteredProducts.length > 0}
          indeterminate={selectedKeys.length > 0 && selectedKeys.length < filteredProducts.length}
          onChange={e => handleSelectAll(e.target.checked)}
        >
          全选
        </Checkbox>
        <Text type="secondary">已选 {selectedKeys.length} / {filteredProducts.length} 件（可添加）</Text>
      </div>

      <div style={{ maxHeight: 500, overflowY: 'auto' }}>
        {filteredProducts.length === 0 ? (
          <Empty description={searchText ? '未找到匹配的商品' : '所有商品已添加到此货盘'} style={{ padding: 40 }} />
        ) : (
          <Row gutter={[12, 12]}>
            {filteredProducts.map((item: any) => {
              const isSelected = selectedKeys.includes(item.key);
              const imgSrc = item.image || imgOf(username, { key: item.productKey });
              return (
                <Col xs={12} sm={8} md={6} key={item.key}>
                  <div
                    onClick={() => handleSelect(item.key, !isSelected)}
                    style={{
                      background: isSelected ? '#e6f7ff' : '#fff',
                      border: isSelected ? '2px solid #1890ff' : '1px solid #f0f0f0',
                      borderRadius: 8,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      position: 'relative',
                    }}
                  >
                    {/* 选中标记 */}
                    {isSelected && (
                      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
                        <CheckCircleFilled style={{ fontSize: 24, color: '#1890ff' }} />
                      </div>
                    )}
                    {/* 商品图片 */}
                    <div style={{ width: '100%', aspectRatio: '1 / 1', background: '#f5f5f5', overflow: 'hidden' }}>
                      {imgSrc ? (
                        <img src={imgSrc} alt={item.shortName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <ShopOutlined style={{ fontSize: 36, color: '#d9d9d9' }} />
                        </div>
                      )}
                    </div>
                    {/* 商品信息 */}
                    <div style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
                        <Tag color="blue" style={{ fontSize: 10, marginRight: 4, padding: '0 3px' }}>{item.styleCode}</Tag>
                        {item.shortName || '—'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline' }}>
                        <span style={{ color: '#f5222d', fontSize: 14, fontWeight: 700 }}>¥{Number(item.targetPrice) || 0}</span>
                        <span style={{ color: '#999', fontSize: 11, marginLeft: 2 }}>/{item.unit || '件'}</span>
                      </div>
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>
        )}
      </div>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onCancel}>取消</Button>
        <Button type="primary" onClick={handleAdd} disabled={selectedKeys.length === 0}>
          添加选中的商品
        </Button>
      </div>
    </div>
  );
};

// ============ 商机市场页面（供应商/加工厂/采购商三端自适应） ============
const MarketPage: React.FC = () => {
  const username = localStorage.getItem('username') || '';
  const companyName = localStorage.getItem('companyName') || username;
  const owner = getDataOwner();
  const isFactory = window.location.pathname.startsWith('/factory');
  const isPurchaser = window.location.pathname.startsWith('/purchaser');

  const [market, setMarket] = useState<any[]>([]);
  // 初始标签页：优先从 URL 参数读取（分享链接直达）
  const [tab, setTab] = useState<string>(() => {
    try { const ptab = new URLSearchParams(window.location.search).get('tab'); if (ptab) return ptab; } catch { /* ignore */ }
    return isPurchaser ? 'finished' : 'semi';
  });

  // 货盘公开分享页「联系」按键跳转：自动切聊天标签并打开指定会话
  useEffect(() => {
    try {
      const req = sessionStorage.getItem('open_chat_request');
      if (req) {
        sessionStorage.removeItem('open_chat_request');
        const p = JSON.parse(req);
        if (p?.username) {
          setTab('chat');
          triggerOpenChat(p.username, p.subject || '');
        }
      }
    } catch { /* ignore */ }
  }, []);
  // 我的货盘
  const [inventoryLists, setInventoryLists] = useState<any[]>([]);
  const [createInventoryVisible, setCreateInventoryVisible] = useState(false);
  // 我的货盘：店铺横幅图（货盘公开分享页公司表头左侧背景图）
  const [invBanner, setInvBanner] = useState<string>('');
  const invBannerFileRef = useRef<HTMLInputElement>(null);
  const [shareCodeInput, setShareCodeInput] = useState('');
  const [sharedInventory, setSharedInventory] = useState<any>(null);
  const [currentInventoryId, setCurrentInventoryId] = useState<string | null>(null); // 当前查看的货盘ID，null表示显示全部
  const [editInventoryVisible, setEditInventoryVisible] = useState(false);
  const [editInventoryData, setEditInventoryData] = useState<any>(null);
  const [addProductsVisible, setAddProductsVisible] = useState(false);
  const [addProductsInventoryId, setAddProductsInventoryId] = useState<string | null>(null);
  // 商机市场为公开信息：默认展示全市场（所有供应商发布的发包单/成品），可切换我的发布
  const [scope, setScope] = useState<'mine' | 'all'>('all');
  const [fabScope, setFabScope] = useState<'market' | 'quotes'>('market');
  // 发包市场视图模式：表格/卡片（默认卡片）
  const [semiViewMode, setSemiViewMode] = useState<'table' | 'card'>('card');
  // 聊天未读数角标
  const [chatUnread, setChatUnread] = useState(0);

  // 搜索
  const [sKw, setSKw] = useState(''); const [apKw, setApKw] = useState('');
  const [sStatus, setSStatus] = useState('all'); const [apStatus, setApStatus] = useState('all');
  // 成品市场：标题搜索与图片搜索
  const [titleSearchInput, setTitleSearchInput] = useState('');
  const [titleSearch, setTitleSearch] = useState('');
  const [imageSearchUrl, setImageSearchUrl] = useState('');
  const [imageSearchVisible, setImageSearchVisible] = useState(false);
  // 图片搜索相似度得分：{ [recordKey]: score }
  const [imgSimScores, setImgSimScores] = useState<Record<string, number>>({});
  const [imgSimComputing, setImgSimComputing] = useState(false);

  // 当参考图片变化时，异步计算各商品图片的相似度（两侧均提取主体颜色+形状特征，综合打分）
  useEffect(() => {
    if (!imageSearchUrl) { setImgSimScores({}); return; }
    let cancelled = false;
    setImgSimComputing(true);
    (async () => {
      const refFeat = await computeSubjectFeatures(imageSearchUrl);
      if (cancelled || refFeat.hist.length === 0) { setImgSimComputing(false); return; }
      const finishedItems = market.filter(r => r.type === 'finished' && !r.delisted);
      const scores: Record<string, number> = {};
      for (const item of finishedItems) {
        if (cancelled) break;
        const src = item.image || imgOf(item.publisherUsername, { key: item.productKey });
        if (!src) { scores[item.key] = 0; continue; }
        const feat = await computeSubjectFeatures(src);
        scores[item.key] = feat.hist.length === 0 ? 0 : subjectSimilarity(refFeat, feat);
      }
      if (!cancelled) { setImgSimScores(scores); setImgSimComputing(false); }
    })();
    return () => { cancelled = true; };
  }, [imageSearchUrl, market]);

  // 图片搜索弹窗打开时，监听全局粘贴事件，支持直接 Ctrl+V 粘贴
  useEffect(() => {
    if (!imageSearchVisible) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              setImageSearchUrl(ev.target?.result as string);
              setImageSearchVisible(false);
              message.success('已加载粘贴图片');
            };
            reader.readAsDataURL(file);
          }
          return;
        }
      }
      message.warning('剪切板中没有图片');
    };
    document.addEventListener('paste', handlePaste);
    return () => { document.removeEventListener('paste', handlePaste); };
  }, [imageSearchVisible]);

  // 从剪切板读取图片（供粘贴按钮调用）
  const handlePasteFromClipboard = async () => {
    try {
      const items = await (navigator as any).clipboard.read();
      for (const it of items) {
        const type = it.types.find((t: string) => t.startsWith('image/'));
        if (type) {
          const blob = await it.getType(type);
          const reader = new FileReader();
          reader.onload = (ev) => {
            setImageSearchUrl(ev.target?.result as string);
            setImageSearchVisible(false);
            message.success('已加载粘贴图片');
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
      message.warning('剪切板中没有图片');
    } catch {
      message.warning('无法读取剪切板，请检查浏览器权限');
    }
  };

  // 发布/编辑弹窗
  const [pubVisible, setPubVisible] = useState(false);
  const [pubEdit, setPubEdit] = useState<any>(null);
  const [pubForm] = Form.useForm();
  const [pubImage, setPubImage] = useState<string>('');
  const pubImageFileRef = useRef<HTMLInputElement>(null);
  // 详情弹窗（产品详情 + 下方报价记录）
  const [detailRec, setDetailRec] = useState<any>(null);
  const [wonQuoteKey, setWonQuoteKey] = useState('');
  // 成品详情：同款式变体（颜色/规格 SKU）与主图选择
  const [detailVariants, setDetailVariants] = useState<any[]>([]);
  const [detailColor, setDetailColor] = useState<string>('');
  const [detailImg, setDetailImg] = useState<string>('');
  // 成品详情缩略图：颜色主图 + 任一颜色的六面图（没有的不展示）
  const [detailThumbs, setDetailThumbs] = useState<{ src: string; label: string }[]>([]);
  // 图片预览弹窗
  const [imgPreviewVisible, setImgPreviewVisible] = useState(false);
  const [imgPreviewSrc, setImgPreviewSrc] = useState<string>('');
  // 成品详情 SKU 采购数量（输入框无步进控件）
  const [skuQty, setSkuQty] = useState<Record<string, number>>({});
  // 加入购物车弹窗（成品市场点击购物车按钮时弹出，显示商品明细供选择）
  const [addToCartModalRec, setAddToCartModalRec] = useState<any>(null);
  const [addToCartVariants, setAddToCartVariants] = useState<any[]>([]);
  const [addToCartColor, setAddToCartColor] = useState<string>('');
  const [addToCartImg, setAddToCartImg] = useState<string>('');
  const [addToCartSkuQty, setAddToCartSkuQty] = useState<Record<string, number>>({});
  // 购物车勾选/下单/付款
  const [cartChecked, setCartChecked] = useState<string[]>([]);
  const [orderVisible, setOrderVisible] = useState(false);
  const [orderForm] = Form.useForm();
  const [payVisible, setPayVisible] = useState(false);
  const [payShot, setPayShot] = useState<string>('');
  // 付款账户勾选：每个供应商银行账户/收款码二选一（财务审核显示勾选的账户）
  const [payChannelMap, setPayChannelMap] = useState<Record<string, 'bank' | 'qr'>>({});
  // 付款方式：每个供应商独立选择（银行转账 / 余额支付）
  const [payMethodMap, setPayMethodMap] = useState<Record<string, '银行转账' | '余额支付'>>({});
  // 报价方公司详情弹窗
  const [bidderCompanyRec, setBidderCompanyRec] = useState<any>(null);
  // 下单弹窗省市区级联
  const ordProvince = Form.useWatch('province', orderForm);
  const ordCity = Form.useWatch('city', orderForm);

  const openDetail = useCallback((rec: any) => {
    setDetailRec(rec); setWonQuoteKey(''); setSkuQty({}); setDetailThumbs([]); setDetailImg('');
    if (rec && rec.type === 'finished') {
      const prods: any[] = loadJson(`pageData_basic-data_product-list_${rec.publisherUsername}`, []);
      const localVars = prods.filter(p => p.styleCode === rec.styleCode);
      // 跨账号回退：查看方本地无发布方产品列表键时，用卡片内嵌的 SKU 规格明细
      const vars: any[] = localVars.length ? localVars : (Array.isArray(rec.variants) ? rec.variants : []);
      setDetailVariants(vars);
      setDetailColor('');
      // 缩略图组合：①每个颜色的主图 ②任一颜色存在的六面图（跳过缺失）
      (async () => {
        const owner = rec.publisherUsername;
        const embedded: any[] = Array.isArray(rec.variantImages) ? rec.variantImages : [];
        const colors: string[] = Array.from(new Set([
          ...vars.map(v => v.color || '').filter(Boolean),
          ...embedded.map((e: any) => e.color || '').filter(Boolean),
        ]));
        const thumbs: { src: string; label: string }[] = [];
        if (colors.length) {
          for (const c of colors) {
            const v = vars.find(x => (x.color || '') === c);
            const local = (v && v.image) || (v ? await resolveImg(owner, v.key) : '');
            const src = local || embeddedSrcOf(rec, c);
            if (src) thumbs.push({ src, label: `${c}主图` });
          }
        } else {
          const src = rec.image || embedded[0]?.src || await resolveImg(owner, rec.productKey);
          if (src) thumbs.push({ src, label: '主图' });
        }
        for (const c of colors) {
          const v = vars.find(x => (x.color || '') === c);
          if (!v) continue;
          const views: { src: string; label: string }[] = [];
          for (const s of SIX_SUFFIX) {
            const src = await resolveImg(owner, v.key, s);
            if (src) views.push({ src, label: `${c}六面图` });
          }
          if (views.length) { thumbs.push(...views); break; }
        }
        setDetailThumbs(thumbs);
        setDetailImg(thumbs[0]?.src || rec.image || '');
      })();
    } else {
      setDetailVariants([]); setDetailColor('');
    }
  }, []);
  // 报价/询价弹窗
  const [quoteRec, setQuoteRec] = useState<any>(null);
  const [quoteForm] = Form.useForm();
  // 成品市场：设置/收藏/购物车/比价
  const [autoOn, setAutoOn] = useState<boolean>(() => {
      const cfg = loadJson(`market_settings_${owner}`, {}) || {};
      return cfg.autoPublishOnSale !== false; // 未设置时默认开启，仅显式关闭才为关
    });
  // 手动发布弹窗
  const [manualPublishVisible, setManualPublishVisible] = useState(false);
  const [manualPublishSelected, setManualPublishSelected] = useState<Set<string>>(new Set());
  const [manualPublishProducts, setManualPublishProducts] = useState<any[]>([]);
  const [manualPublishSearch, setManualPublishSearch] = useState({ styleCode: '', hasImage: '', published: '' });
  const [manualPublishAppliedSearch, setManualPublishAppliedSearch] = useState({ styleCode: '', hasImage: '', published: '' });
  // 成品编辑弹窗
  const [editFinishedVisible, setEditFinishedVisible] = useState(false);
  const [editFinishedForm] = Form.useForm();
  const [favVisible, setFavVisible] = useState(false);
  const [cartVisible, setCartVisible] = useState(false);
  const [favorites, setFavorites] = useState<any[]>(() => loadJson(`market_favorites_${username}`, []));
  const [cart, setCart] = useState<any[]>(() => loadJson(`market_cart_${username}`, []));
  // 收藏夹剔除已下架（墓碑标记）卡片
  const liveFavorites = useMemo(() => {
    const delisted = new Set(market.filter(r => r.delisted === true).map(r => r.key));
    return favorites.filter(f => !delisted.has(f.cardKey));
  }, [favorites, market]);
  const [compareVisible, setCompareVisible] = useState(false);
  const [compareCode, setCompareCode] = useState<string>('');
  // 合同打印
  const [contractRec, setContractRec] = useState<any>(null);

  const reload = useCallback(() => { setMarket(loadJson(MARKET_KEY, [])); }, []);
  useEffect(() => {
    reload();
    const onSync = () => reload();
    window.addEventListener('sync-data-updated', onSync);
    return () => window.removeEventListener('sync-data-updated', onSync);
  }, [reload]);

  // 根据 URL 参数自动打开产品详情（分享链接直达）
  useEffect(() => {
    if (market.length === 0) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const productId = params.get('productId');
      if (productId) {
        const target = market.find((r: any) => String(r.id) === productId);
        if (target) {
          openDetail(target);
        }
      }
    } catch { /* ignore */ }
  }, [market, openDetail]);

  // 成品市场自动上架（公开信息）：扫描所有未显式关闭「在售成品自动上架」的账号（未设置默认开启）的产品列表，
  // 按款式编码聚合为卡片写入全局市场键（成品页与产品列表共享 pageData_basic-data_product-list_<账号> 键）
  const sweepFinished = useCallback((list: any[]) => {
    let out = [...list];
    // 候选账号 = 设置键 ∪ 产品列表键；显式 autoPublishOnSale=false 为关闭，其余（含未设置）一律开启
    const settingOn = new Map<string, boolean>();
    const candidates = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // 跳过存储层时间戳元数据键（safeSetItem 会附加 <key>_ts，值为数字，误当账号键会致 prods.filter 崩溃白屏）
      if (!k || k.endsWith('_ts')) continue;
      if (k.startsWith('market_settings_')) {
        const o = k.slice('market_settings_'.length);
        const cfg = loadJson(k, {});
        settingOn.set(o, !(cfg && cfg.autoPublishOnSale === false));
        candidates.add(o);
      } else if (k.startsWith('pageData_basic-data_product-list_')) {
        candidates.add(k.slice('pageData_basic-data_product-list_'.length));
      }
    }
    const owners: string[] = [];
    const disabled: string[] = [];
    candidates.forEach(o => { if (settingOn.get(o) === false) disabled.push(o); else owners.push(o); });
    // 显式关闭的账号：清理其存量自动卡片，保证开关关闭后立即下架
    disabled.forEach(o => { out = out.map(r => (r.type === 'finished' && r.auto && r.publisherUsername === o && !r.delisted ? { ...r, delisted: true, delistedAt: new Date().toISOString() } : r)); });
    let users: any[] = [];
    try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { /* ignore */ }
    owners.forEach(owner => {
      const pkeyName = `pageData_basic-data_product-list_${owner}`;
      const hasProdKey = localStorage.getItem(pkeyName) !== null;
      const rawProds = loadJson(pkeyName, []);
      const prods: any[] = Array.isArray(rawProds) ? rawProds : [];
      const groups = new Map<string, any>();
      // 过滤条件：产品种类=成品 + 商品状态=在售 + 款式编码非空 + 排除半成品脏数据（SEMI-前缀）+ 基础价≠0且大于成本价
      prods.filter(p => p.productType === '成品' && p.productStatus === '在售' && p.styleCode && !String(p.productCode || '').startsWith('SEMI-') && isPricePublishable(p)).forEach(p => { if (!groups.has(p.styleCode)) groups.set(p.styleCode, p); });
      // 下架清理：该账号不再在售的款式自动卡片打墓碑标记（全局键并集合并，物理删除会被其他账号合并复活）
      out = out.map(r => (r.type === 'finished' && r.auto && r.publisherUsername === owner && !r.delisted && !groups.has(r.styleCode) ? { ...r, delisted: true, delistedAt: new Date().toISOString() } : r));
      // 下架收敛：本地存在产品列表键时，不再在售款式的手动卡片同样打墓碑，保证下架状态跨账号收敛不被并集复活
      if (hasProdKey) out = out.map(r => (r.type === 'finished' && !r.auto && r.publisherUsername === owner && !r.delisted && !groups.has(r.styleCode) ? { ...r, delisted: true, delistedAt: new Date().toISOString() } : r));
      const u = users.find(x => x.username === owner);
      groups.forEach((p, sc) => {
        const exist = out.find(r => r.type === 'finished' && r.publisherUsername === owner && r.styleCode === sc);
        const resolvedImg = p.image || localStorage.getItem(`prodImg_${owner}_${p.key}`) || '';
        if (!exist) {
          out = [{
            key: `mkt_fin_${owner}_${sc}`, id: nextMarketId(out), type: 'finished', auto: true,
            publisherUsername: owner, publisherCompany: u?.companyName || owner, publishTime: new Date().toISOString(),
            status: '待报价', styleCode: sc, shortName: buildProductTitle(p), productCode: p.productCode,
            productKey: p.key, unit: p.unit || '件', quantity: Number(p.actualStock) || 0, targetPrice: Number(p.suggestedPrice) || 0,
            image: resolvedImg, productColor: p.color || '', variantImages: collectVariantImages(owner, prods, sc, p.key),
            variants: collectVariants(prods, sc),
            processTypes: [], quotes: [], remark: '系统自动上架（在售成品）',
          }, ...out];
        } else {
          out = out.map(r => (r.key === exist.key ? { ...r, delisted: false, delistedAt: undefined, shortName: buildProductTitle(p) || r.shortName, targetPrice: Number(p.suggestedPrice) || r.targetPrice, image: resolvedImg || r.image, productKey: p.key || r.productKey, productColor: p.color || r.productColor, variantImages: (() => { const vi = collectVariantImages(owner, prods, sc, p.key); return vi.length ? vi : (r.variantImages || []); })(), variants: (() => { const vv = collectVariants(prods, sc); return vv.length ? vv : (r.variants || []); })() } : r));
        }
      });
    });
    return out;
  }, []);

  // 成品页打开即聚合所有开启设置的账号（公开市场，不依赖对方登录）
  useEffect(() => {
    if (tab !== 'finished') return;
    setMarket(prev => {
      const swept = sweepFinished(prev);
      if (swept.length !== prev.length || swept.some((r, i) => r !== prev[i])) { saveJson(MARKET_KEY, swept); return swept; }
      return prev;
    });
  }, [tab, sweepFinished]);

  // IndexedDB → localStorage 图片同步：修复仅在 IndexedDB 中存在的图片（PlanDesignPage 早期上传未写 localStorage 的历史数据）
  useEffect(() => {
    if (tab !== 'finished') return;
    const syncAndResweep = async () => {
      let synced = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('pageData_basic-data_product-list_')) continue;
        const owner = k.slice('pageData_basic-data_product-list_'.length);
        const raw = loadJson(k, []);
        const prods: any[] = Array.isArray(raw) ? raw : [];
        for (const p of prods) {
          if (!p.key) continue;
          const lsKey = `prodImg_${owner}_${p.key}`;
          if (localStorage.getItem(lsKey)) continue; // 已存在，跳过
          const idbImg = await idbGet(p.key);
          if (idbImg) {
            try { localStorage.setItem(lsKey, idbImg); synced++; } catch { /* quota */ }
          }
        }
      }
      if (synced > 0) {
        // 同步后重新扫描，让市场卡片获得图片
        setMarket(prev => {
          const swept = sweepFinished(prev);
          if (swept.length !== prev.length || swept.some((r, idx) => r !== prev[idx])) { saveJson(MARKET_KEY, swept); return swept; }
          return prev;
        });
      }
    };
    syncAndResweep();
  }, [tab, sweepFinished]);

  // 图片回填：历史已发布卡片（手动发布/自动上架关闭时发布）的图片仅存于发布方本地 prodImg 键，
  // 而 prodImg_ 不参与服务器同步，导致其他账号看不到图片；此处把图片写回卡片记录（随 market_publish_orders 同步服务器）
  useEffect(() => {
    if (tab !== 'finished') return;
    let cancelled = false;
    (async () => {
      const list = loadJson(MARKET_KEY, []);
      const prods: any[] = loadJson(`pageData_basic-data_product-list_${owner}`, []);
      let changed = false;
      const updated: any[] = [];
      for (const r of list) {
        if (!r || r.type !== 'finished' || r.publisherUsername !== owner) { updated.push(r); continue; }
        let next = r;
        if (!next.image && next.productKey) {
          const src = prods.find((p: any) => p.key === next.productKey)?.image
            || localStorage.getItem(`prodImg_${owner}_${next.productKey}`)
            || await idbGet(next.productKey) || '';
          if (src) next = { ...next, image: src };
        }
        if (!next.productColor && next.productKey) {
          const pc = prods.find((p: any) => p.key === next.productKey)?.color || '';
          if (pc) next = { ...next, productColor: pc };
        }
        if ((!Array.isArray(next.variantImages) || next.variantImages.length === 0) && next.styleCode) {
          const vi: { key: string; color: string; src: string }[] = [];
          for (const p of prods.filter((p: any) => p.styleCode === next.styleCode && p.key && p.key !== next.productKey)) {
            const src = p.image || localStorage.getItem(`prodImg_${owner}_${p.key}`) || await idbGet(p.key) || '';
            if (src) vi.push({ key: p.key, color: p.color || '', src });
          }
          if (vi.length) next = { ...next, variantImages: vi };
        }
        // 存量卡片补嵌 SKU 规格明细：历史卡片无 variants 字段时回填，保证跨账号查看立即有明细
        if ((!Array.isArray(next.variants) || next.variants.length === 0) && next.styleCode) {
          const vv = collectVariants(prods, next.styleCode);
          if (vv.length) next = { ...next, variants: vv };
        }
        if (next !== r) changed = true;
        updated.push(next);
      }
      if (!cancelled && changed) { saveJson(MARKET_KEY, updated); setMarket(updated); }
    })();
    return () => { cancelled = true; };
  }, [tab, owner]);

  // 监听产品图片上传/修改事件，触发成品市场自动上架刷新
  useEffect(() => {
    const onImageUpdated = () => {
      if (tab !== 'finished') return;
      setMarket(prev => {
        const swept = sweepFinished(prev);
        if (swept.length !== prev.length || swept.some((r, i) => r !== prev[i])) { saveJson(MARKET_KEY, swept); return swept; }
        return prev;
      });
    };
    window.addEventListener('product-image-updated', onImageUpdated);
    return () => window.removeEventListener('product-image-updated', onImageUpdated);
  }, [tab, sweepFinished]);

  // 监听产品状态变更事件（研发完成等），触发成品市场自动上架刷新
  useEffect(() => {
    const onStatusUpdated = () => {
      if (tab !== 'finished') return;
      setMarket(prev => {
        const swept = sweepFinished(prev);
        if (swept.length !== prev.length || swept.some((r, i) => r !== prev[i])) { saveJson(MARKET_KEY, swept); return swept; }
        return prev;
      });
    };
    window.addEventListener('product-status-updated', onStatusUpdated);
    return () => window.removeEventListener('product-status-updated', onStatusUpdated);
  }, [tab, sweepFinished]);

  // 手动发布：打开弹窗，加载当前账号的在售成品列表（仅成品，排除半成品）
  const openManualPublish = useCallback(() => {
    const prods: any[] = loadJson(`pageData_basic-data_product-list_${owner}`, []);
    const finished = prods.filter(p => p.productType === '成品' && p.styleCode && !String(p.productCode || '').startsWith('SEMI-'));
    setManualPublishProducts(finished);
    setManualPublishSelected(new Set());
    setManualPublishVisible(true);
  }, [owner]);

  // 手动发布：确认发布选中的款式
  const handleManualPublish = useCallback(() => {
    if (manualPublishSelected.size === 0) { message.warning('请至少选择一个款式'); return; }
    const list = loadJson(MARKET_KEY, []);
    let out = [...list];
    const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x.username === owner);
    const styleCodes = Array.from(manualPublishSelected);
    let published = 0;
    let blocked = 0;
    styleCodes.forEach(sc => {
      // 检查是否已存在
      const exist = out.find((r: any) => r.type === 'finished' && r.publisherUsername === owner && r.styleCode === sc);
      if (exist && !exist.delisted) return;
      // 找该款式的一个代表产品（优先取符合价格资格的：基础价≠0且大于成本价）
      const rep = manualPublishProducts.find((p: any) => p.styleCode === sc && isPricePublishable(p)) || manualPublishProducts.find((p: any) => p.styleCode === sc);
      if (!rep) return;
      // 价格资格校验：基础价不等于 0 且大于成本价才能发布
      if (!isPricePublishable(rep)) { blocked++; return; }
      // 检查是否有图片
      const hasImage = rep.image || localStorage.getItem(`prodImg_${owner}_${rep.key}`);
      if (!hasImage) return; // 无图片不发布
      // 图片嵌入卡片记录：prodImg_ 不参与服务器同步，不嵌入则其他账号看不到图片
      const resolvedImg = rep.image || localStorage.getItem(`prodImg_${owner}_${rep.key}`) || '';
      // 已下架卡片重新发布：原位复活原记录（保留 key/id 与报价历史），清除墓碑标记
      if (exist) {
        out = out.map((r: any) => (r.key === exist.key ? {
          ...r, delisted: false, delistedAt: undefined, auto: false, publishTime: new Date().toISOString(),
          status: '待报价', shortName: buildProductTitle(rep), productCode: rep.productCode,
          productKey: rep.key, unit: rep.unit || '件', quantity: Number(rep.actualStock) || 0, targetPrice: Number(rep.suggestedPrice) || 0,
          image: resolvedImg, productColor: rep.color || '', variantImages: collectVariantImages(owner, manualPublishProducts, sc, rep.key),
          variants: collectVariants(manualPublishProducts, sc), remark: '手动发布到成品市场',
        } : r));
        published++;
        return;
      }
      out = [{
        key: `mkt_fin_${owner}_${sc}`, id: nextMarketId(out), type: 'finished', auto: false,
        publisherUsername: owner, publisherCompany: u?.companyName || owner, publishTime: new Date().toISOString(),
        status: '待报价', styleCode: sc, shortName: buildProductTitle(rep), productCode: rep.productCode,
        productKey: rep.key, unit: rep.unit || '件', quantity: Number(rep.actualStock) || 0, targetPrice: Number(rep.suggestedPrice) || 0,
        image: resolvedImg, productColor: rep.color || '', variantImages: collectVariantImages(owner, manualPublishProducts, sc, rep.key),
        variants: collectVariants(manualPublishProducts, sc),
        processTypes: [], quotes: [], remark: '手动发布到成品市场',
      }, ...out];
      published++;
    });
    if (published > 0) {
      saveJson(MARKET_KEY, out);
      setMarket(out);
      message.success(`成功发布 ${published} 个款式到成品市场${blocked > 0 ? `；${blocked} 个款式基础价为 0 或不大于成本价，未发布` : ''}`);
    } else {
      message.warning('所选款式已发布、无图片，或基础价为 0/不大于成本价，无法发布');
    }
    setManualPublishVisible(false);
    setManualPublishSelected(new Set());
  }, [manualPublishSelected, manualPublishProducts, owner]);

  // 成品编辑保存
  const handleSaveFinishedEdit = useCallback(() => {
    editFinishedForm.validateFields().then(values => {
      const list = loadJson(MARKET_KEY, []);
      const updated = list.map((r: any) => {
        if (r.key !== detailRec.key) return r;
        return { ...r, shortName: values.shortName, targetPrice: Number(values.targetPrice) || 0, unit: values.unit || '件' };
      });
      saveJson(MARKET_KEY, updated);
      setMarket(updated);
      // 同步更新 detailRec
      setDetailRec({ ...detailRec, shortName: values.shortName, targetPrice: Number(values.targetPrice) || 0, unit: values.unit || '件' });
      message.success('编辑保存成功');
      setEditFinishedVisible(false);
    }).catch(() => message.warning('请完善必填字段'));
  }, [editFinishedForm, detailRec]);

  const persist = useCallback((list: any[]) => { saveJson(MARKET_KEY, list); setMarket(list); }, []);
  
  // ============ 我的货盘 ============
  const INVENTORY_KEY = `market_inventory_lists_${owner}`;
  const SHARED_INVENTORY_KEY = 'market_shared_inventories'; // 全局共享的货盘数据
  
  const loadInventoryLists = useCallback(() => {
    const lists = loadJson(INVENTORY_KEY, []);
    setInventoryLists(lists);
  }, [owner]);
  
  useEffect(() => {
    if (tab === 'inventory') loadInventoryLists();
  }, [tab, loadInventoryLists]);

  // 我的货盘：进入标签页时加载店铺横幅图
  useEffect(() => {
    if (tab === 'inventory') setInvBanner(localStorage.getItem(`inventoryBanner_${username}`) || '');
  }, [tab, username]);

  // 聊天未读数轮询
  useEffect(() => {
    const loadUnread = () => { fetchUnreadCount().then((n: number) => setChatUnread(n)); };
    loadUnread();
    const unsub = onChatNewMessage(() => loadUnread());
    const iv = setInterval(loadUnread, 30000);
    return () => { unsub(); clearInterval(iv); };
  }, []);

  // 我的货盘：上传/删除店铺横幅图（货盘公开分享页公司表头背景）
  const handleInvBannerFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl) return;
      setInvBanner(dataUrl);
      try {
        localStorage.setItem(`inventoryBanner_${username}`, dataUrl);
        saveDataset(`inventoryBanner_${username}`, JSON.stringify(dataUrl));
        message.success('店铺横幅已更新，货盘分享页表头将展示该背景图');
      } catch { message.warning('图片过大保存失败，请更换较小的图片'); }
    };
    reader.readAsDataURL(file);
  };
  const handleInvBannerRemove = () => {
    setInvBanner('');
    try {
      localStorage.removeItem(`inventoryBanner_${username}`);
      saveDataset(`inventoryBanner_${username}`, JSON.stringify(''));
    } catch { /* ignore */ }
    message.success('店铺横幅已删除，分享页表头将使用系统默认背景');
  };
  
  const generateShareCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'INV-';
    for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
  };
  
  const createInventoryList = (name: string, productKeys: string[]) => {
    const shareCode = generateShareCode();
    const newList = {
      id: Date.now().toString(),
      name,
      productKeys,
      shareCode,
      createdAt: new Date().toISOString(),
      supplierName: companyName,
      supplierUsername: username,
    };
    const lists = loadJson(INVENTORY_KEY, []);
    lists.push(newList);
    saveJson(INVENTORY_KEY, lists);
    // 同时保存到全局共享存储，供采购商访问
    const shared = loadJson(SHARED_INVENTORY_KEY, []);
    shared.push({ ...newList, products: getProductsByKeys(productKeys) });
    saveJson(SHARED_INVENTORY_KEY, shared);
    setInventoryLists(lists);
    // 自动切换到新创建的货盘
    setCurrentInventoryId(newList.id);
    message.success(`货盘「${name}」创建成功，分享码：${shareCode}`);
    return shareCode;
  };
  
  const getProductsByKeys = (productKeys: string[]): any[] => {
    // 从成品市场数据中查找对应的产品，并补齐图片与供应商字段（供采购商端快照展示）
    const finished = market.filter(r => r.type === 'finished');
    return productKeys.map(key => {
      const p = finished.find(x => x.key === key);
      if (!p) return null;
      return {
        ...p,
        image: p.image || imgOf(p.publisherUsername, { key: p.productKey }),
        supplierName: p.publisherCompany || p.supplierName || '',
      };
    }).filter(Boolean);
  };
  
  const deleteInventoryList = (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '删除后该货盘将无法恢复，分享链接也将失效，是否继续？',
      okText: '确认删除',
      cancelText: '取消',
      onOk: () => {
        const lists = loadJson(INVENTORY_KEY, []).filter((l: any) => l.id !== id);
        saveJson(INVENTORY_KEY, lists);
        // 同时从全局共享存储中移除
        const shared = loadJson(SHARED_INVENTORY_KEY, []).filter((s: any) => s.id !== id);
        saveJson(SHARED_INVENTORY_KEY, shared);
        setInventoryLists(lists);
        // 如果删除的是当前查看的货盘，重置为显示全部
        if (currentInventoryId === id) {
          setCurrentInventoryId(null);
        }
        message.success('货盘已删除');
      },
    });
  };
  
  // 编辑货盘名称
  const handleEditInventory = (list: any) => {
    setEditInventoryData(list);
    setEditInventoryVisible(true);
  };
  
  const saveEditInventory = (newName: string) => {
    if (!editInventoryData) return;
    const lists = loadJson(INVENTORY_KEY, []).map((l: any) => 
      l.id === editInventoryData.id ? { ...l, name: newName } : l
    );
    saveJson(INVENTORY_KEY, lists);
    // 同步更新全局共享存储
    const shared = loadJson(SHARED_INVENTORY_KEY, []).map((s: any) => 
      s.id === editInventoryData.id ? { ...s, name: newName } : s
    );
    saveJson(SHARED_INVENTORY_KEY, shared);
    setInventoryLists(lists);
    setEditInventoryVisible(false);
    setEditInventoryData(null);
    message.success('货盘名称已更新');
  };
  
  // 添加商品到货盘
  const handleAddProducts = (list: any) => {
    setAddProductsInventoryId(list.id);
    setAddProductsVisible(true);
  };
  
  const saveAddProducts = (newProductKeys: string[]) => {
    if (!addProductsInventoryId) return;
    const lists = loadJson(INVENTORY_KEY, []).map((l: any) => {
      if (l.id === addProductsInventoryId) {
        // 合并新旧商品key，去重
        const mergedKeys = Array.from(new Set([...(l.productKeys || []), ...newProductKeys]));
        return { ...l, productKeys: mergedKeys };
      }
      return l;
    });
    saveJson(INVENTORY_KEY, lists);
    // 同步更新全局共享存储
    const shared = loadJson(SHARED_INVENTORY_KEY, []).map((s: any) => {
      if (s.id === addProductsInventoryId) {
        const mergedKeys = Array.from(new Set([...(s.productKeys || []), ...newProductKeys]));
        return { ...s, productKeys: mergedKeys, products: getProductsByKeys(mergedKeys) };
      }
      return s;
    });
    saveJson(SHARED_INVENTORY_KEY, shared);
    setInventoryLists(lists);
    setAddProductsVisible(false);
    setAddProductsInventoryId(null);
    message.success('商品已添加到货盘');
  };
  
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [currentShareList, setCurrentShareList] = useState<any>(null);
  
  const showShareModal = (list: any) => {
    setCurrentShareList(list);
    setShareModalVisible(true);
  };
  
  const loadSharedInventory = (code: string) => {
    if (!code.trim()) {
      message.warning('请输入分享码');
      return;
    }
    const shared = loadJson(SHARED_INVENTORY_KEY, []);
    const found = shared.find((s: any) => s.shareCode === code.trim());
    if (found) {
      setSharedInventory(found);
      message.success(`已加载货盘「${found.name}」`);
    } else {
      message.error('未找到该分享码对应的货盘');
      setSharedInventory(null);
    }
  };

  // 分享链接直达：从 URL 参数读取 shareCode 自动加载货盘
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const sc = params.get('shareCode');
      if (sc && sc.trim()) {
        setTab('inventory');
        setShareCodeInput(sc.trim());
        const shared = loadJson(SHARED_INVENTORY_KEY, []);
        const found = shared.find((s: any) => s.shareCode === sc.trim());
        if (found) {
          setSharedInventory(found);
          message.success(`已通过分享链接加载货盘「${found.name}」`);
        } else {
          setSharedInventory(null);
          message.warning('未找到该分享码对应的货盘，可能已被删除');
        }
        // 清除 URL 参数，避免刷新重复加载
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch { /* ignore */ }
  }, []);

  // ============ 发包市场：发布/编辑 ============
  const handlePubImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setPubImage(result);
    };
    reader.readAsDataURL(file);
  };

  const handlePubPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const cd = e.clipboardData as DataTransfer | undefined;
    const items = Array.from(cd?.items || []);
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) handlePubImageFile(f);
        break;
      }
    }
  };

  const handlePubCamera = () => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const modal = Modal.confirm({
      title: '拍照',
      content: (
        <div style={{ textAlign: 'center' }}>
          <video ref={el => { if (el) { el.srcObject = (modal as any).stream; el.play(); } }} style={{ width: '100%', maxHeight: 300, background: '#000' }} />
          <div style={{ marginTop: 12 }}>
            <Button type="primary" onClick={() => {
              const v = (modal as any).videoEl as HTMLVideoElement;
              if (v && v.videoWidth) {
                canvas.width = v.videoWidth;
                canvas.height = v.videoHeight;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  ctx.drawImage(v, 0, 0);
                  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                  setPubImage(dataUrl);
                  modal.destroy();
                  if ((modal as any).stream) {
                    (modal as any).stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
                  }
                }
              }
            }}>拍照</Button>
            <Button onClick={() => {
              modal.destroy();
              if ((modal as any).stream) {
                (modal as any).stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
              }
            }} style={{ marginLeft: 8 }}>取消</Button>
          </div>
        </div>
      ),
      footer: null,
      width: 400,
    });
    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      (modal as any).stream = stream;
      const v = document.querySelector('video');
      if (v) {
        v.srcObject = stream;
        v.play();
        (modal as any).videoEl = v;
      }
    }).catch(() => message.error('无法访问摄像头'));
  };

  const handlePublish = useCallback(() => {
    pubForm.validateFields().then(values => {
      if (!pubImage) {
        message.warning('请上传图片');
        return;
      }
      const list = loadJson(MARKET_KEY, []);
      const now = new Date().toISOString();
      if (pubEdit) {
        const updated = list.map((r: any) => (r.key === pubEdit.key ? {
          ...r, shortName: values.shortName, styleCode: values.styleCode, productCode: values.productCode || '',
          unit: values.unit || '件', quantity: Number(values.quantity) || 0, targetPrice: Number(values.targetPrice) || 0,
          deadline: values.deadline ? dayjs(values.deadline).format('YYYY-MM-DD') : '', processTypes: values.processTypes || [],
          deposit: Number(values.deposit) || 0, remark: values.remark || '', editTime: now,
        } : r));
        persist(updated);
        // 保存图片
        localStorage.setItem(`pubImg_${username}_${pubEdit.key}`, pubImage);
        message.success('发布信息已修改');
      } else {
        const key = `mkt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        list.unshift({
          key, id: nextMarketId(list), type: 'semi',
          publisherUsername: username, publisherCompany: companyName, publishTime: now, status: '待报价',
          shortName: values.shortName, styleCode: values.styleCode, productCode: values.productCode || '',
          unit: values.unit || '件', quantity: Number(values.quantity) || 0, targetPrice: Number(values.targetPrice) || 0,
          deadline: values.deadline ? dayjs(values.deadline).format('YYYY-MM-DD') : '', processTypes: values.processTypes || [],
          deposit: Number(values.deposit) || 0, depositStatus: Number(values.deposit) > 0 ? '需缴纳' : undefined,
          remark: values.remark || '', quotes: [],
        });
        persist(list);
        // 保存图片
        localStorage.setItem(`pubImg_${username}_${key}`, pubImage);
        message.success('发包订单已发布到商机市场');
      }
      setPubVisible(false); setPubEdit(null); pubForm.resetFields(); setPubImage('');
    }).catch(() => message.warning('请完善必填字段'));
  }, [pubForm, pubEdit, username, companyName, persist, pubImage]);

  // ============ 报价/询价提交（加工厂/采购商） ============
  const handleQuote = useCallback(() => {
    quoteForm.validateFields().then(values => {
      const list = loadJson(MARKET_KEY, []);
      const updated = list.map((r: any) => {
        if (r.key !== quoteRec.key) return r;
        const quotes = [...(r.quotes || [])];
        const unitPrice = Number(values.unitPrice) || 0;
        const entry = {
          key: `q_${username}_${Date.now()}`, bidderUsername: username, bidderCompany: companyName,
          unitPrice, totalPrice: unitPrice * (Number(r.quantity) || 0), deliveryDays: Number(values.deliveryDays) || 0,
          quantity: Number(values.quantity) || 0, remark: values.remark || '',
          contactPerson: values.contactPerson || '', contactPhone: values.contactPhone || '',
          quoteTime: new Date().toISOString(), status: '待确认',
        };
        const i = quotes.findIndex((q: any) => q.bidderUsername === username);
        if (i >= 0) quotes[i] = { ...entry, key: quotes[i].key }; else quotes.push(entry);
        return { ...r, quotes, status: r.status === '待报价' ? '报价中' : r.status };
      });
      persist(updated);
      setQuoteRec(null); quoteForm.resetFields();
      message.success('报价已提交，发布方可在报价记录中查看');
    }).catch(() => message.warning('请完善必填字段'));
  }, [quoteForm, quoteRec, username, companyName, persist]);

  // ============ 确认中标：建合作 + 推送加工订单（来源=发包市场） + 回写来源单 ============
  const handleAward = useCallback((order: any, quoteKey: string) => {
    const q = (order.quotes || []).find((x: any) => x.key === quoteKey);
    if (!q) { message.warning('请选择中标报价'); return; }
    const list = loadJson(MARKET_KEY, []);
    const now = new Date().toISOString();
    const srcKey = order.sourceOrderKey || order.key;
    const updated = list.map((r: any) => (r.key === order.key ? {
      ...r, status: '已中标', wonQuoteKey: quoteKey, wonFactoryUsername: q.bidderUsername, wonFactoryCompany: q.bidderCompany, wonAt: now,
      quotes: (r.quotes || []).map((x: any) => ({ ...x, status: x.key === quoteKey ? '中标' : '落选' })),
    } : r));
    persist(updated);
    // 1) 自动建立合作：写入发布方 contract_factories 列表
    const ck = `contract_factories_${order.publisherUsername}`;
    let clist: any[] = loadJson(ck, []);
    const exist = clist.find((d: any) => d.factoryUsername === q.bidderUsername || (d.factoryName || '').trim() === (q.bidderCompany || '').trim());
    if (exist) {
      clist = clist.map((d: any) => (d === exist ? { ...d, status: '合作中', cooperateDate: dayjs().format('YYYY-MM-DD'), factoryUsername: d.factoryUsername || q.bidderUsername } : d));
    } else {
      const seq = clist.reduce((m: number, d: any) => { const n = Number(String(d.factoryNo || '').replace(/\D/g, '')); return isNaN(n) ? m : Math.max(m, n); }, 0) + 1;
      clist.unshift({
        key: `fac_${Date.now()}`, factoryNo: `DGJ-${String(seq).padStart(6, '0')}`, factoryName: q.bidderCompany,
        factoryUsername: q.bidderUsername, contactPerson: q.contactPerson || '', contactPhone: q.contactPhone || '',
        processTypes: order.processTypes || [], status: '合作中', cooperateDate: dayjs().format('YYYY-MM-DD'),
        creator: order.publisherUsername, createdAt: dayjs().format('YYYY-MM-DD HH:mm'), remark: `商机市场中标自动建立合作（${order.id}）`,
      });
    }
    saveJson(ck, clist);
    // 2) 推送加工订单到中标加工厂（orderSource=发包市场，pushRef 去重）
    const fkey = `pageData_production_processing-order_${q.bidderUsername}`;
    let flist: any[] = loadJson(fkey, []);
    const ref = `${srcKey}@${order.publisherUsername}`;
    const copy = {
      key: `${srcKey}_from_${order.publisherUsername}`, pushRef: ref, id: order.sourceOrderId || `JG-MKT-${String(order.id || '').replace(/\D/g, '')}`,
      poId: order.sourcePoId || '', styleCode: order.styleCode, shortName: order.shortName, productCode: order.productCode,
      unit: order.unit, perPairQty: 1, planQty: order.quantity, totalQty: order.quantity, price: q.unitPrice,
      subtotal: (Number(q.unitPrice) || 0) * (Number(order.quantity) || 0), factoryName: q.bidderCompany, factoryUsername: q.bidderUsername,
      status: '已推送', pushedAt: now, orderSource: '发包市场', sourceSupplier: order.publisherUsername,
      sourceSupplierName: order.publisherCompany, createTime: now, operator: order.publisherCompany,
    };
    const fi = flist.findIndex((f: any) => f.pushRef === ref);
    if (fi >= 0) flist[fi] = copy; else flist.push(copy);
    saveJson(fkey, flist);
    // 3) 回写发布方来源加工订单（如有）
    if (order.sourceOrderKey) {
      const skey = `pageData_production_processing-order_${order.publisherUsername}`;
      const slist: any[] = loadJson(skey, []);
      saveJson(skey, slist.map((s: any) => (s.key === order.sourceOrderKey ? { ...s, status: '已推送', factoryName: q.bidderCompany, factoryUsername: q.bidderUsername, orderSource: '发包市场', pushedAt: now } : s)));
    }
    setDetailRec(null); setWonQuoteKey('');
    message.success(`已确认中标：合作建立 + 加工订单已推送「${q.bidderCompany}」（来源=发包市场）`);
  }, [persist]);

  // 关闭发包 / 扣罚保证金
  const handleClose = useCallback((rec: any) => {
    persist(loadJson(MARKET_KEY, []).map((r: any) => (r.key === rec.key ? { ...r, status: '已关闭' } : r)));
    message.success('发包订单已关闭');
  }, [persist]);
  const handleDeduct = useCallback((rec: any) => {
    Modal.confirm({
      title: `扣罚保证金 ¥${rec.deposit || 0}？`, content: '中标违约时扣罚保证金，扣罚后状态不可恢复',
      onOk: () => {
        persist(loadJson(MARKET_KEY, []).map((r: any) => (r.key === rec.key ? { ...r, depositStatus: '已扣罚', deductReason: '中标违约扣罚' } : r)));
        message.success('保证金已扣罚');
      },
    });
  }, [persist]);

  // ============ 成品市场：设置/收藏/购物车/比价 ============
  const toggleAuto = useCallback((v: boolean) => {
    setAutoOn(v);
    saveJson(`market_settings_${owner}`, { autoPublishOnSale: v });
    message.success(v ? '已开启：在售成品将自动上架成品市场' : '已关闭自动上架');
  }, [owner]);
  const toggleFav = useCallback((rec: any) => {
    setFavorites(prev => {
      const exist = prev.some(f => f.cardKey === rec.key);
      const next = exist ? prev.filter(f => f.cardKey !== rec.key) : [...prev, { cardKey: rec.key, styleCode: rec.styleCode, addTime: new Date().toISOString() }];
      saveJson(`market_favorites_${username}`, next);
      message.success(exist ? '已取消收藏' : '已加入收藏夹');
      return next;
    });
  }, [username]);
    // 是否自己公司的商品（同账号或同公司均视为自己的商品，不可加购下单）
  const isOwnProduct = useCallback((rec: any): boolean => {
    if (!rec) return false;
    if (rec.publisherUsername === owner) return true;
    if (rec.publisherUsername === username) return true;
    const pubCompany = String(rec.publisherCompany || resolveCompany(rec.publisherUsername) || '').trim();
    const myCompany = String(companyName || resolveCompany(username) || '').trim();
    return !!(pubCompany && myCompany && pubCompany === myCompany);
  }, [username, companyName]);
const addToCart = useCallback((rec: any, qty?: number) => {
    // 禁止将自己公司的商品加入购物车
    if (isOwnProduct(rec)) { message.warning('不能添加自己公司的商品到购物车'); return; }
    // 成品市场：弹窗显示商品明细供选择，输入数量后确认加入购物车
    if (rec && rec.type === 'finished') {
      setAddToCartModalRec(rec);
      setAddToCartColor('');
      setAddToCartSkuQty({});
      setAddToCartImg(rec.image || imgOf(rec.publisherUsername, { key: rec.productKey }));
      const prods: any[] = loadJson(`pageData_basic-data_product-list_${rec.publisherUsername}`, []);
      const localVars = prods.filter(p => p.styleCode === rec.styleCode);
      // 跨账号回退：查看方本地无发布方产品列表键时，用卡片内嵌的 SKU 规格明细
      const vars: any[] = localVars.length ? localVars : (Array.isArray(rec.variants) ? rec.variants : []);
      setAddToCartVariants(vars);
      return;
    }
    setCart(prev => {
      const exist = prev.find(f => f.cardKey === rec.key);
      const next = exist
        ? prev.map(f => (f.cardKey === rec.key ? { ...f, quantity: (Number(f.quantity) || 0) + (qty || 1) } : f))
        : [...prev, { cardKey: rec.key, styleCode: rec.styleCode, quantity: qty || 1, addTime: new Date().toISOString() }];
      saveJson(`market_cart_${username}`, next);
      message.success('已加入购物车');
      return next;
    });
  }, [username, isOwnProduct]);
  const cartItemKey = useCallback((c: any) => c.itemKey || c.cardKey, []);

  // 成品详情 / 加购弹窗：SKU 输入数量确认后加入购物车（货品明细含图片/颜色/规格/单价）
  const handleAddSkusToCart = useCallback((source?: 'detail' | 'addCart') => {
    const qtyMap = source === 'addCart' ? addToCartSkuQty : skuQty;
    const variants = source === 'addCart' ? addToCartVariants : detailVariants;
    const rec = source === 'addCart' ? addToCartModalRec : detailRec;
    // 禁止将自己公司的商品加入购物车
    if (isOwnProduct(rec)) { message.warning('不能添加自己公司的商品到购物车'); return; }
    const entries = Object.entries(qtyMap).filter(([, q]) => (Number(q) || 0) > 0);
    if (!entries.length) { message.warning('请先在规格明细中输入采购数量'); return; }
    const owner = rec?.publisherUsername || '';
    setCart(prev => {
      let next = [...prev];
      entries.forEach(([pk, q]) => {
        const v = variants.find(x => x.key === pk);
        if (!v) return;
        const ik = `${rec.key}_${v.productCode}`;
        const exist = next.find(f => (f.itemKey || f.cardKey) === ik);
        if (exist) next = next.map(f => ((f.itemKey || f.cardKey) === ik ? { ...f, quantity: (Number(f.quantity) || 0) + (Number(q) || 0) } : f));
        else next.push({
          itemKey: ik, cardKey: rec.key, styleCode: rec.styleCode, quantity: Number(q) || 0, addTime: new Date().toISOString(),
          sku: { productKey: v.key, productCode: v.productCode, color: v.color || '', spec: v.spec || '', unitPrice: Number(v.suggestedPrice) || 0, image: imgOf(owner, v) || embeddedSrcOf(rec, v.color || ''), shortName: rec.shortName, unit: v.unit || rec.unit || '件' },
        });
      });
      saveJson(`market_cart_${username}`, next);
      return next;
    });
    if (source === 'addCart') {
      setAddToCartSkuQty({});
      setAddToCartModalRec(null);
    } else {
      setSkuQty({});
      setDetailRec(null);
    }
    message.success('已加入购物车，可在购物车勾选后批量询价或立即下单');
  }, [skuQty, detailRec, detailVariants, addToCartSkuQty, addToCartModalRec, addToCartVariants, username, isOwnProduct]);

  // 购物车按供应商分组（勾选/删除/下单用）
  const cartGroups = useMemo(() => {
    const map = new Map<string, { rec: any; items: any[] }>();
    cart.forEach(c => {
      const rec = market.find(r => r.key === c.cardKey);
      if (!rec) return;
      const g = map.get(rec.publisherUsername) || { rec, items: [] };
      g.items.push({ ...c, _key: c.itemKey || c.cardKey });
      map.set(rec.publisherUsername, g);
    });
    return Array.from(map.entries());
  }, [cart, market]);
  const checkedItems = useMemo(() => cart.filter(c => cartChecked.includes(c.itemKey || c.cardKey)), [cart, cartChecked]);
  const toggleGroupCheck = useCallback((keys: string[], on: boolean) => {
    setCartChecked(prev => (on ? Array.from(new Set([...prev, ...keys])) : prev.filter(k => !keys.includes(k))));
  }, []);

  // 立即下单：地址默认注册账号地址可修改
  const handleOpenOrder = useCallback(() => {
    if (!checkedItems.length) { message.warning('请先勾选要下单的商品'); return; }
    let u: any = null;
    try { u = (JSON.parse(localStorage.getItem('registeredUsers') || '[]')).find((x: any) => x.username === username); } catch { /* ignore */ }
    orderForm.setFieldsValue({
      province: u?.province || '', city: u?.city || '', district: u?.district || '', addressDetail: u?.addressDetail || '',
      contactPerson: u?.contactPerson || '', contactPhone: u?.phone || '', remark: '',
    });
    setOrderVisible(true);
  }, [checkedItems, username, orderForm]);
  const handleConfirmOrder = useCallback(() => {
    orderForm.validateFields().then(() => { setOrderVisible(false); setPayShot(''); setPayVisible(true); }).catch(() => message.warning('请完善收货信息'));
  }, [orderForm]);

  // === 供应商剩余额度计算（与 MarketOrdersPage / PurchaserSupplierList 同口径） ===
  const calcSupplierCredit = useCallback((supplierUsername: string): number => {
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const me = users.find(u => u.username === username);
      const myName = String(me?.companyName || username || '');
      const custs: any[] = JSON.parse(localStorage.getItem('customers_' + supplierUsername) || '[]');
      const bps: any[] = JSON.parse(localStorage.getItem('boundPurchasers_' + supplierUsername) || '[]');
      let base = 0;
      let adjId = '';
      let adjName = myName;
      const bp = bps.find((b: any) => b.purchaserUsername === username || (myName && b.purchaserName === myName));
      if (bp) {
        const linked = bp.customerId ? custs.find((c: any) => c.id === bp.customerId) : null;
        base = bp.credit !== undefined && bp.credit !== null ? Number(bp.credit) || 0 : Number(linked?.credit) || 0;
        adjId = bp.id || '';
        adjName = bp.purchaserName || myName;
      } else {
        const c = custs.find((c: any) => myName && c.name === myName);
        if (c) { base = Number(c.credit) || 0; adjId = c.id; adjName = c.name; }
      }
      const adjs: any[] = JSON.parse(localStorage.getItem('credit_adjustments_' + supplierUsername) || '[]');
      const net = adjs.filter((r: any) => (adjId && r.customerId === adjId) || (adjName && r.customerName === adjName))
        .reduce((sum: number, r: any) => sum + (r.type === 'increase' ? r.amount : -r.amount), 0);
      return Math.round((base + net) * 100) / 100;
    } catch { return 0; }
  }, [username]);

  const calcSupplierOccupation = useCallback((supplierUsername: string): number => {
    try {
      const orders: any[] = loadJson(TRADE_KEY, []);
      return orders.filter((o: any) => o.supplierUsername === supplierUsername && o.status === '已推送')
        .reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
    } catch { return 0; }
  }, []);

  const getSupplierPaySummary = useCallback((supplierUsername: string): { purchaseTotal: number; paidTotal: number } | null => {
    try {
      const summaryKey = `supplier_pay_summary_${supplierUsername}`;
      const raw = localStorage.getItem(summaryKey);
      if (!raw) return null;
      const summary = JSON.parse(raw);
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const me = users.find(u => u.username === username);
      const myName = String(me?.companyName || username || '');
      return summary[myName] || null;
    } catch { return null; }
  }, [username]);

  const getSupplierAvailableCredit = useCallback((supplierUsername: string): number => {
    const credit = calcSupplierCredit(supplierUsername);
    const occ = calcSupplierOccupation(supplierUsername);
    const ps = getSupplierPaySummary(supplierUsername);
    const due = ps ? (ps.purchaseTotal - ps.paidTotal) / 100 : 0;
    return Math.round((credit - occ - due) * 100) / 100;
  }, [calcSupplierCredit, calcSupplierOccupation, getSupplierPaySummary]);

  // 确认付款：按供应商生成交易订单 + 推送供应商订单管理
  const handleConfirmPay = useCallback(() => {
    const vals = orderForm.getFieldsValue();
    // 时间格式与订单管理一致（zh-CN 本地化字符串）
    const now = new Date().toLocaleString('zh-CN');
    const orders = loadJson(TRADE_KEY, []);
    const bySup = new Map<string, any[]>();
    checkedItems.forEach(c => {
      const rec = market.find(r => r.key === c.cardKey);
      if (!rec) return;
      const arr = bySup.get(rec.publisherUsername) || [];
      arr.push({ ...c, _rec: rec });
      bySup.set(rec.publisherUsername, arr);
    });
    let users: any[] = [];
    try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { /* ignore */ }
    // 客户名称取客户公司名称：注册账号 companyName 优先，缺失回退本地 companyName
    const purUser = users.find((x: any) => x.username === username);
    const purCompany = purUser?.companyName || companyName;
    let seq = orders.reduce((m: number, o: any) => { const n = Number(String(o.id || '').replace(/\D/g, '')); return isNaN(n) ? m : Math.max(m, n); }, 0);
    let cnt = 0;
    const addr = [vals.province, vals.city, vals.district, vals.addressDetail].filter(Boolean).join(' ');
    const remark = vals.remark || '';
    bySup.forEach((items, sup) => {
      seq += 1; cnt += 1;
      const oid = `PO-MKT-${String(seq).padStart(6, '0')}`;
      const lineItems = items.map((c: any) => ({
        productKey: c.sku?.productKey || c.cardKey, productCode: c.sku?.productCode || c._rec.productCode || '',
        shortName: c.sku?.shortName || c._rec.shortName || '', styleCode: c.styleCode, color: c.sku?.color || '', spec: c.sku?.spec || '',
        unitPrice: Number(c.sku?.unitPrice ?? c._rec.targetPrice) || 0, quantity: Number(c.quantity) || 0,
        subtotal: (Number(c.sku?.unitPrice ?? c._rec.targetPrice) || 0) * (Number(c.quantity) || 0),
        image: c.sku?.image || imgOf(sup, { key: c._rec.productKey, image: c._rec.image }),
      }));
      const total = lineItems.reduce((s: number, x: any) => s + x.subtotal, 0);
      const supUser = users.find((x: any) => x.username === sup);
      // 付款方式：银行转账 / 余额支付
      const payMethod = payMethodMap[sup] || '银行转账';
      // 付款账户勾选：银行账户/收款码二选一（默认银行账户，缺失时回退收款码）
      const channel = payChannelMap[sup] || (supUser?.payBankInfo ? 'bank' : 'qr');
      const payAccountText = channel === 'bank' ? (supUser?.payBankInfo || '') : '收款码收款';

      // === 余额支付校验 ===
      if (payMethod === '余额支付') {
        const availableCredit = getSupplierAvailableCredit(sup);
        if (availableCredit < total) {
          message.error(`供应商剩余额度 ¥${availableCredit.toFixed(2)} 不足以支付本单 ¥${total.toFixed(2)}，无法确认付款`);
          return;
        }
      } else {
        // 银行转账：必须上传付款截图
        if (!payShot) { message.warning('请先上传付款转账截图'); return; }
      }

      const order = {
        key: `trade_${Date.now()}_${sup}`, id: oid, purchaserUsername: username, purchaserCompany: purCompany,
        // 付款账户勾选结果同步落库，供存量订单回填与财务审核展示
        payChannel: channel, payAccount: payAccountText,
        supplierUsername: sup, supplierCompany: supUser?.companyName || sup, items: lineItems, totalAmount: total,
        address: addr, contactPerson: vals.contactPerson || '', contactPhone: vals.contactPhone || '',
        remark, buyerMessage: remark,
        payShot, status: '已付款', orderSource: '成品市场', createTime: now, payTime: now,
      };
      orders.unshift(order);
      const okey = `pageData_sales_order-manage_${sup}`;
      const olist = loadJson(okey, []);
      // 余额支付标签
      const orderTags = payMethod === '余额支付' ? '余额支付' : '';
      olist.unshift({
        key: order.key, id: oid, orderStatus: '已付款', auditStatus: '待财务审核', customerName: purCompany, person: vals.contactPerson || '',
        // 付款截图同步写入供应商订单，财务审核详情/列表可见
        payScreenshot: payShot,
        // 付款账户（勾选的银行账户/收款码）同步写入，财务审核付款账户列可见
        payAccount: payAccountText,
        // 货品明细唯一读取源：必须同步写 orderItems（JSON 字符串），仅写 productDetail 会导致订单详情/明细弹窗无商品
        orderItems: JSON.stringify(lineItems.map((x: any) => ({
          productCode: x.productCode || x.styleCode || '', shortName: x.shortName || '', styleCode: x.styleCode || '',
          color: x.color || '', spec: x.spec || '', quantity: x.quantity || 0, price: x.unitPrice || 0, amount: x.subtotal || 0, image: x.image || '',
        }))),
        productDetail: lineItems.map((x: any) => `${x.shortName}${x.color ? '-' + x.color : ''}${x.spec ? '-' + x.spec : ''}×${x.quantity}`).join('，'),
        palletCount: lineItems.length, productAmount: total, paidAmount: total, payMethod,
        // 余额支付标签同步写入
        orderTag: orderTags, orderTags,
        receiverName: vals.contactPerson || '', receiverAddress: addr, orderSource: '成品市场',
        createTime: now, payTime: now, buyerMessage: remark || '成品市场下单',
      });
      saveJson(okey, olist);
      // 已付款订单推送后：同步该供应商商品列表的订单占用数
      syncOrderReserved(sup);
    });
    saveJson(TRADE_KEY, orders);
    const orderedKeys = new Set(checkedItems.map(c => c.itemKey || c.cardKey));
    const nextCart = cart.filter(c => !orderedKeys.has(c.itemKey || c.cardKey));
    setCart(nextCart); saveJson(`market_cart_${username}`, nextCart);
    setCartChecked([]);
    setPayVisible(false); setCartVisible(false);
    setPayChannelMap({}); setPayMethodMap({});
    message.success(`下单完成：生成 ${cnt} 笔订单，已推送对应供应商订单管理`);
  }, [payShot, orderForm, checkedItems, market, cart, username, companyName, payChannelMap, payMethodMap, getSupplierAvailableCredit]);

  const cartBatchQuote = useCallback(() => {
    const targets = checkedItems.length ? checkedItems : cart;
    if (!targets.length) { message.warning('购物车为空或请先勾选商品'); return; }
    const cardKeys = Array.from(new Set(targets.map(c => c.cardKey)));
    const list = loadJson(MARKET_KEY, []);
    const now = new Date().toISOString();
    const updated = list.map((r: any) => {
      if (!cardKeys.includes(r.key)) return r;
      const qty = targets.filter(c => c.cardKey === r.key).reduce((s: number, c: any) => s + (Number(c.quantity) || 0), 0);
      const quotes = [...(r.quotes || [])];
      const entry = {
        key: `q_${username}_${Date.now()}_${r.key}`, bidderUsername: username, bidderCompany: companyName,
        unitPrice: 0, totalPrice: 0, deliveryDays: 0, quantity: qty || 0,
        remark: '购物车批量询价', contactPerson: '', contactPhone: '', quoteTime: now, status: '待确认',
      };
      const i = quotes.findIndex((q: any) => q.bidderUsername === username);
      if (i >= 0) quotes[i] = { ...entry, key: quotes[i].key }; else quotes.push(entry);
      return { ...r, quotes, status: r.status === '待报价' ? '报价中' : r.status };
    });
    persist(updated);
    setCartVisible(false);
    message.success(`已对 ${cardKeys.length} 个商品发起询价`);
  }, [checkedItems, cart, username, companyName, persist]);

  // ============ 合同打印 ============
  const handlePrintContract = useCallback((rec: any) => {
    const q = (rec.quotes || []).find((x: any) => x.key === rec.wonQuoteKey) || {};
    const html = `<!DOCTYPE html><html><head><title>成交合同 ${rec.id}</title><style>
      body{font-family:'Microsoft YaHei',sans-serif;padding:40px;color:#222}
      h1{text-align:center;letter-spacing:6px} .meta{color:#666;text-align:center;margin-bottom:24px}
      table{width:100%;border-collapse:collapse;margin:16px 0} td,th{border:1px solid #999;padding:8px 10px;font-size:14px}
      .sign{margin-top:60px;display:flex;justify-content:space-between} .sign div{width:45%}
      p{line-height:1.9;font-size:14px}
    </style></head><body>
      <h1>外协加工成交合同</h1>
      <div class="meta">合同编号：HT-${esc(rec.id)}-${dayjs().format('YYYYMMDD')}</div>
      <table><tr><th>发包方（甲方）</th><td>${esc(rec.publisherCompany)}</td><th>承包方（乙方）</th><td>${esc(q.bidderCompany)}</td></tr>
      <tr><th>联系人</th><td>${esc(q.contactPerson) || '-'}</td><th>联系电话</th><td>${esc(q.contactPhone) || '-'}</td></tr></table>
      <table><tr><th>货品</th><th>款式编码</th><th>数量</th><th>单位</th><th>单价(元)</th><th>总金额(元)</th></tr>
      <tr><td>${esc(rec.shortName)}</td><td>${esc(rec.styleCode)}</td><td>${esc(rec.quantity) || 0}</td><td>${esc(rec.unit) || '件'}</td><td>${esc(q.unitPrice) || 0}</td><td>${esc(q.totalPrice) || 0}</td></tr></table>
      <p>一、交期：乙方应于报价承诺 ${esc(q.deliveryDays) || '-'} 天内完成加工并交付。</p>
      <p>二、保证金：甲方需缴纳保证金 ¥${esc(rec.deposit) || 0}（${esc(rec.depositStatus) || '未缴纳'}），违约方按约定扣罚。</p>
      <p>三、质量与验收：按甲方工艺要求执行，交易完成后双方可在商机市场互相信用评分。</p>
      <p>四、本合同自双方在线确认中标时生效，电子记录与纸质合同具同等效力。</p>
      <div class="sign"><div>甲方签章：<br/><br/><br/>日期：</div><div>乙方签章：<br/><br/><br/>日期：</div></div>
      <script>window.onload=function(){window.print();}</script>
    </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { message.error('浏览器拦截了新窗口，请允许弹窗后重试'); return; }
    w.document.write(html); w.document.close();
  }, []);

  // ============ 列表数据 ============
  const semiList = useMemo(() => {
    let list = market.filter(r => r.type !== 'finished');
    if (!isFactory && !isPurchaser && scope === 'mine') list = list.filter(r => r.publisherUsername === owner);
    // 全部市场视图：过滤掉已中标的订单（已中标的订单不再显示在发包市场）
    if (!isFactory && !isPurchaser && scope === 'all') list = list.filter(r => r.status !== '已中标');
    if (isFactory && fabScope === 'quotes') list = list.filter(r => (r.quotes || []).some((q: any) => q.bidderUsername === username));
    if (apKw.trim()) { const kw = apKw.trim().toLowerCase(); list = list.filter(r => `${r.id} ${r.shortName} ${r.styleCode} ${r.publisherCompany}`.toLowerCase().includes(kw)); }
    if (apStatus !== 'all') list = list.filter(r => r.status === apStatus);
    return list;
  }, [market, scope, fabScope, apKw, apStatus, username, isFactory, isPurchaser]);

  const finishedList = useMemo(() => {
    let list = market.filter(r => r.type === 'finished' && !r.delisted);
    if (apKw.trim()) { const kw = apKw.trim().toLowerCase(); list = list.filter(r => `${r.id} ${r.styleCode} ${r.shortName} ${r.publisherCompany}`.toLowerCase().includes(kw)); }
    if (titleSearch.trim()) { const ts = titleSearch.trim().toLowerCase(); list = list.filter(r => (r.shortName || '').toLowerCase().includes(ts)); }
    // 图片搜索时按相似度降序排序（得分高的排前面）
    if (imageSearchUrl && Object.keys(imgSimScores).length > 0) {
      list = [...list].sort((a, b) => (imgSimScores[b.key] || 0) - (imgSimScores[a.key] || 0));
    }
    return list;
  }, [market, apKw, titleSearch, imageSearchUrl, imgSimScores]);

  const myQuoteCount = useMemo(() => market.filter(r => (r.quotes || []).some((q: any) => q.bidderUsername === username)).length, [market, username]);
  const wonCount = useMemo(() => market.filter(r => r.status === '已中标' && (isFactory ? r.wonFactoryUsername === username : r.publisherUsername === owner)).length, [market, username, owner, isFactory]);
  const styleCodes = useMemo(() => Array.from(new Set(finishedList.map(r => r.styleCode).filter(Boolean))), [finishedList]);
  const compareRows = useMemo(() => {
    if (!compareCode) return [];
    return finishedList.filter(r => r.styleCode === compareCode)
      .sort((a, b) => (Number(a.targetPrice) || 0) - (Number(b.targetPrice) || 0));
  }, [compareCode, finishedList]);

  // ============ 发包市场表格列 ============
  const semiColumns: any[] = [
    { key: 'id', title: '发布单号', dataIndex: 'id', width: 120, align: 'center' },
    {
      key: 'image', title: '图片', width: 70, align: 'center',
      render: (_: any, r: any) => {
        // 优先产品自带 image（URL），回退发布者图片存储键（pubImg_ 或 prodImg_）
        const src = r.image || localStorage.getItem(`pubImg_${r.publisherUsername}_${r.key}`) || imgOf(r.publisherUsername, { key: r.productKey });
        return src ? <Image src={src} alt="半成品图" width={40} style={{ maxHeight: 40, objectFit: 'cover', borderRadius: 4 }} /> : '—';
      },
    },
    { key: 'shortName', title: '商品简称', dataIndex: 'shortName', width: 120, align: 'center' },
    { key: 'styleCode', title: '款式编码', dataIndex: 'styleCode', width: 110, align: 'center' },
    { key: 'processTypes', title: '工序类型', width: 130, align: 'center', render: (_: any, r: any) => ((r.processTypes || []).length ? (r.processTypes || []).join('、') : '—') },
    { key: 'quantity', title: '数量', dataIndex: 'quantity', width: 80, align: 'center' },
    { key: 'targetPrice', title: '期望单价', dataIndex: 'targetPrice', width: 90, align: 'center', render: (v: number) => (v ? `¥${v}` : null) },
    {
      key: 'deposit', title: '保证金', dataIndex: 'deposit', width: 110, align: 'center',
      render: (v: number, r: any) => v ? <Tag color={r.depositStatus === '已扣罚' ? 'red' : 'gold'}>¥{v} {r.depositStatus || ''}</Tag> : '—',
    },
    { key: 'deadline', title: '报价截止', dataIndex: 'deadline', width: 110, align: 'center', render: (v: string) => v || '—' },
    { key: 'quotes', title: '报价数', width: 80, align: 'center', render: (_: any, r: any) => (r.quotes || []).length },
    {
      key: 'minQuote', title: '最低报价', width: 90, align: 'center',
      render: (_: any, r: any) => {
        const ps = (r.quotes || []).map((q: any) => Number(q.unitPrice) || 0).filter((n: number) => n > 0);
        return ps.length ? <Text strong style={{ color: '#f5222d' }}>¥{Math.min(...ps)}</Text> : '—';
      },
    },
    {
      key: 'publisher', title: '发布方', width: 180, align: 'center',
      render: (_: any, r: any) => {
        // 优先从 registeredUsers 解析公司名，回退到存储的 publisherCompany
        const correctCompany = resolveCompany(r.publisherUsername) || r.publisherCompany;
        return r.publisherUsername === username ? <Text strong>{correctCompany}</Text> : <CreditTag username={r.publisherUsername} company={correctCompany} />;
      },
    },
    {
      key: 'status', title: '状态', dataIndex: 'status', width: 90, align: 'center',
      render: (v: string) => <Tag color={v === '已中标' ? 'green' : v === '已关闭' ? 'default' : v === '报价中' ? 'blue' : 'orange'}>{v}</Tag>,
    },
    { key: 'publishTime', title: '发布时间', width: 150, align: 'center', render: (_: any, r: any) => <span>{dayjs(r.publishTime).format('YYYY-MM-DD HH:mm')}{r.editTime ? <Tag style={{ marginLeft: 4 }}>已修改</Tag> : null}</span> },
    {
      key: 'action', title: '操作', width: 260, align: 'center', fixed: 'right' as const,
      render: (_: any, r: any) => {
        const mine = r.publisherUsername === owner;
        const expired = r.deadline && dayjs(r.deadline).endOf('day').isBefore(dayjs());
        return (
          <Space size={4} wrap>
            <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => openDetail(r)}>查看报价</Button>
            {mine && r.status !== '已中标' && r.status !== '已关闭' && (
              <Button size="small" type="link" icon={<EditOutlined />} onClick={() => { setPubEdit(r); pubForm.setFieldsValue({ ...r, deadline: r.deadline ? dayjs(r.deadline) : undefined }); const img = localStorage.getItem(`pubImg_${owner}_${r.key}`) || ''; setPubImage(img); setPubVisible(true); }}>编辑</Button>
            )}
            {mine && r.status !== '已中标' && r.status !== '已关闭' && (
              <Popconfirm title="关闭后不可再报价，确认关闭？" onConfirm={() => handleClose(r)}><Button size="small" type="link" danger icon={<CloseOutlined />}>关闭</Button></Popconfirm>
            )}
            {mine && r.status === '已中标' && (
              <>
                <Button size="small" type="link" icon={<PrinterOutlined />} onClick={() => handlePrintContract(r)}>打印合同</Button>
                {r.deposit > 0 && r.depositStatus !== '已扣罚' && (
                  <Button size="small" type="link" danger icon={<DollarOutlined />} onClick={() => handleDeduct(r)}>扣罚保证金</Button>
                )}
              </>
            )}
            {!mine && !isPurchaser && r.status !== '已中标' && r.status !== '已关闭' && !expired && (() => {
              const quoted = (r.quotes || []).some((q: any) => q.bidderUsername === username);
              return quoted
                ? <Button size="small" type="primary" icon={<DollarOutlined />} onClick={() => { setQuoteRec(r); quoteForm.setFieldsValue({ contactPerson: (JSON.parse(localStorage.getItem('registeredUsers') || '[]').find((u: any) => u.username === username) || {}).contactPerson || '' }); }}>已报价</Button>
                : <Button size="small" icon={<DollarOutlined />} style={{ background: '#52c41a', borderColor: '#52c41a', color: '#fff' }} onClick={() => { setQuoteRec(r); quoteForm.setFieldsValue({ contactPerson: (JSON.parse(localStorage.getItem('registeredUsers') || '[]').find((u: any) => u.username === username) || {}).contactPerson || '' }); }}>立即报价</Button>;
            })()}
          </Space>
        );
      },
    },
  ];

  // 成品详情：本租户商品下架——商品状态置已下架 + 立即从成品市场移除（sweep 不会重新上架）
  const handleDelist = useCallback((rec: any) => {
    const owner = rec.publisherUsername;
    const pkey = `pageData_basic-data_product-list_${owner}`;
    let prods: any[] = loadJson(pkey, []);
    prods = prods.map(pp => (pp.styleCode === rec.styleCode ? { ...pp, productStatus: '已下架' } : pp));
    const pjson = JSON.stringify(prods);
    safeSetItem(pkey, pjson);
    saveDataset(pkey, pjson);
    // 墓碑式下架：记录保留并打 delisted 标记（全局键并集合并，物理删除会被其他账号 pull 合并复活并回传服务器），展示端按 delisted 统一过滤
    setMarket(prev => {
      const next = prev.map(r => (r.type === 'finished' && r.publisherUsername === owner && r.styleCode === rec.styleCode ? { ...r, delisted: true, delistedAt: new Date().toISOString() } : r));
      saveJson(MARKET_KEY, next);
      return next;
    });
    setDetailRec(null);
    message.success(`商品 ${rec.styleCode} 已下架并从成品市场移除`);
  }, []);

  // ============ 渲染 ============
  return (
    <div style={{ padding: '8px 8px 0', height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      <Card
        style={{ margin: 0, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        bodyStyle={{ padding: '4px 8px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        title={<span><ShopOutlined style={{ color: PRIMARY, marginRight: 8 }} />商机市场</span>}
        extra={tab === 'finished' && !isFactory ? (
          <Space>
            <Button size="small" icon={<StarOutlined style={{ color: favorites.length > 0 ? '#fa8c16' : undefined }} />} onClick={() => setFavVisible(true)}>收藏夹({liveFavorites.length})</Button>
            <Button size="small" icon={<ShoppingCartOutlined style={{ color: cart.length > 0 ? '#fff' : undefined }} />} onClick={() => setCartVisible(true)} style={cart.length > 0 ? { background: '#fa8c16', borderColor: '#fa8c16', color: '#fff' } : undefined}>购物车({cart.length})</Button>
            <Button size="small" icon={<SwapOutlined />} onClick={() => { setCompareCode(styleCodes[0] || ''); setCompareVisible(true); }}>比价</Button>
            {!isPurchaser && (
              <>
                <SettingOutlined />
                <Tooltip title={
                  <div style={{ maxWidth: 320, lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>自动上架触发条件（须同时满足）：</div>
                    <div>1. 账号未显式关闭「在售成品自动上架」（未设置默认开启）</div>
                    <div>2. 产品种类 = 成品 且 产品状态 = 在售</div>
                    <div>3. 款式编码非空 且 非半成品（排除 SEMI- 前缀）</div>
                    <div>4. 基础售价 ≠ 0 且 基础售价 &gt; 成本价</div>
                    <div style={{ marginTop: 6, fontWeight: 600 }}>触发时机：</div>
                    <div>· 切换到成品市场标签页时</div>
                    <div>· 产品图片上传/修改时</div>
                    <div>· 产品研发完成、状态变更时</div>
                  </div>
                }>
                  <span style={{ marginRight: 4, cursor: 'help' }}>在售成品自动上架</span>
                </Tooltip>
                <Switch checked={autoOn} onChange={toggleAuto} checkedChildren="开" unCheckedChildren="关" />
                {!autoOn && <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openManualPublish}>手动添加</Button>}
              </>
            )}
          </Space>
        ) : null}
      >
        <Tabs
          activeKey={tab}
          onChange={setTab}
          style={{ flex: 'none' }}
          items={(isPurchaser ? [
            { key: 'finished', label: '成品市场' },
            { key: 'mold-market', label: '模具租/售' },
            { key: 'inventory', label: '我的货盘' },
            { key: 'chat', label: '我的消息' },
          ] : [
            { key: 'semi', label: '发包市场' },
            { key: 'finished', label: '成品市场' },
            { key: 'mold-market', label: '模具租/售' },
            { key: 'inventory', label: '我的货盘' },
            { key: 'chat', label: '我的消息' },
          ]).map(i => ({
            key: i.key,
            label: i.key === 'chat' && chatUnread > 0
              ? <span>{i.label} <Badge count={chatUnread} size="small" style={{ marginLeft: 4 }} /></span>
              : <span>{i.label}</span>,
          }))}
        />

        {/* 页签内容区：占满剩余高度并允许纵向滚动（Tabs 本身只渲染页签条不拉伸，避免中部大片空白） */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {tab === 'semi' && (
          <>
            <Row gutter={12} style={{ marginBottom: 12 }}>
              <Col span={6}><Card size="small"><Statistic title={isFactory ? '市场发包单' : '我的发布'} value={isFactory ? market.filter(r => r.type !== 'finished').length : market.filter(r => r.type !== 'finished' && r.publisherUsername === owner).length} suffix="单" /></Card></Col>
              <Col span={6}><Card size="small"><Statistic title="我的报价" value={myQuoteCount} suffix="单" /></Card></Col>
              <Col span={6}><Card size="small"><Statistic title="已中标" value={wonCount} suffix="单" valueStyle={{ color: '#52c41a' }} /></Card></Col>
              <Col span={6}><Card size="small"><Statistic title="信用评分" value={creditOf(username).score || '—'} suffix={creditOf(username).count ? `(${creditOf(username).count}次)` : ''} valueStyle={{ color: '#faad14' }} /></Card></Col>
            </Row>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {!isFactory && !isPurchaser && <Segmented options={[{ label: '我的发布', value: 'mine' }, { label: '全部市场', value: 'all' }]} value={scope} onChange={v => setScope(v as any)} />}
              {isFactory && <Segmented options={[{ label: '发包市场', value: 'market' }, { label: '我的报价', value: 'quotes' }]} value={fabScope} onChange={v => setFabScope(v as any)} />}
              {scope === 'all' && (
                <Segmented options={[{ label: '表格', value: 'table', icon: <UnorderedListOutlined /> }, { label: '卡片', value: 'card', icon: <AppstoreOutlined /> }]} value={semiViewMode} onChange={v => setSemiViewMode(v as any)} />
              )}
              <Input placeholder="搜索发布单号/商品简称/款式编码/发布方" allowClear style={{ width: 260 }} value={sKw} onChange={e => setSKw(e.target.value)} onPressEnter={() => setApKw(sKw)} />
              <Select style={{ width: 120 }} value={sStatus} onChange={setSStatus} options={[{ value: 'all', label: '全部状态' }, { value: '待报价', label: '待报价' }, { value: '报价中', label: '报价中' }, { value: '已中标', label: '已中标' }, { value: '已关闭', label: '已关闭' }]} />
              <Button type="primary" icon={<SearchOutlined />} onClick={() => { reload(); setApKw(sKw); setApStatus(sStatus); }}>查询</Button>
              <Button icon={<ReloadOutlined />} onClick={() => { setSKw(''); setApKw(''); setSStatus('all'); setApStatus('all'); }}>重置</Button>
              {!isFactory && !isPurchaser && (
                <Button type="primary" icon={<PlusOutlined />} style={{ marginLeft: 'auto' }} onClick={() => { setPubEdit(null); pubForm.resetFields(); setPubImage(''); setPubVisible(true); }}>发布发包订单</Button>
              )}
            </div>
            {semiViewMode === 'table' ? (
              <Table rowKey="key" bordered size="middle" className="mkt-fixed-table" columns={semiColumns} dataSource={semiList} scroll={{ x: 1500, y: 'calc(100vh - 535px)' }}
                pagination={{ pageSize: 20, position: ['topRight'], showTotal: t => `共 ${t} 条` }} locale={{ emptyText: <Empty description="暂无发包订单" /> }} />
            ) : (
              semiList.length === 0 ? <Empty description="暂无发包订单" /> : (
                <Row gutter={[12, 12]}>
                  {semiList.map(r => {
                    const imgSrc = r.image || localStorage.getItem(`pubImg_${r.publisherUsername}_${r.key}`) || imgOf(r.publisherUsername, { key: r.productKey });
                    const minQuote = (r.quotes || []).map((q: any) => Number(q.unitPrice) || 0).filter((n: number) => n > 0);
                    const lowestPrice = minQuote.length ? Math.min(...minQuote) : null;
                    return (
                      <Col xs={12} sm={8} md={6} lg={4} xl={4} key={r.key}>
                        <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', transition: 'all 0.3s', cursor: 'pointer' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(24,144,255,0.15)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
                        >
                          {/* 图片区 */}
                          <div style={{ width: '100%', aspectRatio: '1 / 1', background: '#f5f5f5', position: 'relative', overflow: 'hidden' }} onClick={() => openDetail(r)}>
                            {imgSrc ? <img src={imgSrc} alt={r.shortName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ShopOutlined style={{ fontSize: 48, color: '#d9d9d9' }} /></div>}
                            {/* 状态角标 */}
                            {r.status === '已中标' && <div style={{ position: 'absolute', top: 8, right: 8, background: 'linear-gradient(135deg, #52c41a, #389e0d)', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>已中标</div>}
                            {r.status === '报价中' && <div style={{ position: 'absolute', top: 8, right: 8, background: 'linear-gradient(135deg, #1890ff, #096dd9)', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>报价中</div>}
                            {r.status === '待报价' && <div style={{ position: 'absolute', top: 8, right: 8, background: 'linear-gradient(135deg, #faad14, #d48806)', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>待报价</div>}
                          </div>
                          {/* 信息区 */}
                          <div style={{ padding: '10px 12px 8px' }}>
                            <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
                              货品ID: <span style={{ color: '#333', fontWeight: 500 }}>{r.id}</span>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => openDetail(r)}>
                              <Tag color="blue" style={{ fontSize: 11, marginRight: 4, padding: '0 4px' }}>{r.styleCode}</Tag>
                              {r.shortName || '—'}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
                              <span style={{ color: '#f5222d', fontSize: 11 }}>期望价</span>
                              <span style={{ color: '#f5222d', fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{r.targetPrice ? `¥${r.targetPrice}` : '面议'}</span>
                              <span style={{ color: '#999', fontSize: 12, marginLeft: 2 }}>/{r.unit || '件'}</span>
                            </div>
                            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                              数量：{r.quantity || 0} {r.unit || '件'}
                            </div>
                            {lowestPrice && (
                              <div style={{ fontSize: 12, color: '#52c41a', marginBottom: 4 }}>
                                最低报价：¥{lowestPrice}
                              </div>
                            )}
                            <div style={{ fontSize: 12, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <CreditTag username={r.publisherUsername} company={resolveCompany(r.publisherUsername) || r.publisherCompany} />
                            </div>
                          </div>
                          {/* 底部操作区 */}
                          <div style={{ borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center' }}>
                            <div onClick={() => openDetail(r)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 0', cursor: 'pointer', color: '#1890ff', fontSize: 12, transition: 'color 0.2s' }}
                              onMouseEnter={e => (e.currentTarget.style.color = '#40a9ff')}
                              onMouseLeave={e => (e.currentTarget.style.color = '#1890ff')}
                            >
                              <EyeOutlined style={{ fontSize: 14 }} />
                              <span>查看报价</span>
                            </div>
                            {r.publisherUsername !== username && (
                              <>
                                <div style={{ width: 1, height: 20, background: '#f0f0f0' }} />
                                <div onClick={(e) => { e.stopPropagation(); setTab('chat'); triggerOpenChat(r.publisherUsername, r.shortName || ''); }}
                                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 0', cursor: 'pointer', color: '#1677ff', fontSize: 12, transition: 'color 0.2s' }}
                                  onMouseEnter={e => (e.currentTarget.style.color = '#4096ff')}
                                  onMouseLeave={e => (e.currentTarget.style.color = '#1677ff')}
                                >
                                  <MessageOutlined style={{ fontSize: 14 }} />
                                  <span>联系</span>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </Col>
                    );
                  })}
                </Row>
              )
            )}
          </>
        )}

        {tab === 'finished' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <Input placeholder="搜索货品ID/款式编码/商品简称/供应商" allowClear style={{ width: 240 }} value={sKw} onChange={e => setSKw(e.target.value)} onPressEnter={() => { setApKw(sKw); setTitleSearch(titleSearchInput); }} />
              <Input placeholder="标题搜索产品" allowClear style={{ width: 180 }} prefix={<SearchOutlined style={{ color: '#999' }} />} value={titleSearchInput} onChange={e => setTitleSearchInput(e.target.value)} onPressEnter={() => { setApKw(sKw); setTitleSearch(titleSearchInput); }} />
              <Popover
                trigger="hover"
                placement="bottomLeft"
                open={imageSearchVisible}
                onOpenChange={setImageSearchVisible}
                content={
                  <div>
                    <div
                      tabIndex={0}
                      style={{ width: 260, minHeight: 160, border: '2px dashed #d9d9d9', borderRadius: 8, padding: 12, textAlign: 'center', cursor: 'pointer', background: '#fafafa' }}
                      onPaste={(e) => {
                        const items = e.clipboardData?.items;
                        if (!items) return;
                        for (let i = 0; i < items.length; i++) {
                          if (items[i].type.startsWith('image/')) {
                            const file = items[i].getAsFile();
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = (ev) => {
                                setImageSearchUrl(ev.target?.result as string);
                                setImageSearchVisible(false);
                                message.success('已加载粘贴图片');
                              };
                              reader.readAsDataURL(file);
                            }
                            return;
                          }
                        }
                        message.warning('剪切板中没有图片');
                      }}
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/*';
                        input.onchange = () => {
                          const file = input.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              setImageSearchUrl(ev.target?.result as string);
                              setImageSearchVisible(false);
                              message.success(`已加载图片：${file.name}`);
                            };
                            reader.readAsDataURL(file);
                          }
                        };
                        input.click();
                      }}
                    >
                      {imageSearchUrl ? (
                        <div>
                          <Image src={imageSearchUrl} width={200} height={140} style={{ objectFit: 'contain' }} preview={false} />
                          <div style={{ marginTop: 8, fontSize: 12, color: '#52c41a' }}>✓ 已加载参考图片</div>
                        </div>
                      ) : (
                        <div>
                          <CameraOutlined style={{ fontSize: 36, color: '#bbb', marginBottom: 8 }} />
                          <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>点击选择图片 或 Ctrl+V 粘贴图片</div>
                          <div style={{ fontSize: 12, color: '#999' }}>支持 JPG / PNG / WebP，上传后自动识别图片主体</div>
                        </div>
                      )}
                    </div>
                    <div style={{ marginTop: 8, textAlign: 'center' }}>
                      <Button size="small" icon={<SnippetsOutlined />} onClick={(e) => { e.stopPropagation(); handlePasteFromClipboard(); }}>粘贴</Button>
                    </div>
                  </div>
                }
              >
                <Button icon={<CameraOutlined />} style={{ borderColor: imageSearchUrl ? '#1890ff' : undefined, color: imageSearchUrl ? '#1890ff' : undefined }}>
                  {imageSearchUrl ? '已选图片' : '图片搜索'}
                </Button>
              </Popover>
              {imageSearchUrl && (
                <Tooltip title="清除参考图片">
                  <Button type="text" icon={<CloseOutlined />} size="small" onClick={() => setImageSearchUrl('')} />
                </Tooltip>
              )}
              <Button type="primary" icon={<SearchOutlined />} onClick={() => { reload(); setApKw(sKw); setTitleSearch(titleSearchInput); }}>查询</Button>
              <Button icon={<ReloadOutlined />} onClick={() => { setSKw(''); setApKw(''); setTitleSearchInput(''); setTitleSearch(''); setImageSearchUrl(''); }}>重置</Button>
            </div>
            {/* 图片搜索参考区 */}
            {imageSearchUrl && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '8px 12px', background: '#e6f7ff', borderRadius: 8, border: '1px solid #91d5ff' }}>
                <span style={{ fontSize: 12, color: '#1890ff', fontWeight: 600 }}>参考图片：</span>
                <Image src={imageSearchUrl} width={60} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} preview={{ mask: '查看大图' }} />
                <div style={{ flex: 1 }}>
                  {imgSimComputing ? (
                    <div style={{ fontSize: 12, color: '#fa8c16' }}>🔄 正在自动识别图片主体并计算相似度，请稍候...</div>
                  ) : Object.keys(imgSimScores).length > 0 ? (
                    <div style={{ fontSize: 12, color: '#52c41a' }}>✓ 已自动识别图片主体，按轮廓结构(HOG+剪影)+颜色布局综合相似度排序，最相似的商品排在前面</div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#666' }}>上传图片后系统将自动识别主体（去除背景干扰），与商品主体进行匹配</div>
                  )}
                </div>
              </div>
            )}
            {finishedList.length === 0 ? <Empty description="暂无在售成品上架" /> : (
              <Row gutter={[12, 12]}>
                {finishedList.map(r => {
                  const faved = favorites.some(f => f.cardKey === r.key);
                  const imgSrc = r.image || imgOf(r.publisherUsername, { key: r.productKey });
                  return (
                    <Col xs={12} sm={8} md={6} lg={4} xl={4} key={r.key}>
                      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', transition: 'all 0.3s', cursor: 'pointer' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(245,34,45,0.15)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
                      >
                        {/* 商品图片区 */}
                        <div style={{ width: '100%', aspectRatio: '1 / 1', background: '#f5f5f5', position: 'relative', overflow: 'hidden' }} onClick={() => openDetail(r)}>
                          {imgSrc ? <img src={imgSrc} alt={r.shortName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ShopOutlined style={{ fontSize: 48, color: '#d9d9d9' }} /></div>}
                          {/* 图片搜索相似度角标 */}
                          {imageSearchUrl && imgSimScores[r.key] !== undefined && (
                            <div style={{ position: 'absolute', top: 8, left: 8, background: imgSimScores[r.key] > 0.65 ? '#52c41a' : imgSimScores[r.key] > 0.45 ? '#faad14' : '#999', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                              {Math.round(imgSimScores[r.key] * 100)}% 相似
                            </div>
                          )}
                          {/* 图片角标：仅发布者自己可见 */}
                          {r.auto && r.publisherUsername === owner && <div style={{ position: 'absolute', top: 8, left: 8, background: 'linear-gradient(135deg, #ff6b6b, #ee5a24)', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>自动上架</div>}
                          {r.status === '已中标' && <div style={{ position: 'absolute', top: 8, right: 8, background: 'linear-gradient(135deg, #52c41a, #389e0d)', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>已成交</div>}
                        </div>
                        {/* 商品信息区 */}
                        <div style={{ padding: '10px 12px 8px' }}>
                          <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
                            货品ID: <span style={{ color: '#333', fontWeight: 500 }}>{r.id}</span>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => openDetail(r)}>
                            <Tag color="blue" style={{ fontSize: 11, marginRight: 4, padding: '0 4px' }}>{r.styleCode}</Tag>
                            {r.shortName || '—'}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
                            <span style={{ color: '#f5222d', fontSize: 11 }}>供货价</span>
                            <span style={{ color: '#f5222d', fontSize: 20, fontWeight: 700, lineHeight: 1 }}>¥{Number(r.targetPrice) || 0}</span>
                            <span style={{ color: '#999', fontSize: 12, marginLeft: 2 }}>/{r.unit || '件'}</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <CreditTag username={r.publisherUsername} company={resolveCompany(r.publisherUsername) || r.publisherCompany} openShare />
                          </div>
                        </div>
                          {/* 底部分隔线 + 操作按钮 */}
                        <div style={{ borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center' }}>
                          <div onClick={() => toggleFav(r)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 0', cursor: 'pointer', color: faved ? '#faad14' : '#999', fontSize: 12, transition: 'color 0.2s' }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#faad14')}
                            onMouseLeave={e => (e.currentTarget.style.color = faved ? '#faad14' : '#999')}
                          >
                            <>{faved ? <StarFilled style={{ fontSize: 14 }} /> : <StarOutlined style={{ fontSize: 14 }} />}<span>收藏</span></>
                          </div>
                          <div style={{ width: 1, height: 20, background: '#f0f0f0' }} />
                          <div onClick={() => addToCart(r)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 0', cursor: 'pointer', color: '#1890ff', fontSize: 12, transition: 'color 0.2s' }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#40a9ff')}
                            onMouseLeave={e => (e.currentTarget.style.color = '#1890ff')}
                          >
                            <ShoppingCartOutlined style={{ fontSize: 14 }} />
                            <span>加购</span>
                          </div>
                          <div style={{ width: 1, height: 20, background: '#f0f0f0' }} />
                          <div onClick={() => openDetail(r)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 0', cursor: 'pointer', color: '#52c41a', fontSize: 12, transition: 'color 0.2s' }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#73d13d')}
                            onMouseLeave={e => (e.currentTarget.style.color = '#52c41a')}
                          >
                            <EyeOutlined style={{ fontSize: 14 }} />
                            <span>详情</span>
                          </div>
                          {r.publisherUsername !== username && (
                            <>
                              <div style={{ width: 1, height: 20, background: '#f0f0f0' }} />
                              <div onClick={(e) => { e.stopPropagation(); setTab('chat'); triggerOpenChat(r.publisherUsername, r.shortName || ''); }}
                                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 0', cursor: 'pointer', color: '#1677ff', fontSize: 12, transition: 'color 0.2s' }}
                                onMouseEnter={e => (e.currentTarget.style.color = '#4096ff')}
                                onMouseLeave={e => (e.currentTarget.style.color = '#1677ff')}
                              >
                                <MessageOutlined style={{ fontSize: 14 }} />
                                <span>联系</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </Col>
                  );
                })}
              </Row>
            )}
          </>
        )}

        {tab === 'mold-market' && <MoldMarketTab onContact={(u, s) => { setTab('chat'); triggerOpenChat(u, s); }} />}

        {tab === 'inventory' && (
          <>
            {!isPurchaser ? (
              // 供应商视图：默认显示全部成品，可创建货盘
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateInventoryVisible(true)}>创建货盘</Button>
                  <Button icon={<ReloadOutlined />} onClick={() => { loadInventoryLists(); setCurrentInventoryId(null); }}>刷新</Button>
                  {/* 分享链接：选中货盘时分享该货盘；未选中时一键分享我的货盘全部商品 */}
                  <Button icon={<ShareAltOutlined />} onClick={() => {
                    const cur = inventoryLists.find((l: any) => l.id === currentInventoryId);
                    if (cur) { showShareModal(cur); return; }
                    setCurrentShareList({ id: '__all__', name: '全部商品', productKeys: [], shareCode: '', isAllShare: true });
                    setShareModalVisible(true);
                  }}>分享链接</Button>
                  {/* 店铺横幅：上传背景图，展示在货盘公开分享页公司表头左侧（未上传时用系统默认背景） */}
                  <input ref={invBannerFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleInvBannerFile(f); e.target.value = ''; }} />
                  <Tooltip title="上传店铺横幅背景图，展示在货盘分享页公司表头">
                    <Button icon={<CameraOutlined />} onClick={() => invBannerFileRef.current?.click()}>店铺横幅</Button>
                  </Tooltip>
                  {invBanner && (
                    <>
                      <Image src={invBanner} alt="店铺横幅" width={56} height={32} style={{ objectFit: 'cover', borderRadius: 4 }} />
                      <Tooltip title="删除店铺横幅">
                        <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={handleInvBannerRemove} />
                      </Tooltip>
                    </>
                  )}
                  {/* 货盘名称按钮 */}
                  {inventoryLists.map((list: any) => {
                    const menuItems = [
                      { key: 'add', label: '添加商品', icon: <PlusOutlined /> },
                      { key: 'edit', label: '编辑名称', icon: <EditOutlined /> },
                      { key: 'share', label: '分享货盘', icon: <ShareAltOutlined /> },
                      { key: 'delete', label: '删除货盘', icon: <DeleteOutlined />, danger: true },
                    ];
                    return (
                      <Dropdown
                        key={list.id}
                        menu={{
                          items: menuItems,
                          onClick: ({ key }) => {
                            if (key === 'add') handleAddProducts(list);
                            else if (key === 'edit') handleEditInventory(list);
                            else if (key === 'share') showShareModal(list);
                            else if (key === 'delete') deleteInventoryList(list.id);
                          },
                        }}
                        trigger={['click']}
                      >
                        <Button
                          type={currentInventoryId === list.id ? 'primary' : 'default'}
                          size="small"
                          onClick={() => setCurrentInventoryId(currentInventoryId === list.id ? null : list.id)}
                        >
                          {list.name}
                          <Tag color="blue" style={{ marginLeft: 4, fontSize: 10 }}>{list.productKeys?.length || 0}</Tag>
                          <MoreOutlined style={{ marginLeft: 4, fontSize: 10 }} />
                        </Button>
                      </Dropdown>
                    );
                  })}
                </div>
                {/* 显示商品卡片 */}
                {(() => {
                  // 获取要显示的商品列表
                  let displayProducts: any[] = [];
                  if (currentInventoryId) {
                    // 显示指定货盘的商品
                    const list = inventoryLists.find(l => l.id === currentInventoryId);
                    if (list) {
                      const allFinished = market.filter(r => r.type === 'finished' && r.publisherUsername === owner);
                      displayProducts = list.productKeys?.map((key: string) => allFinished.find(p => p.key === key)).filter(Boolean) || [];
                    }
                  } else {
                    // 默认显示全部成品
                    displayProducts = market.filter(r => r.type === 'finished' && r.publisherUsername === owner);
                  }
                  
                  if (displayProducts.length === 0) {
                    return <Empty description={currentInventoryId ? '该货盘暂无商品' : '暂无成品，请先发布商品到成品市场'} />;
                  }
                  
                  return (
                    <Row gutter={[12, 12]}>
                      {displayProducts.map(r => {
                        const faved = favorites.some(f => f.cardKey === r.key);
                        const imgSrc = r.image || imgOf(r.publisherUsername, { key: r.productKey });
                        return (
                          <Col xs={12} sm={8} md={6} lg={4} xl={4} key={r.key}>
                            <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', transition: 'all 0.3s', cursor: 'pointer' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(245,34,45,0.15)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
                            >
                              {/* 商品图片区 */}
                              <div style={{ width: '100%', aspectRatio: '1 / 1', background: '#f5f5f5', position: 'relative', overflow: 'hidden' }} onClick={() => openDetail(r)}>
                                {imgSrc ? <img src={imgSrc} alt={r.shortName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ShopOutlined style={{ fontSize: 48, color: '#d9d9d9' }} /></div>}
                                {r.auto && r.publisherUsername === owner && <div style={{ position: 'absolute', top: 8, left: 8, background: 'linear-gradient(135deg, #ff6b6b, #ee5a24)', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>自动上架</div>}
                              </div>
                              {/* 商品信息区 */}
                              <div style={{ padding: '10px 12px 8px' }}>
                                <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
                                  货品ID: <span style={{ color: '#333', fontWeight: 500 }}>{r.id}</span>
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => openDetail(r)}>
                                  <Tag color="blue" style={{ fontSize: 11, marginRight: 4, padding: '0 4px' }}>{r.styleCode}</Tag>
                                  {r.shortName || '—'}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
                                  <span style={{ color: '#f5222d', fontSize: 11 }}>供货价</span>
                                  <span style={{ color: '#f5222d', fontSize: 20, fontWeight: 700, lineHeight: 1 }}>¥{Number(r.targetPrice) || 0}</span>
                                  <span style={{ color: '#999', fontSize: 12, marginLeft: 2 }}>/{r.unit || '件'}</span>
                                </div>
                              </div>
                              {/* 底部分隔线 + 操作按钮 */}
                              <div style={{ borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center' }}>
                                <div onClick={() => toggleFav(r)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 0', cursor: 'pointer', color: faved ? '#faad14' : '#999', fontSize: 12, transition: 'color 0.2s' }}
                                  onMouseEnter={e => (e.currentTarget.style.color = '#faad14')}
                                  onMouseLeave={e => (e.currentTarget.style.color = faved ? '#faad14' : '#999')}
                                >
                                  <>{faved ? <StarFilled style={{ fontSize: 14 }} /> : <StarOutlined style={{ fontSize: 14 }} />}<span>收藏</span></>
                                </div>
                                <div style={{ width: 1, height: 20, background: '#f0f0f0' }} />
                                <div onClick={() => addToCart(r)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 0', cursor: 'pointer', color: '#1890ff', fontSize: 12, transition: 'color 0.2s' }}
                                  onMouseEnter={e => (e.currentTarget.style.color = '#40a9ff')}
                                  onMouseLeave={e => (e.currentTarget.style.color = '#1890ff')}
                                >
                                  <ShoppingCartOutlined style={{ fontSize: 14 }} />
                                  <span>加购</span>
                                </div>
                                <div style={{ width: 1, height: 20, background: '#f0f0f0' }} />
                                <div onClick={() => openDetail(r)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 0', cursor: 'pointer', color: '#52c41a', fontSize: 12, transition: 'color 0.2s' }}
                                  onMouseEnter={e => (e.currentTarget.style.color = '#73d13d')}
                                  onMouseLeave={e => (e.currentTarget.style.color = '#52c41a')}
                                >
                                  <EyeOutlined style={{ fontSize: 14 }} />
                                  <span>详情</span>
                                </div>
                              </div>
                            </div>
                          </Col>
                        );
                      })}
                    </Row>
                  );
                })()}
              </>
            ) : (
              // 采购商视图：输入分享码查看货盘
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
                  <Input
                    placeholder="请输入货盘分享码"
                    value={shareCodeInput}
                    onChange={e => setShareCodeInput(e.target.value)}
                    style={{ width: 300 }}
                    onPressEnter={() => loadSharedInventory(shareCodeInput)}
                  />
                  <Button type="primary" icon={<SearchOutlined />} onClick={() => loadSharedInventory(shareCodeInput)}>查看货盘</Button>
                </div>
                {sharedInventory ? (
                  <>
                    <Alert
                      message={`货盘：${sharedInventory.name}`}
                      description={`供应商：${sharedInventory.supplierName} | 商品数量：${sharedInventory.productKeys?.length || 0} 件`}
                      type="info"
                      showIcon
                      style={{ marginBottom: 16 }}
                    />
                    <Row gutter={[16, 16]}>
                      {sharedInventory.products?.map((p: any) => {
                        const imgSrc = p.image || imgOf(p.publisherUsername, { key: p.productKey });
                        const supplierName = p.supplierName || p.publisherCompany || '';
                        return (
                        <Col key={p.key} xs={24} sm={12} md={8} lg={6}>
                          <Card
                            hoverable
                            cover={
                              imgSrc ? (
                                <img
                                  alt={p.shortName}
                                  src={imgSrc}
                                  style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block' }}
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                              ) : (
                                <div style={{ width: '100%', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
                                  <ShopOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />
                                </div>
                              )
                            }
                            actions={[
                              <Tooltip title="收藏"><StarOutlined onClick={() => toggleFav(p)} /></Tooltip>,
                              p && !isOwnProduct(p) ? (
                                <Tooltip title="加购"><ShoppingCartOutlined onClick={() => addToCart(p)} /></Tooltip>
                              ) : (
                                <Tooltip title="不能添加自己公司的商品"><ShoppingCartOutlined style={{ color: '#d9d9d9', cursor: 'not-allowed' }} /></Tooltip>
                              ),
                              <Tooltip title="详情"><EyeOutlined onClick={() => { setDetailRec({ ...p, type: 'finished' }); }} /></Tooltip>,
                            ]}
                          >
                            <Card.Meta
                              title={<Tooltip title={p.shortName}><Text ellipsis style={{ maxWidth: 180 }}>{p.shortName}</Text></Tooltip>}
                              description={
                                <>
                                  <div style={{ marginBottom: 4 }}>
                                    <Tag color="blue">{p.styleCode}</Tag>
                                  </div>
                                  <div style={{ marginBottom: 4 }}>
                                    <Text type="danger" strong>¥{p.price || 0}</Text>
                                    <Text type="secondary" style={{ fontSize: 12 }}>/{p.unit || '件'}</Text>
                                  </div>
                                  <div>
                                    <Text type="secondary" style={{ fontSize: 12 }}>{supplierName || '—'}</Text>
                                  </div>
                                </>
                              }
                            />
                          </Card>
                        </Col>
                        );
                      })}
                    </Row>
                  </>
                ) : (
                  <Empty description="请输入分享码查看货盘" />
                )}
              </>
            )}
          </>
        )}

        {tab === 'chat' && (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <ChatPage />
          </div>
        )}
        </div>
      </Card>

      {/* 创建货盘弹窗 */}
      <Modal
        title="创建货盘"
        open={createInventoryVisible}
        onCancel={() => setCreateInventoryVisible(false)}
        footer={null}
        width={800}
        destroyOnClose
      >
        <CreateInventoryModal
          onCancel={() => setCreateInventoryVisible(false)}
          onCreate={(name, productKeys) => {
            createInventoryList(name, productKeys);
            setCreateInventoryVisible(false);
          }}
          market={market}
          username={owner}
        />
      </Modal>

      {/* 分享货盘弹窗 */}
      <Modal
        title="分享货盘"
        open={shareModalVisible}
        onCancel={() => setShareModalVisible(false)}
        footer={<Button onClick={() => setShareModalVisible(false)}>关闭</Button>}
        width={520}
      >
        {currentShareList && (() => {
          // 全部分享：一键分享我的货盘全部商品（链接不带分享码，实时展示在售成品）
          if (currentShareList.isAllShare) {
            const allLink = `${window.location.origin}/shared/inventory?supplier=${encodeURIComponent(companyNoOf(username))}`;
            return (
              <>
                <Paragraph>分享内容：<Text strong>我的货盘全部商品</Text></Paragraph>
                <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                  <Text type="secondary">分享链接</Text>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    <Text style={{ flex: 1, wordBreak: 'break-all', fontSize: 12, color: PRIMARY }}>{allLink}</Text>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => {
                        navigator.clipboard.writeText(allLink);
                        message.success('分享链接已复制到剪贴板');
                      }}
                    >复制</Button>
                  </div>
                </div>
                <Paragraph type="secondary" style={{ marginBottom: 16 }}>
                  将链接发送给采购商，打开后无需登录即可查看我的货盘中的全部商品，可加入购物车、分享购物车或生成订单。
                </Paragraph>
                <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8, padding: 12 }}>
                  <Text type="secondary">提示：</Text>
                  <Text style={{ fontSize: 12, color: '#999' }}>全部分享实时展示成品市场在售商品，新上架或下架的商品会自动同步到分享页。</Text>
                </div>
              </>
            );
          }
          const shareLink = `${window.location.origin}/shared/inventory?code=${currentShareList.shareCode}`;
          return (
            <>
              <Paragraph>货盘名称：<Text strong>{currentShareList.name}</Text></Paragraph>
              <Paragraph>商品数量：<Text strong>{currentShareList.productKeys?.length || 0} 件</Text></Paragraph>
              <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <Text type="secondary">分享链接</Text>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <Text style={{ flex: 1, wordBreak: 'break-all', fontSize: 12, color: PRIMARY }}>{shareLink}</Text>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(shareLink);
                      message.success('分享链接已复制到剪贴板');
                    }}
                  >复制</Button>
                </div>
              </div>
              <Paragraph type="secondary" style={{ marginBottom: 16 }}>
                将链接发送给采购商，采购商打开链接后自动进入“我的货盘”页面并加载该货盘，可查看并选购商品。
              </Paragraph>
              <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8, padding: 12 }}>
                <Text type="secondary">备用分享码：</Text>
                <Text code style={{ fontSize: 14, color: PRIMARY }}>{currentShareList.shareCode}</Text>
                <Button
                  type="link"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    navigator.clipboard.writeText(currentShareList.shareCode);
                    message.success('分享码已复制到剪贴板');
                  }}
                >复制</Button>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>采购商也可在“我的货盘”页面手动输入分享码查看</div>
              </div>
            </>
          );
        })()}
      </Modal>

      {/* 编辑货盘名称弹窗 */}
      <Modal
        title="编辑货盘名称"
        open={editInventoryVisible}
        onCancel={() => { setEditInventoryVisible(false); setEditInventoryData(null); }}
        onOk={() => {
          const input = document.getElementById('edit-inventory-name-input') as HTMLInputElement;
          if (input && input.value.trim()) {
            saveEditInventory(input.value.trim());
          } else {
            message.warning('请输入货盘名称');
          }
        }}
        okText="保存"
        cancelText="取消"
        width={400}
      >
        {editInventoryData && (
          <Form autoComplete="off" layout="vertical">
            <Form.Item label="货盘名称" required>
              <Input
                id="edit-inventory-name-input"
                defaultValue={editInventoryData.name}
                maxLength={50}
                autoFocus
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* 添加商品到货盘弹窗 */}
      <Modal
        title="添加商品到货盘"
        open={addProductsVisible}
        onCancel={() => { setAddProductsVisible(false); setAddProductsInventoryId(null); }}
        footer={null}
        width={800}
        destroyOnClose
      >
        {addProductsInventoryId && (
          <AddProductsToInventoryModal
            inventoryId={addProductsInventoryId}
            inventoryLists={inventoryLists}
            onCancel={() => { setAddProductsVisible(false); setAddProductsInventoryId(null); }}
            onAdd={(newProductKeys: string[]) => {
              saveAddProducts(newProductKeys);
            }}
            market={market}
            username={owner}
          />
        )}
      </Modal>

      {/* 发布/编辑发包订单弹窗 */}
      <Modal title={pubEdit ? '编辑发包订单' : '发布发包订单'} open={pubVisible} onOk={handlePublish} onCancel={() => { setPubVisible(false); setPubEdit(null); }} okText="保存" cancelText="取消" width={640} destroyOnClose>
        <Form autoComplete="off" form={pubForm} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="shortName" label="商品简称" rules={[{ required: true, message: '请输入商品简称' }]}><Input placeholder="请输入商品简称" maxLength={40} /></Form.Item></Col>
            <Col span={12}><Form.Item name="styleCode" label="款式编码" rules={[{ required: true, message: '请输入款式编码' }]}><Input placeholder="请输入款式编码" maxLength={40} /></Form.Item></Col>
            <Col span={12}><Form.Item name="productCode" label="商品编码"><Input placeholder="选填" maxLength={40} /></Form.Item></Col>
            <Col span={6}><Form.Item name="unit" label="单位" initialValue="件"><Input placeholder="件" /></Form.Item></Col>
            <Col span={6}><Form.Item name="quantity" label="数量" rules={[{ required: true, message: '请输入数量' }]}><InputNumber min={1} style={{ width: '100%' }} placeholder="加工数量" /></Form.Item></Col>
            <Col span={8}><Form.Item name="targetPrice" label="期望单价(元)"><InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="选填" /></Form.Item></Col>
            <Col span={8}><Form.Item name="deposit" label="保证金(元)" extra="缴纳后展示金色标签，违约可扣罚"><InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="选填" /></Form.Item></Col>
            <Col span={8}><Form.Item name="deadline" label="报价截止"><DatePicker style={{ width: '100%' }} placeholder="选填" /></Form.Item></Col>
            <Col span={24}><Form.Item name="processTypes" label="工序类型"><Select mode="multiple" placeholder="请选择工序类型" options={PROCESS_OPTIONS} /></Form.Item></Col>
            <Col span={24}><Form.Item name="remark" label="备注"><Input.TextArea rows={2} placeholder="工艺/交期等补充说明（选填）" maxLength={200} /></Form.Item></Col>
            <Col span={24}>
              <div style={{ marginBottom: 4 }}>
                <Text>图片 <Text type="danger">*</Text></Text>
              </div>
              <input ref={pubImageFileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handlePubImageFile(f); e.target.value = ''; }} />
              <div
                onClick={() => pubImageFileRef.current?.click()}
                onPaste={handlePubPaste}
                tabIndex={0}
                style={{ width: 120, height: 120, border: '2px dashed #d9d9d9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden', background: '#fafafa' }}>
                {pubImage ? (
                  <img src={pubImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ textAlign: 'center', color: '#999', fontSize: 12 }}>
                    <CameraOutlined style={{ fontSize: 24, display: 'block', marginBottom: 4 }} />
                    点击/粘贴/拍照
                  </div>
                )}
              </div>
              <div style={{ marginTop: 8 }}>
                <Button type="link" size="small" icon={<CameraOutlined />} onClick={handlePubCamera}>拍照</Button>
                {pubImage && (
                  <Button type="link" size="small" danger onClick={() => setPubImage('')} style={{ marginLeft: 8 }}>删除图片</Button>
                )}
              </div>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 详情弹窗：产品详情 + 下方报价记录（角色化脱敏） */}
      <Modal title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{detailRec?.type === 'finished' ? `成品详情 - ${detailRec?.id || ''}` : `发包详情 - ${detailRec?.id || ''}`}</span>
          <Space size={8}>
          {detailRec?.type === 'finished' && detailRec.publisherUsername === owner && (
            <Popconfirm title="下架后商品状态置为已下架，并从成品市场移除，确认下架？" okText="确认下架" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelist(detailRec)}>
              <Button size="small" danger icon={<CloseCircleOutlined />}>下架</Button>
            </Popconfirm>
          )}
          {detailRec?.type === 'finished' && detailRec.publisherUsername === owner && (
            <Button size="small" icon={<EditOutlined />} style={{ marginRight: 24 }} onClick={() => {
              editFinishedForm.setFieldsValue({ shortName: detailRec.shortName, targetPrice: detailRec.targetPrice, unit: detailRec.unit });
              setEditFinishedVisible(true);
            }}>编辑</Button>
          )}
          </Space>
        </div>
      } open={!!detailRec} onCancel={() => { setDetailRec(null); setWonQuoteKey(''); }} width={900}
        footer={detailRec?.type === 'finished' ? (
          <Space>
            <Button onClick={() => { setDetailRec(null); setWonQuoteKey(''); }}>取消</Button>
            {isOwnProduct(detailRec) ? (
              <Tooltip title="不能添加自己公司的商品"><Button type="primary" icon={<ShoppingCartOutlined />} disabled>确认加入购物车</Button></Tooltip>
            ) : (
              <Button type="primary" icon={<ShoppingCartOutlined />} onClick={() => handleAddSkusToCart('detail')}>确认加入购物车</Button>
            )}
          </Space>
        ) : detailRec && detailRec.publisherUsername === owner && detailRec.status !== '已中标' && detailRec.status !== '已关闭' ? (
          <Space>
            <Button onClick={() => { setDetailRec(null); setWonQuoteKey(''); }}>取消</Button>
            <Button type="primary" disabled={!wonQuoteKey} style={{ color: '#fff' }} onClick={() => handleAward(detailRec, wonQuoteKey)}>确认中标</Button>
          </Space>
        ) : undefined}
        okText="确认" cancelText="取消" destroyOnClose>
        {detailRec && (
          <>
            {/* 产品链接 */}
            <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, padding: '8px 12px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <LinkOutlined style={{ color: '#52c41a' }} />
              <span style={{ fontSize: 12, color: '#333', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(() => {
                  const tabKey = detailRec.type === 'finished' ? 'finished' : detailRec.type === 'mold' ? 'mold-market' : 'semi';
                  return `${window.location.origin}/market/opportunity?tab=${tabKey}&productId=${detailRec.id}`;
                })()}
              </span>
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  const tabKey = detailRec.type === 'finished' ? 'finished' : detailRec.type === 'mold' ? 'mold-market' : 'semi';
                  const link = `${window.location.origin}/market/opportunity?tab=${tabKey}&productId=${detailRec.id}`;
                  navigator.clipboard.writeText(link).then(() => message.success('链接已复制'));
                }}
              >
                复制链接
              </Button>
            </div>
            {detailRec.type === 'finished' && (
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={9}>
                  <div style={{ height: 300, background: '#fafafa', border: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: detailImg ? 'zoom-in' : 'default' }}
                    onClick={() => { if (detailImg) { setImgPreviewSrc(detailImg); setImgPreviewVisible(true); } }}>
                    {detailImg ? <img src={detailImg} alt={detailRec.shortName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <ShopOutlined style={{ fontSize: 64, color: '#d9d9d9' }} />}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {detailThumbs.map((t, i) => (
                      <Tooltip key={i} title={t.label}>
                        <div onClick={() => setDetailImg(t.src)} style={{ width: 52, height: 52, border: detailImg === t.src ? '2px solid ' + PRIMARY : '1px solid #d9d9d9', borderRadius: 4, overflow: 'hidden', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
                          <img src={t.src} alt={t.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                      </Tooltip>
                    ))}
                  </div>
                </Col>
                <Col span={15}>
                  <Paragraph strong style={{ fontSize: 16, marginBottom: 8 }}>{detailRec.shortName}</Paragraph>
                  <Space style={{ marginBottom: 8 }}>
                    <Tag color="blue">{detailRec.styleCode}</Tag>
                    {detailRec.auto && detailRec.publisherUsername === owner ? <Tag color="cyan">自动上架</Tag> : null}
                    <Tag color="green">在售</Tag>
                  </Space>
                  <div style={{ background: '#fafafa', padding: '8px 12px', marginBottom: 8 }}>
                    <Text strong style={{ color: '#f5222d', fontSize: 18 }}>供货价 ¥{Number(detailRec.targetPrice) || 0} 起</Text>
                    <Text type="secondary" style={{ marginLeft: 16 }}>零售/基础售价同产品档案</Text>
                  </div>
                  <Descriptions size="small" column={2} bordered>
                    <Descriptions.Item label="款式编码">{detailRec.styleCode || '—'}</Descriptions.Item>
                    <Descriptions.Item label="单位">{detailRec.unit || '件'}</Descriptions.Item>
                    {/* 款式编码行下方插入鞋面材质/鞋底材质行（取同款式产品档案字段） */}
                    <Descriptions.Item label="鞋面材质">{detailVariants[0]?.shoeUpper || detailRec.shoeUpper || '—'}</Descriptions.Item>
                    <Descriptions.Item label="鞋底材质">{detailVariants[0]?.shoeSole || detailRec.shoeSole || '—'}</Descriptions.Item>
                    <Descriptions.Item label="总库存">{detailVariants.reduce((s: number, v: any) => s + (Number(v.actualStock) || 0), 0) || detailRec.quantity || 0}</Descriptions.Item>
                    <Descriptions.Item label="上架时间">{dayjs(detailRec.publishTime).format('YYYY-MM-DD')}</Descriptions.Item>
                    <Descriptions.Item label="供应商" span={2}><CreditTag username={detailRec.publisherUsername} company={detailRec.publisherCompany} openShare /></Descriptions.Item>
                  </Descriptions>
                  {(detailVariants.some(v => v.color) || (Array.isArray(detailRec.variantImages) && detailRec.variantImages.some((e: any) => e.color))) && (
                    <div style={{ marginTop: 8 }}>
                      <Text type="secondary">颜色：</Text>
                      <Space size={4} wrap>
                        <Tag color={!detailColor ? 'blue' : undefined} style={{ cursor: 'pointer' }} onClick={() => setDetailColor('')}>全部</Tag>
                        {Array.from(new Set([...detailVariants.map(v => v.color).filter(Boolean), ...(Array.isArray(detailRec.variantImages) ? detailRec.variantImages.map((e: any) => e.color || '').filter(Boolean) : [])])).map(c => (
                          <Tag key={c} color={detailColor === c ? 'blue' : undefined} style={{ cursor: 'pointer' }} onClick={() => { setDetailColor(c); const vv = detailVariants.find(x => x.color === c); setDetailImg((vv && vv.image) || (vv ? imgOf(detailRec.publisherUsername, vv) : '') || embeddedSrcOf(detailRec, c)); }}>{c}</Tag>
                        ))}
                      </Space>
                    </div>
                  )}
                </Col>
                <Col span={24} style={{ marginTop: 12 }}>
                  <Paragraph strong style={{ marginBottom: 8 }}>规格明细（SKU）</Paragraph>
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                  <Table
                    rowKey={(x: any) => x.key} bordered size="small"
                    dataSource={detailVariants.filter(v => !detailColor || v.color === detailColor)}
                    columns={[
                      { key: 'color', title: '颜色', dataIndex: 'color', width: 100, align: 'center', render: (v: string) => v || '—' },
                      { key: 'spec', title: '尺码/规格', dataIndex: 'spec', width: 120, align: 'center', render: (v: string) => v || '—' },
                      { key: 'productCode', title: 'SKU编码', dataIndex: 'productCode', width: 160, align: 'center' },
                      { key: 'suggestedPrice', title: '供货价', dataIndex: 'suggestedPrice', width: 100, align: 'center', render: (v: number) => <Text strong style={{ color: '#f5222d' }}>¥{Number(v) || 0}</Text> },
                      { key: 'actualStock', title: '库存数', dataIndex: 'actualStock', width: 100, align: 'center', render: (v: number) => `${Number(v) || 0}` },
                      {
                        key: 'qty', title: '数量', width: 90, align: 'center',
                        render: (_: any, x: any) => (
                          <InputNumber controls={false} min={0} style={{ width: 64 }} placeholder="0" value={skuQty[x.key] ?? undefined}
                            onChange={v => setSkuQty(prev => ({ ...prev, [x.key]: Number(v) || 0 }))} />
                        ),
                      },
                      { key: 'productStatus', title: '状态', dataIndex: 'productStatus', width: 90, align: 'center', render: (v: string) => <Tag color={v === '在售' ? 'green' : 'default'}>{v || '—'}</Tag> },
                    ]}
                    pagination={false}
                    locale={{ emptyText: <Empty description="无规格明细" /> }}
                  />
                  </div>
                </Col>
              </Row>
            )}
            {detailRec.type !== 'finished' && (
              <Descriptions bordered size="small" column={3} title="产品详情" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="商品简称">{detailRec.shortName || '—'}</Descriptions.Item>
              <Descriptions.Item label="款式编码">{detailRec.styleCode || '—'}</Descriptions.Item>
              <Descriptions.Item label="商品编码">{detailRec.productCode || '—'}</Descriptions.Item>
              <Descriptions.Item label="数量">{detailRec.quantity || 0} {detailRec.unit || '件'}</Descriptions.Item>
              <Descriptions.Item label="期望单价">{detailRec.targetPrice ? `¥${detailRec.targetPrice}` : '—'}</Descriptions.Item>
              <Descriptions.Item label="报价截止">{detailRec.deadline || '—'}</Descriptions.Item>
              <Descriptions.Item label="工序类型" span={2}>{(detailRec.processTypes || []).join('、') || '—'}</Descriptions.Item>
              <Descriptions.Item label="保证金">{detailRec.deposit ? `¥${detailRec.deposit}（${detailRec.depositStatus || '需缴纳'}）` : '—'}</Descriptions.Item>
              <Descriptions.Item label="发布方" span={2}><CreditTag username={detailRec.publisherUsername} company={detailRec.publisherCompany} /></Descriptions.Item>
              <Descriptions.Item label="状态"><Tag>{detailRec.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="备注" span={3}>{detailRec.remark || '—'}</Descriptions.Item>
            </Descriptions>
            )}
            {detailRec.type !== 'finished' && (<>
            <Paragraph strong style={{ marginBottom: 8 }}>报价记录（{(detailRec.quotes || []).length} 条）</Paragraph>
            <Table
              rowKey="key" bordered size="small" dataSource={detailRec.quotes || []}
              rowSelection={detailRec.publisherUsername === owner && detailRec.status !== '已中标' && detailRec.status !== '已关闭' ? {
                type: 'radio', selectedRowKeys: wonQuoteKey ? [wonQuoteKey] : [],
                onChange: keys => setWonQuoteKey(String(keys[0] || '')),
              } : undefined}
              columns={[
                {
                  key: 'bidder', title: '报价方', width: 180, align: 'center',
                  render: (_: any, q: any) => {
                    // 优先从 registeredUsers 查找正确公司名，回退到存储的 bidderCompany
                    const correctCompany = resolveCompany(q.bidderUsername) || q.bidderCompany;
                    // 发布方查看时不脱敏，显示完整公司名，可点击查看详情
                    if (detailRec.publisherUsername === owner) {
                      return <a onClick={() => setBidderCompanyRec({ username: q.bidderUsername, company: correctCompany, contactPerson: q.contactPerson, contactPhone: q.contactPhone })} style={{ color: '#1890ff', cursor: 'pointer' }}>{correctCompany}</a>;
                    }
                    // 其他查看者：脱敏显示报价方公司名（隐藏中间字符）
                    return <Tooltip title="报价方信息已脱敏"><Text type="secondary">{maskName(correctCompany)}</Text></Tooltip>;
                  },
                },
                {
                  key: 'unitPrice', title: '单价', width: 90, align: 'center',
                  render: (_: any, q: any) => (detailRec.publisherUsername === owner || q.bidderUsername === username) ? `¥${q.unitPrice}` : maskPrice(),
                },
                {
                  key: 'totalPrice', title: '总价', width: 100, align: 'center',
                  render: (_: any, q: any) => (detailRec.publisherUsername === owner || q.bidderUsername === username) ? `¥${q.totalPrice}` : maskPrice(),
                },
                { key: 'quantity', title: '询价数量', width: 90, align: 'center', render: (v: number, q: any) => q.quantity || '—' },
                { key: 'deliveryDays', title: '交期 (天)', width: 90, align: 'center', dataIndex: 'deliveryDays', render: (v: number) => v || '—' },
                { key: 'contact', title: '联系人', width: 140, align: 'center', render: (_: any, q: any) => {
                  // 发布方查看时不脱敏，显示完整联系人
                  if (detailRec.publisherUsername === owner) {
                    return q.contactPerson || '—';
                  }
                  // 其他查看者：脱敏显示联系人姓名（隐藏中间字符）
                  return maskName(q.contactPerson) || '***';
                }},
                { key: 'contactPhone', title: '联系电话', width: 130, align: 'center', render: (_: any, q: any) => {
                  // 发布方查看时显示完整联系电话
                  if (detailRec.publisherUsername === owner) {
                    return q.contactPhone || '—';
                  }
                  // 其他查看者：不显示
                  return '—';
                }},
                { key: 'quoteTime', title: '报价时间', width: 150, align: 'center', render: (_: any, q: any) => dayjs(q.quoteTime).format('YYYY-MM-DD HH:mm') },
                { key: 'status', title: '状态', width: 80, align: 'center', render: (_: any, q: any) => <Tag color={q.status === '中标' ? 'green' : q.status === '落选' ? 'default' : 'blue'}>{q.status}</Tag> },
              ]}
              pagination={false}
              locale={{ emptyText: <Empty description="暂无报价记录" /> }}
            />
            </>)}
          </>
        )}
      </Modal>

      {/* 图片预览弹窗 */}
      <Modal
        open={imgPreviewVisible}
        onCancel={() => setImgPreviewVisible(false)}
        footer={null}
        width={800}
        centered
        destroyOnClose
      >
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <img src={imgPreviewSrc} alt="预览" style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
        </div>
      </Modal>

      {/* 报价方公司详情弹窗 */}
      <Modal
        title={`报价方详情 - ${bidderCompanyRec?.company || ''}`}
        open={!!bidderCompanyRec}
        onCancel={() => setBidderCompanyRec(null)}
        footer={<Button onClick={() => setBidderCompanyRec(null)}>关闭</Button>}
        width={520}
        centered
        destroyOnClose
      >
        {bidderCompanyRec && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="公司名称">{bidderCompanyRec.company || '—'}</Descriptions.Item>
            <Descriptions.Item label="账号">{bidderCompanyRec.username || '—'}</Descriptions.Item>
            <Descriptions.Item label="联系人">{bidderCompanyRec.contactPerson || '—'}</Descriptions.Item>
            <Descriptions.Item label="联系电话">{bidderCompanyRec.contactPhone || '—'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* 报价/询价弹窗 */}
      <Modal title={quoteRec?.type === 'finished' ? '成品询价/报价' : '提交报价'} open={!!quoteRec} onOk={handleQuote} onCancel={() => setQuoteRec(null)} okText="提交" cancelText="取消" width={520} destroyOnClose>
        <Form autoComplete="off" form={quoteForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="unitPrice" label="单价(元)" rules={[{ required: true, message: '请输入单价' }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="您的报价单价" /></Form.Item>
          <Form.Item name="quantity" label="数量" initialValue={quoteRec?.quantity}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="deliveryDays" label="交期(天)"><InputNumber min={1} style={{ width: '100%' }} placeholder="承诺交期天数" /></Form.Item>
          <Form.Item name="contactPerson" label="联系人"><Input placeholder="自动带出注册联系人，可修改" /></Form.Item>
          <Form.Item name="contactPhone" label="联系电话"><Input placeholder="选填" /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} placeholder="选填" maxLength={200} /></Form.Item>
        </Form>
      </Modal>

      {/* 加入购物车弹窗：成品市场点击购物车按钮时弹出，显示商品明细（SKU）供选择，输入数量后确认 */}
      <Modal title={`加入购物车 - ${addToCartModalRec?.shortName || ''}（${addToCartModalRec?.styleCode || ''}）`} open={!!addToCartModalRec} onCancel={() => { setAddToCartModalRec(null); setAddToCartSkuQty({}); setAddToCartColor(''); setAddToCartImg(''); }} width={780}
        footer={
          <Space>
            <Button onClick={() => { setAddToCartModalRec(null); setAddToCartSkuQty({}); setAddToCartColor(''); setAddToCartImg(''); }}>取消</Button>
            <Button type="primary" icon={<ShoppingCartOutlined />} onClick={() => handleAddSkusToCart('addCart')}>确认加入购物车</Button>
          </Space>
        }
        destroyOnClose>
        {addToCartModalRec && (() => {
          return (
            <>
              <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={8}>
                <div style={{ height: 200, background: '#fafafa', border: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {addToCartImg ? <img src={addToCartImg} alt={addToCartModalRec.shortName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <ShopOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />}
                </div>
              </Col>
              <Col span={16}>
                <Paragraph strong style={{ fontSize: 15, marginBottom: 6 }}>{addToCartModalRec.shortName}</Paragraph>
                <Space style={{ marginBottom: 6 }}>
                  <Tag color="blue">{addToCartModalRec.styleCode}</Tag>
                  {addToCartModalRec.auto && addToCartModalRec.publisherUsername === owner ? <Tag color="cyan">自动上架</Tag> : null}
                  <Tag color="green">在售</Tag>
                </Space>
                <div style={{ background: '#fafafa', padding: '6px 10px', marginBottom: 6 }}>
                  <Text strong style={{ color: '#f5222d', fontSize: 16 }}>供货价 ¥{Number(addToCartModalRec.targetPrice) || 0} 起</Text>
                </div>
                <Descriptions size="small" column={2} bordered>
                  <Descriptions.Item label="商品编码">{addToCartModalRec.productCode || '—'}</Descriptions.Item>
                  <Descriptions.Item label="单位">{addToCartModalRec.unit || '件'}</Descriptions.Item>
                  <Descriptions.Item label="总库存">{addToCartVariants.reduce((s: number, v: any) => s + (Number(v.actualStock) || 0), 0) || addToCartModalRec.quantity || 0}</Descriptions.Item>
                  <Descriptions.Item label="供应商"><CreditTag username={addToCartModalRec.publisherUsername} company={addToCartModalRec.publisherCompany} /></Descriptions.Item>
                </Descriptions>
                {addToCartVariants.some(v => v.color) && (
                  <div style={{ marginTop: 6 }}>
                    <Text type="secondary">颜色：</Text>
                    <Space size={4} wrap>
                      <Tag color={!addToCartColor ? 'blue' : undefined} style={{ cursor: 'pointer' }} onClick={() => { setAddToCartColor(''); setAddToCartImg(addToCartModalRec.image || imgOf(addToCartModalRec.publisherUsername, { key: addToCartModalRec.productKey })); }}>全部</Tag>
                      {Array.from(new Set([...addToCartVariants.map(v => v.color).filter(Boolean), ...(Array.isArray(addToCartModalRec?.variantImages) ? addToCartModalRec.variantImages.map((e: any) => e.color || '').filter(Boolean) : [])])).map(c => (
                        <Tag key={c} color={addToCartColor === c ? 'blue' : undefined} style={{ cursor: 'pointer' }} onClick={() => { setAddToCartColor(c); const vv = addToCartVariants.find(x => x.color === c); setAddToCartImg((vv && vv.image) || (vv ? imgOf(addToCartModalRec.publisherUsername, vv) : '') || embeddedSrcOf(addToCartModalRec, c)); }}>{c}</Tag>
                      ))}
                    </Space>
                  </div>
                )}
              </Col>
            </Row>
            <Paragraph strong style={{ marginBottom: 6 }}>规格明细（SKU）— 请输入采购数量</Paragraph>
            <Table
              rowKey={(x: any) => x.key} bordered size="small"
              dataSource={addToCartVariants.filter(v => !addToCartColor || v.color === addToCartColor)}
              columns={[
                { key: 'color', title: '颜色', dataIndex: 'color', width: 90, align: 'center', render: (v: string) => v || '—' },
                { key: 'spec', title: '尺码/规格', dataIndex: 'spec', width: 110, align: 'center', render: (v: string) => v || '—' },
                { key: 'productCode', title: 'SKU编码', dataIndex: 'productCode', width: 150, align: 'center' },
                { key: 'suggestedPrice', title: '供货价', dataIndex: 'suggestedPrice', width: 90, align: 'center', render: (v: number) => <Text strong style={{ color: '#f5222d' }}>¥{Number(v) || 0}</Text> },
                { key: 'actualStock', title: '库存数', dataIndex: 'actualStock', width: 80, align: 'center', render: (v: number) => `${Number(v) || 0}` },
                {
                  key: 'qty', title: '采购数量', width: 100, align: 'center',
                  render: (_: any, x: any) => (
                    <InputNumber controls={false} min={0} style={{ width: 72 }} placeholder="0" value={addToCartSkuQty[x.key] ?? undefined}
                      onChange={v => setAddToCartSkuQty(prev => ({ ...prev, [x.key]: Number(v) || 0 }))} />
                  ),
                },
                { key: 'productStatus', title: '状态', dataIndex: 'productStatus', width: 80, align: 'center', render: (v: string) => <Tag color={v === '在售' ? 'green' : 'default'}>{v || '—'}</Tag> },
              ]}
              pagination={false}
              locale={{ emptyText: <Empty description="无规格明细" /> }}
            />
            </>
          );
        })()}
      </Modal>

      {/* 收藏夹抽屉 */}
      <Drawer title={`收藏夹（${liveFavorites.length}）`} open={favVisible} onClose={() => setFavVisible(false)} width={420}>
        {liveFavorites.length === 0 ? <Empty description="暂无收藏" /> : liveFavorites.map(f => {
          const rec = market.find(r => r.key === f.cardKey);
          const img = rec ? (rec.image || imgOf(rec.publisherUsername, { key: rec.productKey })) : '';
          return (
            <Card size="small" key={f.cardKey} style={{ marginBottom: 8 }}
              extra={<Space><Button size="small" onClick={() => rec && addToCart(rec)}>加购</Button><Button size="small" danger onClick={() => rec && toggleFav(rec)}>取消</Button></Space>}>
              {/* 左图右文布局：商品图片 + 名称/价格/供应商 */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ width: 72, height: 72, flexShrink: 0, border: '1px solid #f0f0f0', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa' }}>
                  {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ShopOutlined style={{ color: '#d9d9d9', fontSize: 24 }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rec ? `${rec.shortName}（${rec.styleCode}）` : f.styleCode}</div>
                  {rec ? (
                    <>
                      <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>供货价 <span style={{ color: '#f5222d', fontWeight: 600 }}>¥{Number(rec.targetPrice) || 0}</span> / {rec.unit || '件'}</div>
                      <div style={{ fontSize: 12, color: '#888', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><CreditTag username={rec.publisherUsername} company={resolveCompany(rec.publisherUsername) || rec.publisherCompany} /></div>
                    </>
                  ) : <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>商品已下架</div>}
                </div>
              </div>
            </Card>
          );
        })}
      </Drawer>

      {/* 购物车抽屉：按供应商分组 + 勾选 + 删除 + 批量询价/立即下单 */}
      <Drawer title={`购物车（${cart.length}）`} open={cartVisible} onClose={() => setCartVisible(false)} width={560}
        extra={<Space><Button onClick={cartBatchQuote}>批量询价</Button><Button type="primary" onClick={handleOpenOrder}>立即下单</Button></Space>}>
        {cart.length === 0 ? <Empty description="购物车为空" /> : cartGroups.map(([sup, g]) => {
          const gkeys = g.items.map((x: any) => x._key);
          const allOn = gkeys.every(k => cartChecked.includes(k));
          return (
            <Card size="small" key={sup} style={{ marginBottom: 10 }}
              title={
                <Space>
                  <Checkbox checked={allOn} onChange={e => toggleGroupCheck(gkeys, e.target.checked)} />
                  <Text strong>{g.rec.publisherCompany}</Text>
                  <CreditTag username={sup} />
                </Space>
              }>
              {g.items.map((c: any) => {
                const ck = c._key;
                const img = c.sku?.image || imgOf(sup, { key: g.rec.productKey, image: g.rec.image });
                const price = Number(c.sku?.unitPrice ?? g.rec.targetPrice) || 0;
                return (
                  <div key={ck} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px dashed #f0f0f0' }}>
                    <Checkbox checked={cartChecked.includes(ck)} onChange={e => toggleGroupCheck([ck], e.target.checked)} />
                    <div style={{ width: 44, height: 44, flexShrink: 0, border: '1px solid #f0f0f0', borderRadius: 4, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa' }}>
                      {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ShopOutlined style={{ color: '#d9d9d9' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{c.sku?.shortName || g.rec.shortName}</div>
                      <div style={{ fontSize: 12, color: '#888' }}>
                        {c.styleCode}{c.sku?.color ? ` / ${c.sku.color}` : ''}{c.sku?.spec ? ` / ${c.sku.spec}` : ''}{c.sku?.productCode ? ` / ${c.sku.productCode}` : ''}
                      </div>
                    </div>
                    <div style={{ width: 70, textAlign: 'right', color: '#f5222d', fontWeight: 600 }}>¥{price}</div>
                    <div style={{ width: 50, textAlign: 'center' }}>×{c.quantity}</div>
                    <Button size="small" danger icon={<CloseOutlined />} onClick={() => {
                      setCart(prev => { const next = prev.filter(x => (x.itemKey || x.cardKey) !== ck); saveJson(`market_cart_${username}`, next); return next; });
                      setCartChecked(prev => prev.filter(k => k !== ck));
                    }}>删除</Button>
                  </div>
                );
              })}
              <div style={{ textAlign: 'right', marginTop: 6 }}>
                <Text type="secondary">小计：</Text>
                <Text strong style={{ color: '#f5222d' }}>¥{g.items.reduce((s: number, c: any) => s + (Number(c.sku?.unitPrice ?? g.rec.targetPrice) || 0) * (Number(c.quantity) || 0), 0)}</Text>
              </div>
            </Card>
          );
        })}
      </Drawer>

      {/* 立即下单弹窗：地址默认注册账号地址，可修改 */}
      <Modal title="确认订单 - 收货信息" open={orderVisible} onOk={handleConfirmOrder} onCancel={() => setOrderVisible(false)} okText="下一步：确认付款" cancelText="取消" width={560} destroyOnClose>
        <Paragraph type="secondary" style={{ marginTop: 12 }}>
          共 {checkedItems.length} 件商品，合计 ¥{checkedItems.reduce((s: number, c: any) => { const rec = market.find(r => r.key === c.cardKey); return s + (Number(c.sku?.unitPrice ?? rec?.targetPrice) || 0) * (Number(c.quantity) || 0); }, 0)}；地址默认取注册账号地址，可手动修改。
        </Paragraph>
        <Form autoComplete="off" form={orderForm} layout="vertical">
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="province" label="省份" rules={[{ required: true, message: '请选择省份' }]} style={{ width: '25%', marginRight: 4 }}>
              <Select placeholder="省份" allowClear showSearch options={getProvinceOptions()}
                onChange={() => orderForm.setFieldsValue({ city: undefined, district: undefined })} />
            </Form.Item>
            <Form.Item name="city" label="城市" rules={[{ required: true, message: '请选择城市' }]} style={{ width: '25%', marginRight: 4 }}>
              <Select placeholder="城市" allowClear showSearch options={getCityOptions(ordProvince)}
                onChange={() => orderForm.setFieldsValue({ district: undefined })} />
            </Form.Item>
            <Form.Item name="district" label="区/县" rules={[{ required: true, message: '请选择区/县' }]} style={{ width: '25%', marginRight: 4 }}>
              <Select placeholder="区/县" allowClear showSearch options={getDistrictOptions(ordProvince, ordCity)} />
            </Form.Item>
            <Form.Item name="addressDetail" label="详细地址" rules={[{ required: true, message: '请输入详细地址' }]} style={{ width: '25%' }}>
              <Input placeholder="街道、门牌号等" />
            </Form.Item>
          </Space.Compact>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="contactPerson" label="联系人" rules={[{ required: true, message: '请输入联系人' }]} style={{ width: '50%', marginRight: 8 }}>
              <Input placeholder="联系人" />
            </Form.Item>
            <Form.Item name="contactPhone" label="联系电话" style={{ width: '50%' }}>
              <Input placeholder="联系电话" />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="remark" label="备注" extra="备注将写入采购订单的买家留言">
            <Input.TextArea rows={2} placeholder="订单备注（选填）" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 供应商收款信息 + 上传付款截图 + 确认付款 */}
      <Modal title="供应商收款信息 - 确认付款" open={payVisible} onOk={handleConfirmPay} onCancel={() => { setPayVisible(false); setPayChannelMap({}); setPayMethodMap({}); }} okText="确认付款" cancelText="取消" width={680} destroyOnClose>
        {(() => {
          const sups = Array.from(new Set(checkedItems.map(c => { const rec = market.find(r => r.key === c.cardKey); return rec?.publisherUsername; }).filter(Boolean)));
          let users: any[] = [];
          try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { /* ignore */ }
          return sups.map(sup => {
            const u = users.find((x: any) => x.username === sup);
            const payMethod = payMethodMap[sup] || '银行转账';
            const availableCredit = getSupplierAvailableCredit(sup);
            return (
              <Card size="small" key={sup} style={{ marginBottom: 10 }} title={<Text strong>{u?.companyName || sup}</Text>}>
                {/* 付款方式选择 */}
                <div style={{ marginBottom: 10 }}>
                  <Text type="secondary">付款方式：</Text>
                  <Radio.Group
                    style={{ marginLeft: 8 }}
                    value={payMethod}
                    onChange={e => setPayMethodMap(prev => ({ ...prev, [sup]: e.target.value }))}
                  >
                    <Radio.Button value="银行转账">银行转账</Radio.Button>
                    <Radio.Button value="余额支付">余额支付</Radio.Button>
                  </Radio.Group>
                </div>
                {/* 银行转账：显示收款信息 + 账户勾选 */}
                {payMethod === '银行转账' && (
                  <>
                    <Paragraph style={{ marginBottom: 6 }}><Text type="secondary">收款银行账户：</Text>{u?.payBankInfo ? <span style={{ whiteSpace: 'pre-wrap' }}>{u.payBankInfo}</span> : <Tag color="orange">未完善</Tag>}</Paragraph>
                    <div style={{ marginBottom: 8 }}>
                      <Text type="secondary">收款码：</Text>
                      {u?.payQrImage ? <Image src={u.payQrImage} alt="收款码" width={140} style={{ maxHeight: 140, objectFit: 'contain', borderRadius: 6, border: '1px solid #eee', marginLeft: 8 }} /> : <Tag color="orange">未完善</Tag>}
                    </div>
                    <div>
                      <Text type="secondary">付款账户勾选：</Text>
                      <Radio.Group
                        style={{ marginLeft: 8 }}
                        value={payChannelMap[sup] || (u?.payBankInfo ? 'bank' : 'qr')}
                        onChange={e => setPayChannelMap(prev => ({ ...prev, [sup]: e.target.value }))}
                      >
                        <Radio value="bank" disabled={!u?.payBankInfo}>银行账户</Radio>
                        <Radio value="qr" disabled={!u?.payQrImage}>收款码</Radio>
                      </Radio.Group>
                      <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>（二者仅可勾选其一，财务审核将显示勾选的账户）</Text>
                    </div>
                  </>
                )}
                {/* 余额支付：显示剩余额度 */}
                {payMethod === '余额支付' && (
                  <div style={{ padding: '8px 12px', background: '#f6f8fa', borderRadius: 6 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>供应商信用额度：</Text>
                    <Text strong style={{ color: '#1890ff', marginLeft: 4 }}>¥{calcSupplierCredit(sup).toFixed(2)}</Text>
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 16 }}>可用额度：</Text>
                    <Text strong style={{ color: availableCredit < 0 ? '#ff4d4f' : '#52c41a', marginLeft: 4, fontSize: 14 }}>¥{availableCredit.toFixed(2)}</Text>
                  </div>
                )}
              </Card>
            );
          });
        })()}
        <Paragraph style={{ marginTop: 8, marginBottom: 6 }}><Text strong>付款转账截图：</Text><Text type="danger">*</Text></Paragraph>
        <div
          tabIndex={0}
          onPaste={(e) => {
            const cd = (e as any).clipboardData as DataTransfer | undefined;
            if (!cd) return;
            const items = Array.from(cd.items || []);
            for (const it of items) {
              if (it.type.startsWith('image/')) {
                const file = it.getAsFile();
                if (file) { const reader = new FileReader(); reader.onload = () => setPayShot(reader.result as string); reader.readAsDataURL(file); }
                break;
              }
            }
          }}
          style={{ width: 120, height: 120, border: '1px dashed #d9d9d9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12, cursor: 'pointer', overflow: 'hidden' }}
          onClick={() => document.getElementById('payShotUpload')?.click()}
        >
          {payShot ? <img src={payShot} alt="付款截图" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : '点击/粘贴上传'}
        </div>
        <input type="file" accept="image/*" style={{ display: 'none' }} id="payShotUpload"
          onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setPayShot(reader.result as string); reader.readAsDataURL(file); }} />
        <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>转账完成后上传截图，点击确认付款即生成订单</div>
      </Modal>

      {/* 比价弹窗：同款式编码多供应商横向对比 */}
      <Modal title="成品比价（同款式编码横向对比）" open={compareVisible} onCancel={() => setCompareVisible(false)} footer={<Button onClick={() => setCompareVisible(false)}>关闭</Button>} width={900}>
        <Space style={{ marginBottom: 12 }}>
          <span>款式编码：</span>
          <Select style={{ width: 220 }} value={compareCode || undefined} onChange={setCompareCode} options={styleCodes.map(c => ({ value: c, label: c }))} placeholder="选择款式编码" />
        </Space>
        <Table rowKey="key" bordered size="small" dataSource={compareRows}
          columns={[
            { key: 'rank', title: '价格排名', width: 90, align: 'center', render: (_: any, __: any, i: number) => i === 0 ? <Tag color="green">最低</Tag> : i + 1 },
            { key: 'publisher', title: '供应商', width: 200, align: 'center', render: (_: any, r: any) => <CreditTag username={r.publisherUsername} company={resolveCompany(r.publisherUsername) || r.publisherCompany} /> },
            { key: 'price', title: '供货价', width: 100, align: 'center', render: (_: any, r: any) => <Text strong style={{ color: '#f5222d' }}>¥{Number(r.targetPrice) || 0}</Text> },
            { key: 'quotes', title: '询价数', width: 80, align: 'center', render: (_: any, r: any) => (r.quotes || []).length },
            { key: 'status', title: '状态', width: 90, align: 'center', render: (_: any, r: any) => <Tag>{r.status}</Tag> },
            { key: 'op', title: '操作', width: 140, align: 'center', render: (_: any, r: any) => <Space><Button size="small" onClick={() => { addToCart(r); }}>加购</Button><Button size="small" onClick={() => { setCompareVisible(false); openDetail(r); }}>详情</Button></Space> },
          ]}
          pagination={false} locale={{ emptyText: <Empty description="该款式编码暂无上架商品" /> }} />
      </Modal>

      {/* 手动发布弹窗 */}
      <Modal title="手动发布成品到市场" open={manualPublishVisible} onCancel={() => { setManualPublishVisible(false); setManualPublishSelected(new Set()); const resetSearch = { styleCode: '', hasImage: '', published: '' }; setManualPublishSearch(resetSearch); setManualPublishAppliedSearch(resetSearch); }} width={700}
        footer={
          <Space>
            <Button onClick={() => { setManualPublishVisible(false); setManualPublishSelected(new Set()); const resetSearch = { styleCode: '', hasImage: '', published: '' }; setManualPublishSearch(resetSearch); setManualPublishAppliedSearch(resetSearch); }}>取消</Button>
            <Button type="primary" onClick={handleManualPublish}>确认发布</Button>
          </Space>
        }>
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary">勾选需要发布的成品款式（按款式编码分组）；无图片、基础价为 0 或不大于成本价的款式不可发布</Text>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input placeholder="搜索款式编码" allowClear style={{ width: 160 }} value={manualPublishSearch.styleCode} onChange={e => setManualPublishSearch(prev => ({ ...prev, styleCode: e.target.value }))} />
          <Select placeholder="图片" allowClear style={{ width: 100 }} value={manualPublishSearch.hasImage || undefined} onChange={v => setManualPublishSearch(prev => ({ ...prev, hasImage: v || '' }))} options={[{ value: 'yes', label: '有图片' }, { value: 'no', label: '无图片' }]} />
          <Select placeholder="发布情况" allowClear style={{ width: 120 }} value={manualPublishSearch.published || undefined} onChange={v => setManualPublishSearch(prev => ({ ...prev, published: v || '' }))} options={[{ value: 'yes', label: '已发布' }, { value: 'no', label: '未发布' }]} />
          <Button type="primary" size="small" icon={<SearchOutlined />} onClick={() => setManualPublishAppliedSearch(manualPublishSearch)}>查询</Button>
        </div>
        <Table rowKey="styleCode" bordered size="small" dataSource={manualPublishProducts.reduce((acc: any[], p) => {
          const exist = acc.find(x => x.styleCode === p.styleCode);
          if (!exist) acc.push({ styleCode: p.styleCode, shortName: p.shortName, productCode: p.productCode, unit: p.unit, suggestedPrice: p.suggestedPrice, costPrice: p.costPrice, actualStock: p.actualStock, key: p.key, image: p.image });
          else if (!isPricePublishable(exist) && isPricePublishable(p)) Object.assign(exist, { shortName: p.shortName, productCode: p.productCode, unit: p.unit, suggestedPrice: p.suggestedPrice, costPrice: p.costPrice, actualStock: p.actualStock, key: p.key, image: p.image });
          return acc;
        }, []).filter(r => {
          const hasImg = r.image || localStorage.getItem(`prodImg_${username}_${r.key}`);
          const isPublished = market.some(m => m.styleCode === r.styleCode && m.publisherUsername === username);
          if (manualPublishAppliedSearch.styleCode && !r.styleCode.toLowerCase().includes(manualPublishAppliedSearch.styleCode.toLowerCase())) return false;
          if (manualPublishAppliedSearch.hasImage === 'yes' && !hasImg) return false;
          if (manualPublishAppliedSearch.hasImage === 'no' && hasImg) return false;
          if (manualPublishAppliedSearch.published === 'yes' && !isPublished) return false;
          if (manualPublishAppliedSearch.published === 'no' && isPublished) return false;
          return true;
        })}
          rowSelection={{
            selectedRowKeys: Array.from(manualPublishSelected),
            onChange: (keys) => setManualPublishSelected(new Set(keys as string[])),
            getCheckboxProps: (record) => ({
              disabled: (!record.image && !localStorage.getItem(`prodImg_${username}_${record.key}`)) || !isPricePublishable(record),
            }),
          }}
          columns={[
            { key: 'styleCode', title: '款式编码', dataIndex: 'styleCode', width: 120, align: 'center' },
            { key: 'shortName', title: '商品简称', dataIndex: 'shortName', width: 150, align: 'center', render: (v: string) => v || '—' },
            { key: 'productCode', title: '商品编码', dataIndex: 'productCode', width: 120, align: 'center', render: (v: string) => v || '—' },
            { key: 'unit', title: '单位', dataIndex: 'unit', width: 60, align: 'center', render: (v: string) => v || '件' },
            { key: 'suggestedPrice', title: '建议售价', dataIndex: 'suggestedPrice', width: 90, align: 'center', render: (v: number) => `¥${Number(v) || 0}` },
            { key: 'priceOk', title: '价格资格', width: 90, align: 'center', render: (_: any, r: any) => (
              isPricePublishable(r)
                ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                : <Tooltip title="基础价不等于 0 且大于成本价才能发布"><CloseCircleOutlined style={{ color: '#ff4d4f' }} /></Tooltip>
            ) },
            { key: 'actualStock', title: '库存', dataIndex: 'actualStock', width: 70, align: 'center', render: (v: number) => Number(v) || 0 },
            { key: 'published', title: '发布情况', width: 90, align: 'center', render: (_: any, r: any) => {
              const isPublished = market.some(m => m.styleCode === r.styleCode && m.publisherUsername === owner);
              return isPublished ? <CheckCircleOutlined style={{ color: '#1890ff' }} /> : <Text type="secondary">未发布</Text>;
            }},
            { key: 'image', title: '图片', width: 70, align: 'center', render: (_: any, r: any) => {
              const hasImg = r.image || localStorage.getItem(`prodImg_${owner}_${r.key}`);
              return hasImg ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
            }},
          ]}
          pagination={false}
          locale={{ emptyText: <Empty description="暂无在售成品" /> }}
        />
      </Modal>

      {/* 成品编辑弹窗 */}
      <Modal title="编辑成品信息" open={editFinishedVisible} onCancel={() => setEditFinishedVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setEditFinishedVisible(false)}>取消</Button>
            <Button type="primary" onClick={handleSaveFinishedEdit}>保存</Button>
          </Space>
        } width={480}>
        <Form autoComplete="off" form={editFinishedForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="shortName" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="默认：货号-鞋底材质-鞋面材质-码段-颜色，可手动修改" />
          </Form.Item>
          <Form.Item name="targetPrice" label="供货价(元)" rules={[{ required: true, message: '请输入供货价' }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="请输入供货价" />
          </Form.Item>
          <Form.Item name="unit" label="单位">
            <Input placeholder="如：件、双、套" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default MarketPage;
