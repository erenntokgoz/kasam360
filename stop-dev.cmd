@echo off
rem KASAM360 gelistirme servislerini durdurur: once baslaticiya durma komutu gider,
rem sonra web/API/Labs/desktop portlarinda kalan node, cargo, mongod ve uygulama surecleri kapatilir.
rem Baska programlara ait sureclere dokunulmaz; yalniz bu adlardaki surecler hedeflenir (cmd UTF-8 okumadigi icin ASCII).
cd /d "%~dp0"
node scripts\devServers.mjs --stop
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports = @(3000..3010) + @(4000..4010) + @(3600..3610) + @(1420..1430) + @(27017..27027);" ^
  "$names = 'node','cargo','mongod','kasam360-core','labs360';" ^
  "$pids = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort } | Select-Object -ExpandProperty OwningProcess -Unique;" ^
  "foreach ($p in $pids) { $proc = Get-Process -Id $p -ErrorAction SilentlyContinue; if ($proc -and ($names -contains $proc.ProcessName)) { Write-Host ('Durduruldu: ' + $proc.ProcessName + ' (PID ' + $p + ')'); Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } };" ^
  "Get-Process kasam360-core -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('Durduruldu: kasam360-core (PID ' + $_.Id + ')'); Stop-Process -Id $_.Id -Force };"
echo.
echo KASAM360 servisleri durduruldu.
timeout /t 4 >nul
