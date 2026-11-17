import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import devConfig from './dev'
import prodConfig from './prod'

// designWidth 750：样式里写的 px 数值即 rpx 数值（与 UI 稿 750 宽对齐）
export default defineConfig(async (merge) => {
  const base: UserConfigExport = {
    projectName: 'xns-erp-mini',
    date: '2026-11-17',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 3.75,
      750: 1,
      375: 2,
      828: 1.81 / 3.75,
    },
    sourceRoot: 'src',
    outputRoot: `dist/${process.env.TARO_ENV}`,
    plugins: [],
    defineConstants: {},
    copy: { patterns: [], options: {} },
    framework: 'react',
    // webpack5 + 关闭依赖预编译：Taro 4.0.9 的 prebundle 与新版 webpack-virtual-modules 不兼容（H5 dev 启动即崩溃）
    compiler: { type: 'webpack5', prebundle: { enable: false } },
    cache: { enable: false },
    mini: {
      postcss: {
        pxtransform: { enable: true, config: {} },
        cssModules: { enable: false },
      },
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      postcss: {
        autoprefixer: { enable: true, config: {} },
        cssModules: { enable: false },
      },
      // H5 预览：/api 代理到生产后端，规避浏览器跨域
      devServer: {
        port: 10086,
        proxy: {
          '/api': {
            target: 'http://120.27.143.175',
            changeOrigin: true,
          },
        },
      },
    },
  }
  return merge({}, base, (process.env.NODE_ENV === 'development' ? devConfig : prodConfig) as any)
})
