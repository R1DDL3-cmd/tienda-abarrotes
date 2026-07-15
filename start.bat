@echo off
title Sistema Tienda de Abarrotes - Servidor
cd /d "%~dp0"
echo ========================================
echo  Sistema Tienda de Abarrotes
echo  Modo Portable
echo ========================================
echo.
if not exist "frontend\dist\index.html" (
  echo ERROR: No se encontro el frontend compilado.
  echo Ejecuta: npm run build:frontend
  pause
  exit /b 1
)
echo Iniciando servidor...
echo.
echo Abre tu navegador en: http://localhost:3000
echo.
echo Para cerrar, presiona Ctrl+C en esta ventana.
echo.
node server/index.js
pause
