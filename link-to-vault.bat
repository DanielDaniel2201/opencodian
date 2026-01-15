@echo off
REM Link dist folder to Obsidian vault as opencodian plugin

set PROJECT_DIR=%~dp0
set VAULT_PLUGINS=D:\PersonalObsidianVault\PersonalObsidianVault\.obsidian\plugins
set DIST_PATH=%PROJECT_DIR%dist

echo Building project first...
cd /d "%PROJECT_DIR%"
call npm run build

echo.
echo Linking dist folder to vault...

REM Delete existing folder/link if exists
if exist "%VAULT_PLUGINS%\opencodian" (
    rmdir "%VAULT_PLUGINS%\opencodian" 2>nul
    if exist "%VAULT_PLUGINS%\opencodian" rmdir /s /q "%VAULT_PLUGINS%\opencodian"
)

REM Create directory-level symlink to dist/
mklink /D "%VAULT_PLUGINS%\opencodian" "%DIST_PATH%"

echo.
echo Done! Folder symlink created:
echo   %VAULT_PLUGINS%\opencodian -^> %DIST_PATH%
echo.
echo dist/ contains only: main.js, manifest.json, styles.css
echo.
echo Now:
echo 1. Restart Obsidian (or reload plugins)
echo 2. Go to Settings ^> Community plugins
echo 3. Enable "Opencodian"
echo 4. Install "Hot Reload" plugin for auto-reload on build
echo.
pause
