@echo off
setlocal

REM --- Configuracoes ---
set "PROJECT_PATH=%~dp0"
set "DESKTOP_PATH=%USERPROFILE%\Desktop"

REM --- Nao altere daqui para baixo ---
set "VBS_SCRIPT=%TEMP%\create_shortcut.vbs"

echo.
echo Criando atalhos para o Mr. Reviewer...
echo.

REM --- Atalho para "Review" ---
set "SHORTCUT_NAME=Mr. Reviewer - Review"
set "COMMAND_TO_RUN_ARGS=run review"

echo Set oWS = WScript.CreateObject("WScript.Shell") > "%VBS_SCRIPT%"
echo sLinkFile = "%DESKTOP_PATH%\%SHORTCUT_NAME%.lnk" >> "%VBS_SCRIPT%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%VBS_SCRIPT%"
echo oLink.TargetPath = "npm.cmd" >> "%VBS_SCRIPT%"
echo oLink.Arguments = "%COMMAND_TO_RUN_ARGS%" >> "%VBS_SCRIPT%"
echo oLink.WorkingDirectory = "%PROJECT_PATH%" >> "%VBS_SCRIPT%"
echo oLink.IconLocation = "cmd.exe, 0" >> "%VBS_SCRIPT%"
echo oLink.Save >> "%VBS_SCRIPT%"

cscript //nologo "%VBS_SCRIPT%"
echo Atalho "%SHORTCUT_NAME%" criado em sua Area de Trabalho.

REM --- Atalho para "Watch" ---
set "SHORTCUT_NAME=Mr. Reviewer - Watch"
set "COMMAND_TO_RUN_ARGS=run watch"

echo Set oWS = WScript.CreateObject("WScript.Shell") > "%VBS_SCRIPT%"
echo sLinkFile = "%DESKTOP_PATH%\%SHORTCUT_NAME%.lnk" >> "%VBS_SCRIPT%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%VBS_SCRIPT%"
echo oLink.TargetPath = "npm.cmd" >> "%VBS_SCRIPT%"
echo oLink.Arguments = "%COMMAND_TO_RUN_ARGS%" >> "%VBS_SCRIPT%"
echo oLink.WorkingDirectory = "%PROJECT_PATH%" >> "%VBS_SCRIPT%"
echo oLink.IconLocation = "cmd.exe, 0" >> "%VBS_SCRIPT%"
echo oLink.Save >> "%VBS_SCRIPT%"

cscript //nologo "%VBS_SCRIPT%"
echo Atalho "%SHORTCUT_NAME%" criado em sua Area de Trabalho.

REM --- Limpeza ---
if exist "%VBS_SCRIPT%" del "%VBS_SCRIPT%"

echo.
echo Processo concluido!
echo.
pause
endlocal
