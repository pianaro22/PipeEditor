@echo off
cd /d "%~dp0"
py -3.11 -m venv .venv
if errorlevel 1 (echo ERRO: Python 3.11 nao encontrado. & pause & exit /b 1)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
echo.
echo Instalacao concluida. Pressione uma tecla.
pause
