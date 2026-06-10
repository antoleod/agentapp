@echo off
title Agent Evaluation App

cd /d "%~dp0\.."

echo Opening Agent Evaluation App...
echo Folder: %cd%
echo.

start "" "%cd%\index.html"

echo.
echo App opened in browser.
pause