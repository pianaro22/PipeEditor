@echo off
setlocal
cd /d "%~dp0"
echo === PIPE EDITOR AI 0.8 - PROTECAO DE PALAVRAS ===
echo Use Audio.mp3 ORIGINAL e resultado.json da versao 0.3.
set /p "AUDIO=Arraste Audio.mp3 aqui e pressione Enter: "
set /p "TRANS=Arraste resultado.json aqui e pressione Enter: "
set "AUDIO=%AUDIO:"=%"
set "TRANS=%TRANS:"=%"
if exist ".venv\Scripts\python.exe" (set "PY=.venv\Scripts\python.exe") else (set "PY=python")
"%PY%" smart_cut_v08.py "%AUDIO%" --transcricao "%TRANS%" --perfil normal --saida resultado_v08 --preview
pause
