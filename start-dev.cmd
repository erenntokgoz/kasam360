@echo off
cd /d "%~dp0"
node scripts\devServers.mjs %*
if errorlevel 1 pause