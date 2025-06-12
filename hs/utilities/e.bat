@echo off
setlocal enabledelayedexpansion
cls

:: Ensure all required parameters are provided
if "%~4"=="" (
    echo Usage: %~nx0 ^<json_file^> ^<encryption_key_secret_name^> ^<iv_secret_name^> ^<kv_key^>
    exit /b 1
)

:: Assign parameters
set "INPUT_JSON_FILE=%~1"
set "KEY_SECRET_NAME=%~2"
set "IV_SECRET_NAME=%~3"
set "KV_KEY=%~4"

:: Check if the input file exists
if not exist "%INPUT_JSON_FILE%" (
    echo File '%INPUT_JSON_FILE%' does not exist.
    exit /b 1
)

:: Extract base name and directory
for %%F in ("%INPUT_JSON_FILE%") do (
    set "BASENAME=%%~nF"
    set "DIRNAME=%%~dpF"
)

:: Construct output file names
set "ENCRYPTED_FILE=%DIRNAME%%BASENAME%_enc.txt"
set "KEY_FILE=%DIRNAME%%BASENAME%.key"
set "IV_FILE=%DIRNAME%%BASENAME%.iv"

:: Delete existing output files if they exist
if exist "%ENCRYPTED_FILE%" del /f /q "%ENCRYPTED_FILE%"
if exist "%KEY_FILE%" del /f /q "%KEY_FILE%"
if exist "%IV_FILE%" del /f /q "%IV_FILE%"

:: echo Press any key to continue...
:: pause > nul

:: Generate a random 32-byte key (hex-encoded)
for /f "delims=" %%i in ('openssl rand -hex 32') do set ENCRYPTION_KEY=%%i

:: Generate a random 16-byte IV (hex-encoded)
for /f "delims=" %%i in ('openssl rand -hex 16') do set IV=%%i

:: Encrypt the file
openssl enc -aes-256-cbc -in "%INPUT_JSON_FILE%" -out "%ENCRYPTED_FILE%" -base64 -K %ENCRYPTION_KEY% -iv %IV%
if errorlevel 1 (
    echo Error: Encryption failed.
    exit /b 1
)

:: Save key and IV to files
echo %ENCRYPTION_KEY% > "%KEY_FILE%"
echo %IV% > "%IV_FILE%"

:: Output values
echo.
echo =======================================
echo Encryption Key (hex): %ENCRYPTION_KEY%
echo Initialization Vector (IV - hex): %IV%
echo =======================================
echo.

:: Flatten the base64 file to a single line
::set "ENCRYPTED_CONTENT="
:: (for /f "usebackq delims=" %%A in ("%ENCRYPTED_FILE%") do (
::    set "line=%%A"
::    setlocal enabledelayedexpansion
::    <nul set /p="!line!" >> "%ENCRYPTED_FILE%.flat"
::    endlocal
:: )) > nul

:: Read the single-line flat file into variable
:: set /p ENCRYPTED_CONTENT=<"%ENCRYPTED_FILE%.flat"

:: Optional: delete the flattened file
:: del "%ENCRYPTED_FILE%.flat"

:: Push the encrypted file content to production KV namespace
echo Uploading to production KV...
call wrangler kv key put --remote --binding=HS_KV --preview=false "%KV_KEY%" --path "%ENCRYPTED_FILE%" > nul

:: USING THE OPTION ABOVE BECAUSE THE NEXT ONE MAY NOT WORK WELL FOR LARGER FILES
::call wrangler kv key put --remote --binding=HS_KV --preview=false "%KV_KEY%" !ENCRYPTED_CONTENT!

if errorlevel 1 (
    echo Error: Failed to upload to HS_KV.
    exit /b 1
)

echo Uploading to preview KV...
::call wrangler kv key put --remote --binding=HS_KV --preview "%KV_KEY%" !ENCRYPTED_CONTENT!
call wrangler kv key put --remote --binding=HS_KV --preview "%KV_KEY%" --path "%ENCRYPTED_FILE%" > nul

if errorlevel 1 (
    echo Error: Failed to upload to HS_KV.
    exit /b 1
)

:: Push secrets using Wrangler
echo Uploading encryption key secret...
echo %ENCRYPTION_KEY% | wrangler secret put %KEY_SECRET_NAME% > nul
if errorlevel 1 (
    echo Error: Failed to set encryption key secret.
    exit /b 1
)

echo Uploading IV secret...
echo %IV% | wrangler secret put %IV_SECRET_NAME% > nul
if errorlevel 1 (
    echo Error: Failed to set IV secret.
    exit /b 1
)


:: Delete existing output files if they exist
:: Cooment the next lines if debug is needed
if exist "%ENCRYPTED_FILE%" del /f /q "%ENCRYPTED_FILE%"
if exist "%KEY_FILE%" del /f /q "%KEY_FILE%"
if exist "%IV_FILE%" del /f /q "%IV_FILE%"

echo.
echo =====================================================
echo Encryption and upload completed successfully.
echo Encrypted file: %ENCRYPTED_FILE%
echo Uploaded to KV under key: %KV_KEY%
echo Encryption key stored as secret: %KEY_SECRET_NAME%
echo IV stored as secret: %IV_SECRET_NAME%
echo ====================================================

endlocal
