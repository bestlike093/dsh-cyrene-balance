@echo off
rem Castorice Live2D driver - double click to start.
rem Usage: start.cmd [model-dir]
rem Without a model dir, the driver falls back to its built-in default model.
setlocal
set "ROOT=%~dp0"
set "ELECTRON=%ROOT%runtime\electron\electron.exe"
if not exist "%ELECTRON%" (
  echo Electron runtime not found: %ELECTRON%
  pause
  exit /b 1
)
set "ELECTRON_RUN_AS_NODE="
if "%~1"=="" (
  "%ELECTRON%" "%ROOT%app" --catalog "%ROOT%data\catalog.json" --gui
) else (
  "%ELECTRON%" "%ROOT%app" --model "%~1" --catalog "%ROOT%data\catalog.json" --gui
)
