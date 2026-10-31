本目录存放供网页首页下载的“讯能手打印客户端”安装包。

文件名约定：xunnengshou-print-client-setup.exe
来源：在仓库根目录 print-client/ 执行 npm run dist（electron-builder，NSIS 格式），
      产物位于 print-client/release/，将其中 setup exe 复制为本目录下的上述文件名即可。
首页“讯能手打印客户端 - 下载安装包”按钮会先 HEAD 探测该文件：
      存在则触发下载；不存在则提示部署步骤。
