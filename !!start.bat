@echo off
REM Activar entorno virtual
call .venv\Scripts\activate.bat

REM Arrancar servidor
uvicorn app:asgi --host 0.0.0.0 --port 8000 --reload

REM Mantener la ventana abierta
pause