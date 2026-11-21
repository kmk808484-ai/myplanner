@echo off
chcp 65001 > nul
title Second Brain OS - 로컬 실행 도우미
powershell -STA -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-bridge.ps1" -OpenBrowser
