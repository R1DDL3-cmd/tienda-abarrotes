@echo off
title Importar Productos desde Excel
echo ========================================
echo  Importar Productos
echo ========================================
echo.
echo Este script importa los productos del archivo
echo productos.xlsx a la base de datos.
echo.
if "%1"=="" (
  set EXCEL=resources\productos.xlsx
) else (
  set EXCEL=%1
)
echo Archivo: %EXCEL%
echo.
node scripts\import_excel.js "%EXCEL%"
echo.
if %ERRORLEVEL%==0 (
  echo Importacion completada exitosamente.
) else (
  echo Error durante la importacion.
)
echo.
pause
