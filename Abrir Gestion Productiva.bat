@echo off
rem ============================================================
rem  Abrir Gestion Productiva  (v5)
rem  Copia los scripts PS a una ruta local (evita bloqueo UNC)
rem  y delega TODA la logica al launcher PowerShell.
rem ============================================================

echo BAT v5 %DATE% %TIME% > "%TEMP%\gp-bat-debug.log"
echo Source: %~dp0 >> "%TEMP%\gp-bat-debug.log"

set "PSLAUNCHER=C:\Users\Public\gp-launcher.ps1"
set "PSSERVER=C:\Users\Public\gp-server.ps1"

copy /y "%~dp0gp-launcher.ps1" "%PSLAUNCHER%" >> "%TEMP%\gp-bat-debug.log" 2>&1
copy /y "%~dp0server-local.ps1" "%PSSERVER%" >> "%TEMP%\gp-bat-debug.log" 2>&1

if not exist "%PSLAUNCHER%" (
  echo No se pudo copiar gp-launcher.ps1 >> "%TEMP%\gp-bat-debug.log"
  msg "%USERNAME%" Error: no se pudo preparar el launcher. Ver %TEMP%\gp-bat-debug.log
  exit /b 1
)

rem GpRoot = carpeta del proyecto (UNC), el server sirve los archivos desde ahi.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PSLAUNCHER%" -GpRoot "%~dp0." -ServerScript "%PSSERVER%"

echo Launcher exit %errorlevel% >> "%TEMP%\gp-bat-debug.log"
