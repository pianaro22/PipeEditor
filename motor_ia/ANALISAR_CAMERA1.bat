@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (echo Execute INSTALAR_MOTOR.bat primeiro. & pause & exit /b 1)
echo Arraste o arquivo Camera1.MOV ou Camera1.mp4 para esta janela e pressione Enter:
set /p "VIDEO=Arquivo: "
if not defined VIDEO (echo Nenhum arquivo informado. & pause & exit /b 1)
".venv\Scripts\python.exe" analisar.py "%VIDEO:"=%" --modelo small --saida "%~dp0resultado"
pause
