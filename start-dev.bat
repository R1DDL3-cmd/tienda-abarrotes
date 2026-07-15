@echo off
title Sistema Tienda de Abarrotes - Desarrollo
echo ========================================
echo  Modo Desarrollo (Hot Reload)
echo ========================================
echo.
echo Iniciando servidor backend...
start "Servidor" cmd /c "node server/index.js"
echo.
echo Iniciando frontend (Vite)...
cd frontend
start "Frontend" cmd /c "npx vite --port 5173 --host"
cd ..
echo.
echo ========================================
echo  Backend:  http://localhost:3000
echo  Frontend: http://localhost:5173
echo ========================================
echo.
echo Cuando termines, cierra ambas ventanas.
pause
