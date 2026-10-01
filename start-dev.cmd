@echo off
chcp 65001 >nul
title God's Eye View dev server
setlocal
REM NODE_USE_ENV_PROXY is read by Node at PROCESS START, so the proxy env must
REM be present here — setting it at runtime inside vite.config/local-proxy.mjs
REM is too late for undici's global fetch (adsbdb/OpenSky/etc. would fail in CN).
set "NODE_USE_ENV_PROXY=1"
set "HTTP_PROXY=http://127.0.0.1:7890"
set "HTTPS_PROXY=http://127.0.0.1:7890"
set "NO_PROXY=localhost,127.0.0.1,::1,.opensky-network.org,opensky-network.org,auth.opensky-network.org"
set "PATH=C:\Users\13680\AppData\Local\hermes\tools\node-26.7.0-win32-x64;%PATH%"
cd /d D:\Hermes\gods-eye-view
REM --host 0.0.0.0: listen on localhost + LAN + Tailscale so the phone (100.x) can reach it
node "node_modules\vite\bin\vite.js" --host 0.0.0.0 --port 4173 >> dev_proxy.log 2>&1
endlocal
