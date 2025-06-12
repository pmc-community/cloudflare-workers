@echo off
setlocal
cls

echo ========================================
echo Creating wrangler.jsonc config file ...
node generate-wrangler-config.js
echo ========================================
echo. 

echo ===================================
echo Building with Vite...
echo ===================================
call npx vite build

if %ERRORLEVEL% NEQ 0 (
    echo Build failed. Aborting deployment.
    exit /b %ERRORLEVEL%
)

echo.
echo ===================================
echo Deploying to Cloudflare...
echo ===================================
call wrangler deploy --minify

if %ERRORLEVEL% NEQ 0 (
    echo Deployment failed.
    exit /b %ERRORLEVEL%
)

echo.
echo ========================================
echo Build and deploy completed successfully.
echo ========================================
endlocal
