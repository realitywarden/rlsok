@echo off
"%~dp0node.exe" "%~dp0rlsok-launch.cjs" %*
exit /b %ERRORLEVEL%
