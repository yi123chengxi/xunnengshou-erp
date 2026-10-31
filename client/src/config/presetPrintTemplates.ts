/**
 * 系统预设打印模板（随代码部署）：
 * - 预设数据以 JSON 文件形式内置于代码包，部署到阿里云等新环境后首次打开自动写入 localStorage，每个租户/新浏览器都自带；
 * - 种子策略为"只补不覆写"：本地已存在同 id 实例或同名实例时一律跳过，尊重用户自己的模板；
 * - 同一类型支持多个预设（如吊牌的"90*50中国双星-彩色"与"90*50通用版"）；
 * - 与服务端同步（serverSync 白名单 print_template_）互为兜底：有服务端数据时优先服务端恢复。
 */
import tagPresetDefault from './preset_tag_default.json';
import tagPreset90x50 from './preset_tag_90x50.json';

export interface PresetPrintTemplate {
  id: string;
  name: string;
  data: any;
}

// 各模板类型的系统预设实例列表（id 为 'default' 时数据键为 print_template_<type>）
export const PRESET_PRINT_TEMPLATES: Record<string, PresetPrintTemplate[]> = {
  tag: [
    { id: 'default', name: (tagPresetDefault as any)?.templateName || '90*50中国双星-彩色', data: tagPresetDefault },
    { id: 'preset_90x50', name: (tagPreset90x50 as any)?.templateName || '90*50通用版', data: tagPreset90x50 },
  ],
};

/** 模板实例数据键（与编辑器 tplDataKey 同口径：default 不带后缀） */
function presetDataKey(type: string, id: string): string {
  return id === 'default' ? `print_template_${type}` : `print_template_${type}_${id}`;
}

/** 首次打开时把系统预设写入本地（只补不覆写），保证新部署/新浏览器/新注册租户自带预设模板 */
export function seedPresetPrintTemplates(type: string): void {
  const presets = PRESET_PRINT_TEMPLATES[type];
  if (!presets || !presets.length) return;
  try {
    const listKey = `print_template_list_${type}`;
    let list: any[] = [];
    try { list = JSON.parse(localStorage.getItem(listKey) || '[]'); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    let changed = false;
    presets.forEach(preset => {
      const dataKey = presetDataKey(type, preset.id);
      const hasId = list.some((t: any) => t && t.id === preset.id);
      // 名称去重：用户本地已有同名实例（如自建时间戳 id 的同名模板）时不再重复种入
      const hasName = list.some((t: any) => t && t.name === preset.name);
      if (!hasId && !hasName) {
        list = [...list, { id: preset.id, name: preset.name }];
        changed = true;
        if (!localStorage.getItem(dataKey)) localStorage.setItem(dataKey, JSON.stringify(preset.data));
      } else if (hasId && !localStorage.getItem(dataKey)) {
        // 条目在而数据丢失（清缓存/换浏览器）：补回内置数据
        localStorage.setItem(dataKey, JSON.stringify(preset.data));
      }
    });
    if (changed) localStorage.setItem(listKey, JSON.stringify(list));
  } catch { /* 忽略本地写入失败 */ }
}
