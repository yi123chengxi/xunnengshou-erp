import React, { useState } from 'react';
import { Button, Upload, message, Image as AntdImage } from 'antd';
import { PlusOutlined, DeleteOutlined, SnippetsOutlined } from '@ant-design/icons';
import { compressImageFile } from '../utils/imageCompress';
import { readClipboardImage, clipboardImageFailureText } from '../utils/clipboard';

/**
 * 通用单图上传槽：点击/粘贴上传，自动压缩，点击缩略图放大预览，角标删除；
 * 槽内自带"粘贴"按键（读取剪切板图片），PNG 透明通道由压缩管线保留
 * value 为 base64 dataURL 字符串
 */
const ImageSlot: React.FC<{ value?: string; onChange?: (v: string) => void; size?: number; tip?: string }> = ({ value, onChange, size = 72, tip }) => {
  const [prev, setPrev] = useState(false);

  const handleFile = async (file: File | Blob) => {
    try {
      const url = await compressImageFile(file);
      onChange?.(url);
    } catch { message.error('图片读取失败'); }
  };

  // 槽内粘贴按键：优先 Clipboard API；http 部署下浏览器禁止读取，提示改用 Ctrl+V（容器已带 onPaste）
  const pasteFromClipboard = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    const res = await readClipboardImage();
    if (!res.ok) { message.warning(clipboardImageFailureText(res.reason)); return; }
    await handleFile(res.blob);
    message.success('已粘贴剪切板图片');
  };

  // 剪切板粘贴：容器可聚焦（tabIndex），Ctrl+V 读取剪贴板图片
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const t = items[i].type || '';
      if (t.startsWith('image/')) {
        const f = items[i].getAsFile();
        if (f) { e.preventDefault(); handleFile(f); }
        return;
      }
    }
  };

  return (
    <div tabIndex={0} onPaste={handlePaste} title={'点击上传；也可点槽内“粘贴”按键或点选后 Ctrl+V 粘贴剪切板图片'}
      style={{ display: 'inline-block', outline: 'none', borderRadius: 6 }}>
      {value ? (
        <div style={{ position: 'relative', width: size, height: size }}>
          <AntdImage src={value} width={size} height={size} style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }}
            preview={{ visible: prev, onVisibleChange: setPrev }} />
          <Button size="small" type="text" danger icon={<DeleteOutlined />}
            style={{ position: 'absolute', top: -8, right: -8, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }}
            onClick={(e) => { e.stopPropagation(); onChange?.(''); }} />
          <Button size="small" type="text" icon={<SnippetsOutlined />} title="粘贴剪切板图片替换"
            style={{ position: 'absolute', bottom: -8, right: -8, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }}
            onClick={pasteFromClipboard} />
        </div>
      ) : (
        <Upload accept="image/*" showUploadList={false} beforeUpload={(f) => { handleFile(f); return false; }}>
          <div style={{ width: size, height: size, border: '1px dashed #d9d9d9', borderRadius: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999', fontSize: 12 }}>
            <PlusOutlined />
            <span style={{ marginTop: 2 }}>{tip || '上传'}</span>
            <Button size="small" type="link" style={{ fontSize: 11, padding: 0, height: 'auto', marginTop: 2 }}
              onClick={pasteFromClipboard}>粘贴</Button>
          </div>
        </Upload>
      )}
    </div>
  );
};

export default ImageSlot;
