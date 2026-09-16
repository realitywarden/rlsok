@echo off
setlocal
"%~dp0bin\node.exe" "%~dp0bin\run-example.cjs" %*
set "RLSOK_RESULT=%ERRORLEVEL%"
if not "%RLSOK_RESULT%"=="0" if not "%~1"=="--no-open" pause
exit /b %RLSOK_RESULT%
