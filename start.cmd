@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where java >nul 2>nul
if errorlevel 1 (
  echo 未找到 Java。请安装 JDK 17 或更高版本并配置 PATH。
  pause
  exit /b 1
)
echo 正在编译知序投稿管理系统...
javac -encoding UTF-8 --release 17 -d out src\*.java
if errorlevel 1 (
  echo 编译失败。请确认已安装完整 JDK 17 或更高版本。
  pause
  exit /b 1
)
echo.
echo 启动后请在浏览器打开 http://127.0.0.1:8080
echo 按 Ctrl+C 关闭服务。存储方式以启动信息为准。
echo.
java -cp "out;lib/*" Main
if errorlevel 1 pause
