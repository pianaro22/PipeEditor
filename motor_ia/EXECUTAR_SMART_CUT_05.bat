@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (echo ERRO: copie estes arquivos para a pasta motor_ia que ja possui .venv & pause & exit /b 1)
echo Arraste Audio.mp3 original e pressione ENTER:
set /p "AUDIO=Arquivo: "
echo Arraste resultado.json da versao 0.3 e pressione ENTER (ou deixe vazio):
set /p "JSON=Transcricao: "
if not defined AUDIO (echo Audio nao informado & pause & exit /b 1)
if defined JSON (
  ".venv\Scripts\python.exe" smart_cut_v05.py "%AUDIO:"=%" --transcricao "%JSON:"=%" --perfil normal --saida resultado_v05 --preview
) else (
  ".venv\Scripts\python.exe" smart_cut_v05.py "%AUDIO:"=%" --perfil normal --saida resultado_v05 --preview
)
pause
