@echo off
rem SlokAbhyasa — stop the local server and start it again (development copy).
rem
rem   restart-server.cmd         stop any running server, then start one in its own window
rem   restart-server.cmd open    the same, and open the app in the browser
rem   restart-server.cmd stop    stop only
rem
rem Only a node.exe running serve.js is stopped, never other Node programs. The server
rem window stays open with the server's log; close it or run this file again to stop it.
rem The port is 8787 unless PORT is set.
setlocal
cd /d "%~dp0"
if "%PORT%"=="" set "PORT=8787"

echo Stopping the SlokAbhyasa server, if one is running...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ps = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*serve.js*' }; if (-not $ps) { Write-Host '  none running' } else { $ps | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host ('  stopped PID ' + $_.ProcessId) } }; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*node serve.js*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
if /i "%~1"=="stop" goto :done

rem a moment for the port to be released
ping -n 2 127.0.0.1 >nul

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on the PATH. Install it from https://nodejs.org and try again.
  goto :done
)

echo Starting the SlokAbhyasa server on http://127.0.0.1:%PORT%/ ...
start "SlokAbhyasa server (port %PORT%)" cmd /k "cd /d "%~dp0" && set PORT=%PORT% && node serve.js"
rem wait until it answers (up to 20 s), then say so — and open the app when asked
powershell -NoProfile -ExecutionPolicy Bypass -Command "for ($i = 0; $i -lt 40; $i++) { try { Invoke-WebRequest -UseBasicParsing ('http://127.0.0.1:' + $env:PORT + '/') -TimeoutSec 1 | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"
if errorlevel 1 (
  echo   The server has not answered yet; see its window for what it says.
  goto :done
)
echo   Up: http://127.0.0.1:%PORT%/
if /i "%~1"=="open" start "" "http://127.0.0.1:%PORT%/"

:done
endlocal
