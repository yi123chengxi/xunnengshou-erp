/**
 * 图片空间（云端图片库）
 *
 * 设计要点：
 * - 二进制落盘 server/uploads/images/<ownerDir>/，由 Nginx 的 /uploads 静态直出，
 *   全平台任意账号可直接用 URL 引用（用户选择「全平台公开」）；
 * - 元信息（名称/尺寸/标签/引用位置）存数据集键 image_assets_<owner>，复用统一数据访问层，
 *   换电脑登录 /api/images 即可看到同一份图片清单；
 * - 引用位置 refs 由业务页面在使用图片时登记，图片空间详情页据此展示「被哪些地方引用」。
 *
 * 为什么不放进 /api/sync：图片是 MB 级二进制，整键上传会把数据集同步链路拖垮；
 * 索引本身很小（每张 ~200 字节），保留在数据集层便于按租户隔离与备份。
 */
import express, { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { store } from '../database/store';
import { requireSyncAuth, currentSyncUser, SyncUser } from '../middleware/syncGuard';

const router = Router();
router.use(express.json({ limit: '60mb' }));
router.use(requireSyncAuth);

/** 编译后 __dirname = server/dist/routes，与 app.ts 的 ../uploads 对齐到 server/uploads */
const UPLOAD_ROOT = path.join(__dirname, '../../uploads/images');
/** 单张图片上限（base64 解码后字节） */
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_NAME_LEN = 120;
const MAX_REFS = 200;
const ALLOWED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export interface ImageRef {
  /** 去重键：module/child/record/field */
  key: string;
  module: string;
  moduleLabel: string;
  childKey: string;
  childLabel: string;
  recordKey: string;
  recordName: string;
  field: string;
  at: number;
}

export interface ImageAsset {
  id: string;
  name: string;
  url: string;
  thumbUrl: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  tags: string[];
  owner: string;
  uploader: string;
  createdAt: number;
  updatedAt: number;
  refs: ImageRef[];
}

const indexKeyOf = (owner: string): string => `image_assets_${owner}`;

/** 账号目录名：保留可读前缀 + 哈希后缀，避免中文/特殊字符与同名碰撞 */
function ownerDir(owner: string): string {
  const safe = String(owner || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
  const hash = crypto.createHash('sha1').update(String(owner || '')).digest('hex').slice(0, 8);
  return `${safe || 'u'}_${hash}`;
}

function newId(): string {
  return `img_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

/** 索引读改写串行化：并发上传/改引用时避免相互覆盖（同账号并发写同一份索引 JSON） */
const lockChain = new Map<string, Promise<unknown>>();
function withOwnerLock<T>(owner: string, fn: () => Promise<T>): Promise<T> {
  const prev = lockChain.get(owner) || Promise.resolve();
  const next = prev.then(fn, fn);
  lockChain.set(owner, next.catch(() => undefined));
  return next;
}

async function readIndex(owner: string): Promise<ImageAsset[]> {
  try {
    const row = await store.getDataset(indexKeyOf(owner));
    if (!row) return [];
    const parsed = JSON.parse(row.dataset_json);
    return Array.isArray(parsed) ? (parsed as ImageAsset[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(owner: string, list: ImageAsset[]): Promise<number> {
  const ts = Date.now();
  await store.forceUpsertDataset(indexKeyOf(owner), JSON.stringify(list), owner, ts);
  return ts;
}

function parseDataUrl(dataUrl: unknown): { mime: string; buf: Buffer } | null {
  if (typeof dataUrl !== 'string') return null;
  // 只接受 base64 位图；显式拒绝 svg（可内嵌脚本，静态直出会形成同源 XSS）
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (!ALLOWED_MIME[mime]) return null;
  const buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  if (buf.length === 0 || buf.length > MAX_BYTES) return null;
  return { mime, buf };
}

async function saveBinary(owner: string, id: string, suffix: string, dataUrl: unknown): Promise<{ url: string; size: number; mime: string } | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const dir = path.join(UPLOAD_ROOT, ownerDir(owner));
  await fs.promises.mkdir(dir, { recursive: true });
  const file = `${id}${suffix}.${ALLOWED_MIME[parsed.mime]}`;
  await fs.promises.writeFile(path.join(dir, file), parsed.buf);
  return {
    url: `/uploads/images/${ownerDir(owner)}/${file}`,
    size: parsed.buf.length,
    mime: parsed.mime,
  };
}

/** 删除本租户目录下的文件；只允许落在 UPLOAD_ROOT 内，防止路径穿越 */
async function removeBinary(url: string, owner: string): Promise<void> {
  try {
    const prefix = `/uploads/images/${ownerDir(owner)}/`;
    if (!url || !url.startsWith(prefix)) return;
    const target = path.resolve(UPLOAD_ROOT, url.slice('/uploads/images/'.length));
    if (!target.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) return;
    await fs.promises.unlink(target);
  } catch {
    /* 文件已不存在时忽略 */
  }
}

function sanitizeName(name: unknown, fallback = '未命名图片'): string {
  const text = String(name || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, MAX_NAME_LEN);
  return text || fallback;
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    const v = String(t || '').trim().slice(0, 24);
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= 12) break;
  }
  return out;
}

function normalizeRef(raw: any, user: SyncUser): ImageRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const module = String(raw.module || '').slice(0, 48);
  const childKey = String(raw.childKey || '').slice(0, 48);
  const recordKey = String(raw.recordKey || '').slice(0, 96);
  const field = String(raw.field || 'image').slice(0, 32);
  if (!module || !recordKey) return null;
  return {
    key: `${module}/${childKey}/${recordKey}/${field}`,
    module,
    moduleLabel: String(raw.moduleLabel || '').slice(0, 32),
    childKey,
    childLabel: String(raw.childLabel || '').slice(0, 32),
    recordKey,
    recordName: String(raw.recordName || '').slice(0, 120),
    field,
    at: Date.now(),
  };
}

function addRef(list: ImageRef[], ref: ImageRef): ImageRef[] {
  const next = list.filter(r => r && r.key !== ref.key);
  next.push(ref);
  return next.slice(-MAX_REFS);
}

/** 列表项精简：详情页才需要完整 refs，列表返回引用数量即可，降低传输体积 */
function toListItem(a: ImageAsset) {
  return {
    id: a.id, name: a.name, url: a.url, thumbUrl: a.thumbUrl,
    mime: a.mime, size: a.size, width: a.width, height: a.height,
    tags: a.tags, owner: a.owner, uploader: a.uploader,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
    refCount: Array.isArray(a.refs) ? a.refs.length : 0,
  };
}

function sortByCreatedDesc(list: ImageAsset[]): ImageAsset[] {
  return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ============ 列表 ============

/** GET /api/images?scope=mine|all&q=&tag=&limit=&offset= */
router.get('/', async (req: Request, res: Response) => {
  try {
    const user = currentSyncUser(req) as SyncUser;
    const scope = String(req.query.scope || 'mine');
    const q = String(req.query.q || '').trim().toLowerCase();
    const tag = String(req.query.tag || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let all: ImageAsset[] = [];
    if (scope === 'all') {
      // 全平台公开模式：汇总各租户索引（索引键格式固定，避免遍历全部业务键）
      const metas = await store.getAllMeta();
      const owners = metas
        .map(m => String(m.dataset_key || ''))
        .filter(k => k.startsWith('image_assets_'))
        .map(k => k.slice('image_assets_'.length))
        .filter(Boolean);
      const lists = await Promise.all(owners.map(o => readIndex(o)));
      all = lists.flat();
    } else {
      all = await readIndex(user.owner || user.username);
    }

    let items = sortByCreatedDesc(all);
    if (q) {
      items = items.filter(a =>
        String(a.name || '').toLowerCase().includes(q) ||
        String(a.id || '').toLowerCase().includes(q) ||
        (Array.isArray(a.tags) && a.tags.some(t => String(t).toLowerCase().includes(q))) ||
        (Array.isArray(a.refs) && a.refs.some(r => String(r.recordName || '').toLowerCase().includes(q)))
      );
    }
    if (tag) items = items.filter(a => Array.isArray(a.tags) && a.tags.includes(tag));

    res.json({
      code: 0,
      data: {
        total: items.length,
        items: items.slice(offset, offset + limit).map(toListItem),
      },
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message || '图片列表读取失败' });
  }
});

/** GET /api/images/lookup?ids=a,b,c —— 业务页面按 id 批量解析图片 */
router.get('/lookup', async (req: Request, res: Response) => {
  try {
    const user = currentSyncUser(req) as SyncUser;
    const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 200);
    if (ids.length === 0) { res.json({ code: 0, data: {} }); return; }
    const mine = await readIndex(user.owner || user.username);
    const map: Record<string, any> = {};
    for (const a of mine) if (ids.includes(a.id)) map[a.id] = toListItem(a);
    res.json({ code: 0, data: map });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message || '图片解析失败' });
  }
});

/** GET /api/images/tags —— 图片空间标签候选 */
router.get('/tags', async (req: Request, res: Response) => {
  try {
    const user = currentSyncUser(req) as SyncUser;
    const list = await readIndex(user.owner || user.username);
    const counter = new Map<string, number>();
    list.forEach(a => (a.tags || []).forEach(t => counter.set(t, (counter.get(t) || 0) + 1)));
    const data = [...counter.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
    res.json({ code: 0, data });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message || '标签读取失败' });
  }
});

/** GET /api/images/:id —— 图片详情（含引用位置 refs） */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const user = currentSyncUser(req) as SyncUser;
    const list = await readIndex(user.owner || user.username);
    const found = list.find(a => a.id === req.params.id);
    if (!found) { res.status(404).json({ code: 404, message: '图片不存在或已被删除' }); return; }
    res.json({ code: 0, data: { ...found, refs: Array.isArray(found.refs) ? found.refs : [] } });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message || '图片详情读取失败' });
  }
});

// ============ 新增 / 修改 / 删除 ============

/** POST /api/images —— 上传一张图片（dataUrl 为原图，thumbDataUrl 为缩略图，可选） */
router.post('/', async (req: Request, res: Response) => {
  try {
    const user = currentSyncUser(req) as SyncUser;
    const owner = user.owner || user.username;
    const { dataUrl, thumbDataUrl, name, width, height, tags } = req.body || {};

    const id = newId();
    const full = await saveBinary(owner, id, '', dataUrl);
    if (!full) { res.status(400).json({ code: 400, message: '图片格式不支持或超过 8MB' }); return; }
    const thumb = await saveBinary(owner, id, '_t', thumbDataUrl).catch(() => null);

    const now = Date.now();
    const asset: ImageAsset = {
      id,
      name: sanitizeName(name),
      url: full.url,
      thumbUrl: thumb ? thumb.url : full.url,
      mime: full.mime,
      size: full.size,
      width: Number(width) || 0,
      height: Number(height) || 0,
      tags: normalizeTags(tags),
      owner,
      uploader: user.username,
      createdAt: now,
      updatedAt: now,
      refs: [],
    };
    const ref = normalizeRef(req.body?.ref, user);
    if (ref) asset.refs = [ref];

    await withOwnerLock(owner, async () => {
      const list = await readIndex(owner);
      list.push(asset);
      await writeIndex(owner, list);
    });

    res.json({ code: 0, data: asset });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message || '图片上传失败' });
  }
});

/** PATCH /api/images/:id —— 改名 / 改标签 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const user = currentSyncUser(req) as SyncUser;
    const owner = user.owner || user.username;
    const patched = await withOwnerLock(owner, async () => {
      const list = await readIndex(owner);
      const idx = list.findIndex(a => a.id === req.params.id);
      if (idx < 0) return null;
      const cur = list[idx];
      if (req.body && req.body.name !== undefined) cur.name = sanitizeName(req.body.name, cur.name);
      if (req.body && req.body.tags !== undefined) cur.tags = normalizeTags(req.body.tags);
      cur.updatedAt = Date.now();
      list[idx] = cur;
      await writeIndex(owner, list);
      return cur;
    });
    if (!patched) { res.status(404).json({ code: 404, message: '图片不存在或已被删除' }); return; }
    res.json({ code: 0, data: patched });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message || '图片修改失败' });
  }
});

/** DELETE /api/images/:id —— 删除图片（有引用时 biz=force 才允许强删） */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const user = currentSyncUser(req) as SyncUser;
    const owner = user.owner || user.username;
    const force = String(req.query.force || '') === '1';

    const result = await withOwnerLock(owner, async () => {
      const list = await readIndex(owner);
      const idx = list.findIndex(a => a.id === req.params.id);
      if (idx < 0) return { removed: null as ImageAsset | null, blocked: false, refs: [] as ImageRef[] };
      const target = list[idx];
      const refs = Array.isArray(target.refs) ? target.refs : [];
      if (refs.length > 0 && !force) return { removed: null, blocked: true, refs };
      list.splice(idx, 1);
      await writeIndex(owner, list);
      return { removed: target, blocked: false, refs };
    });

    if (result.blocked) {
      res.status(409).json({ code: 409, message: `该图片仍被 ${result.refs.length} 处引用，无法删除`, data: { refs: result.refs } });
      return;
    }
    if (!result.removed) { res.status(404).json({ code: 404, message: '图片不存在或已被删除' }); return; }
    await removeBinary(result.removed.url, owner);
    await removeBinary(result.removed.thumbUrl, owner);
    res.json({ code: 0, data: { deleted: true } });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message || '图片删除失败' });
  }
});

// ============ 引用登记 ============

/** POST /api/images/:id/refs —— 新增/更新引用位置 */
router.post('/:id/refs', async (req: Request, res: Response) => {
  try {
    const user = currentSyncUser(req) as SyncUser;
    const owner = user.owner || user.username;
    const ref = normalizeRef(req.body?.ref, user);
    if (!ref) { res.status(400).json({ code: 400, message: '引用信息不完整' }); return; }

    const updated = await withOwnerLock(owner, async () => {
      const list = await readIndex(owner);
      const idx = list.findIndex(a => a.id === req.params.id);
      if (idx < 0) return null;
      list[idx].refs = addRef(Array.isArray(list[idx].refs) ? list[idx].refs : [], ref);
      list[idx].updatedAt = Date.now();
      await writeIndex(owner, list);
      return list[idx];
    });
    if (!updated) { res.status(404).json({ code: 404, message: '图片不存在或已被删除' }); return; }
    res.json({ code: 0, data: updated });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message || '引用登记失败' });
  }
});

/** DELETE /api/images/:id/refs —— 解除一处引用 */
router.delete('/:id/refs', async (req: Request, res: Response) => {
  try {
    const user = currentSyncUser(req) as SyncUser;
    const owner = user.owner || user.username;
    const ref = normalizeRef(req.body?.ref, user);
    if (!ref) { res.status(400).json({ code: 400, message: '引用信息不完整' }); return; }

    const updated = await withOwnerLock(owner, async () => {
      const list = await readIndex(owner);
      const idx = list.findIndex(a => a.id === req.params.id);
      if (idx < 0) return null;
      list[idx].refs = (Array.isArray(list[idx].refs) ? list[idx].refs : []).filter(r => r.key !== ref.key);
      list[idx].updatedAt = Date.now();
      await writeIndex(owner, list);
      return list[idx];
    });
    if (!updated) { res.status(404).json({ code: 404, message: '图片不存在或已被删除' }); return; }
    res.json({ code: 0, data: updated });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message || '引用解除失败' });
  }
});

export default router;
