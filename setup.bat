@echo off
:: ==================================================================
::  ONE-CLICK SETUP  -  Windows VPS
::
::  Double-click this file. It will:
::   1. Install Node.js LTS silently if Node.js v20+ is missing
::   2. Run npm install
::   3. Ask for the bot token and save it to .env
::   4. Install PM2, start the bot, enable start-on-boot
::
::  No Docker is used anywhere.
:: ==================================================================
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Discord Bot - One-Click Setup
cd /d "%~dp0"

set "APP_NAME=DiscordBot"
set "NODE_VERSION=v22.22.3"
set "MIN_NODE_MAJOR=20"

echo.
echo  ==============================================
echo    Discord Bot - One-Click Setup (Windows)
echo  ==============================================
echo.

:: ------------------------------------------------------------------
:: 1. Node.js
:: ------------------------------------------------------------------
echo [1/4] Checking Node.js (v%MIN_NODE_MAJOR%+ required)...
call :detect_node
if "%NODE_OK%"=="1" goto node_ready

echo       Node.js v%MIN_NODE_MAJOR%+ was not found. Installing Node.js %NODE_VERSION% silently...

:: Installing Node.js needs administrator rights -> relaunch elevated if needed.
net session >nul 2>&1
if errorlevel 1 goto elevate

set "NODE_ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NODE_ARCH=arm64"
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" if not defined PROCESSOR_ARCHITEW6432 set "NODE_ARCH=x86"
set "NODE_MSI=%TEMP%\node-%NODE_VERSION%-%NODE_ARCH%.msi"
set "NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-%NODE_ARCH%.msi"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '%NODE_URL%' -OutFile '%NODE_MSI%'"
if errorlevel 1 goto fail_node_download
if not exist "%NODE_MSI%" goto fail_node_download

start /wait "" msiexec /i "%NODE_MSI%" /qn /norestart
del /q "%NODE_MSI%" >nul 2>&1

:: Make node/npm usable in THIS window without reopening it.
set "PATH=%ProgramFiles%\nodejs;%PATH%"
call :detect_node
if not "%NODE_OK%"=="1" goto fail_node_install

:node_ready
:: Global npm packages (pm2) live here:
set "PATH=%APPDATA%\npm;%PATH%"
for /f "delims=" %%v in ('node -v') do echo       Node.js %%v is ready.

:: ------------------------------------------------------------------
:: 2. Dependencies
:: ------------------------------------------------------------------
echo.
echo [2/4] Installing dependencies (npm install)...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 goto fail_npm

:: ------------------------------------------------------------------
:: 3. Bot token -> .env   (the token is never printed or logged)
:: ------------------------------------------------------------------
echo.
echo [3/4] Bot token
if not exist ".env" goto ask_token
findstr /b /c:"DISCORD_TOKEN=" ".env" >nul 2>&1
if errorlevel 1 goto ask_token
findstr /b /c:"DISCORD_TOKEN=your-bot-token-here" ".env" >nul 2>&1
if not errorlevel 1 goto ask_token
set "KEEP=Y"
set /p "KEEP=A token is already saved. Keep it? [Y/n]: "
if /i "%KEEP%"=="Y" goto token_done
if /i "%KEEP%"=="YES" goto token_done

:ask_token
set "TOKEN="
set /p "TOKEN=Paste your Discord Bot Token: "
if not defined TOKEN goto ask_token
:: remove spaces and quotes that may have been pasted by accident
set "TOKEN=%TOKEN: =%"
if not defined TOKEN goto ask_token
set "TOKEN=%TOKEN:"=%"
if not defined TOKEN goto ask_token
> ".env" echo DISCORD_TOKEN=%TOKEN%
set "TOKEN="
echo       Token saved to .env

:token_done

:: ------------------------------------------------------------------
:: 4. PM2  (24/7 uptime + auto-start on reboot)
:: ------------------------------------------------------------------
echo.
echo [4/4] Installing PM2 and starting the bot...
call npm install -g pm2 --no-audit --no-fund
if errorlevel 1 goto fail_pm2

call pm2 delete "%APP_NAME%" >nul 2>&1
call pm2 start index.js --name "%APP_NAME%" --time --exp-backoff-restart-delay 2000
if errorlevel 1 goto fail_start
call pm2 save

:: "pm2 startup" only supports Linux/macOS. On Windows the same job is done
:: by pm2-windows-startup, which resurrects the saved PM2 list at logon.
call npm install -g pm2-windows-startup --no-audit --no-fund >nul 2>&1
call pm2-startup install >nul 2>&1
if errorlevel 1 echo       [!] Could not register auto-start. After a reboot run:  pm2 resurrect
call pm2 save >nul 2>&1

echo.
echo ✅ Bot is now running 24/7. Token saved. Done.
echo.
echo    Logs:     pm2 logs %APP_NAME%
echo    Restart:  pm2 restart %APP_NAME%
echo    Stop:     pm2 stop %APP_NAME%
echo.
pause
exit /b 0

:: ==================================================================
::  Helpers
:: ==================================================================
:detect_node
set "NODE_OK=0"
set "NODE_MAJOR="
for /f "tokens=1 delims=." %%v in ('node -v 2^>nul') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR exit /b 0
set "NODE_MAJOR=%NODE_MAJOR:v=%"
if %NODE_MAJOR% GEQ %MIN_NODE_MAJOR% set "NODE_OK=1"
exit /b 0

:elevate
echo       Administrator rights are needed to install Node.js. Please click "Yes" in the next window...
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b 0

:fail_node_download
echo.
echo [X] Could not download Node.js. Check the internet connection, or install it manually from https://nodejs.org
goto fail
:fail_node_install
echo.
echo [X] Node.js installation failed. Please install Node.js LTS manually from https://nodejs.org and run setup.bat again.
goto fail
:fail_npm
echo.
echo [X] "npm install" failed. Scroll up to see the error.
goto fail
:fail_pm2
echo.
echo [X] Could not install PM2.
goto fail
:fail_start
echo.
echo [X] PM2 could not start the bot. Run "pm2 logs %APP_NAME%" to see why.
goto fail
:fail
echo.
pause
exit /b 1
