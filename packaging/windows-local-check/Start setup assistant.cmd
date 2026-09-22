@echo off
cd /d "%~dp0"
call bin\rlsok.cmd setup-assistant
if errorlevel 1 pause
