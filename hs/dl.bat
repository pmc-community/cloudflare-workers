@echo off
setlocal enabledelayedexpansion
cls

echo ========================================
echo Creating wrangler.toml config file ...
node generate-wrangler-config.js
echo ========================================
echo. 

echo Building with Vite...
call npx vite build
echo. 

echo Testing local ...

:: may be useful when testing in dev from another device in the same network
:: otherwise --ip 0.0.0.0 can be removed
call wrangler dev --test-scheduled --remote --ip 0.0.0.0 


