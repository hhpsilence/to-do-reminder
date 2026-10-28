@echo off
chcp 65001 >nul
setlocal
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo [错误] 没有找到 Electron，请先在本目录执行：npm install
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" "%~dp0"
exit /b 0
