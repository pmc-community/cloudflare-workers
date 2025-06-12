@echo off
setlocal EnableDelayedExpansion

set "charset=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
set "result="

for /L %%i in (1,1,5) do (
    set "part="
    for /L %%j in (1,1,8) do (
        set /A idx=!random! %% 62
        for %%c in (!idx!) do set "char=!charset:~%%c,1!"
        set "part=!part!!char!"
    )
    if defined result (
        set "result=!result!-!part!"
    ) else (
        set "result=!part!"
    )
)

echo %result%
