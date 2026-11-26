@echo off
setlocal
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined TREE_NODE set "TREE_NODE=%%N"
if not defined TREE_NODE if exist "%ProgramFiles%\nodejs\node.exe" set "TREE_NODE=%ProgramFiles%\nodejs\node.exe"
if not defined TREE_NODE (
  for /d %%D in ("%ProgramFiles%\WindowsApps\OpenAI.CodexPrimaryRuntime.*") do (
    if not defined TREE_NODE if exist "%%D\dependencies\node\bin\node.exe" set "TREE_NODE=%%D\dependencies\node\bin\node.exe"
  )
)
if not defined TREE_NODE (
  echo Install Node.js from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
"%TREE_NODE%" "%~dp0serve.mjs" --open
if errorlevel 1 pause
