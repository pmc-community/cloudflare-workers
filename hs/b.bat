@echo off
cls
echo Creating wrangler.jsonc config file ...
node generate-wrangler-config.js

echo Building with Vite...
npx vite build
