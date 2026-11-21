@echo off
chcp 65001 > nul
title Second Brain OS - Local Bridge
powershell -STA -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-bridge.ps1" -OpenBrowser
if errorlevel 1 pause
