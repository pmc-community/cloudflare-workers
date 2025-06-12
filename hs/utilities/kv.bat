@echo off
setlocal enabledelayedexpansion
cls

:: Path to your .env file
set "ENV_FILE=..\.env"

if not exist "%ENV_FILE%" (
    echo .env file not found.
    exit /b 1
)

:: Load .env file
for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    set "key=%%A"
    set "val=%%B"
    call set "!key!=!val!"
)

:: Show loaded env values
echo ===================================================================
echo KV_NAME=!KV_NAME!
echo Wait until the KV and KV preview spaces are created ...

:: Use one of the loaded values
call npx wrangler kv namespace create "!KV_NAME!" > nul
call npx wrangler kv namespace create "!KV_NAME!" --preview > nul

:: Initialize the json variable
set "json="

:: Run the wrangler kv namespace list command and capture the output in a variable
for /f "delims=" %%a in ('npx wrangler kv namespace list') do (
    set "json=!json!%%a"
)

::: Write the JSON content to a temporary file using echo through cmd /c to avoid parsing issues
echo %json%>temp_raw.json

:: Write each line from the raw file to temp.json (simulate "json" var contents)
for /f "usebackq delims=" %%a in ("temp_raw.json") do (
    echo %%a>>temp.json
)

:: Use jq to parse
jq -r ".[] | \"KV: \(.title); ID: \(.id)\"" temp.json > parsed.txt

:: Echo each parsed line
for /f "usebackq delims=" %%a in ("parsed.txt") do (
    echo %%a
)
echo ===================================================================

:: Cleanup
del temp.json
del parsed.txt
del temp_raw.json
endlocal
