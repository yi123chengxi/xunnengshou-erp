import React from 'react';

interface LogoProps {
  /** Logo 尺寸，默认 40 */
  size?: number;
  /** 是否显示文字，默认 true */
  showText?: boolean;
  /** 文字颜色，默认白色 */
  textColor?: string;
  /** 文字大小，默认 18 */
  fontSize?: number;
  /** 是否使用图片Logo（public/logo.png），默认 true */
  useImage?: boolean;
}

/**
 * 讯能手品牌 Logo 组件
 * 优先使用 public/logo.png 图片，如未找到则显示文字Logo
 */
const Logo: React.FC<LogoProps> = ({
  size = 40,
  showText = true,
  textColor = '#fff',
  fontSize = 18,
  useImage = true,
}) => {
  const [imgError, setImgError] = React.useState(false);

  // 图标容器样式（红色底色）
  const iconStyle: React.CSSProperties = {
    width: size,
    height: size,
    overflow: 'hidden',
    flexShrink: 0,
    borderRadius: 10,
    background: '#c41230',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const textStyle: React.CSSProperties = {
    color: textColor,
    fontSize,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    letterSpacing: 1,
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {/* Logo 图标：优先使用图片 */}
      {useImage && !imgError ? (
        <img
          src={`${process.env.PUBLIC_URL}/LOGO.jpg`}
          alt="讯能手"
          style={{
            ...iconStyle,
            objectFit: 'contain',
          }}
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          style={{
            ...iconStyle,
            fontWeight: 700,
            fontSize: size * 0.42,
            color: '#fff',
            letterSpacing: 1,
          }}
        >
          讯能
        </div>
      )}
      {showText && <span style={textStyle}>讯能手</span>}
    </div>
  );
};

export default Logo;
