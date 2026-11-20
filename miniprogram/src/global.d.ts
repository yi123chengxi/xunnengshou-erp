// 静态资源模块声明：webpack/Taro 构建期把图片转为可引用路径
declare module '*.png' {
  const src: string
  export default src
}
declare module '*.jpg' {
  const src: string
  export default src
}
declare module '*.svg' {
  const src: string
  export default src
}
