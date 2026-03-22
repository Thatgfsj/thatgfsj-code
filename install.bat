@echo off
chcp 65001 >nul
title Thatgfsj Code 安装向导
echo.
echo   Thatgfsj Code 一键安装
echo   =====================
echo.

echo [*] 检查环境...
echo.

:: Check PowerShell
powershell -Version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 需要 PowerShell，请升级: https://aka.ms/powershell
    pause
    exit /b 1
)
echo [OK] PowerShell 已就绪

:: Check Node.js
for /f "delims=" %%i in ('powershell -Command "node --version 2^>nul"') do set NODE_VERSION=%%i
if defined NODE_VERSION (
    echo [OK] Node.js %NODE_VERSION% 已安装
) else (
    echo.
    echo [!] 未检测到 Node.js，开始自动安装...
    echo.
    
    :: Try winget
    where winget >nul 2>&1
    if %errorlevel% equ 0 (
        echo [*] 正在通过 winget 安装 Node.js...
        winget install OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements
        echo.
        echo [OK] Node.js 安装完成
        echo [!] 请重新打开一个 CMD 然后再次运行此脚本
        pause
        exit /b 0
    )
    
    :: Fallback: manual download
    echo [*] 正在下载 Node.js 安装包...
    powershell -Command "Start-Process 'https://nodejs.org/' -Verb Open"
    echo.
    echo [!] 请手动安装 Node.js LTS 版本
    echo [!] 安装完成后，重新运行此脚本
    pause
    exit /b 0
)

:: Download install.ps1
echo.
echo [*] 正在下载安装程序...
powershell -Command "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/Thatgfsj/thatgfsj-code/main/install.ps1' -OutFile '%TEMP%\thatgfsj_install.ps1'"

echo.
echo [*] 启动安装向导...
echo.
powershell -ExecutionPolicy Bypass -File "%TEMP%\thatgfsj_install.ps1"

echo.
pause
