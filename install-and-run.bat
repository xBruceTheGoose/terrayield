@echo off
cd /d D:\Projects\EcoArbitrage
echo Installing dependencies...
npm install
if errorlevel 1 (
    echo npm install failed
    pause
    exit /b 1
)
echo Checking env file...
if not exist .env.local (
    echo Creating .env.local from .env.example...
    copy .env.example .env.local
) else (
    echo .env.local already exists, keeping existing configuration.
)
echo Starting dev server...
npm run dev