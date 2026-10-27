@echo off
setlocal
cd /d "%~dp0"
set "PYTHON=%~dp0.venv\Scripts\python.exe"
if not exist "%PYTHON%" (
  echo Nao encontrei o Python do motor nesta pasta.
  echo Copie este BAT e analisar_pausas_v04.py para a pasta motor_ia que ja tem .venv
  pause
  exit /b 1
)
echo Arraste o Audio.mp3 ou Camera1.MOV para esta janela e pressione Enter:
set /p "ARQUIVO=Arquivo: "
if not defined ARQUIVO (pause & exit /b 1)
set "ARQUIVO=%ARQUIVO:"=%"
"%PYTHON%" analisar_pausas_v04.py "%ARQUIVO%" --pausa-min 0.20 --saida "%~dp0resultado_v04"
pause
