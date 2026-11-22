@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not defined APP_PORT set "APP_PORT=8080"
if not defined APP_DATA set "APP_DATA=%~dp0data"
if not defined APP_CONFIG set "APP_CONFIG=%~dp0config\application.properties"
set "JAVA_BIN=java"
if defined JAVA_HOME set "JAVA_BIN=%JAVA_HOME%\bin\java.exe"
"%JAVA_BIN%" -Xms64m -Xmx512m -Dfile.encoding=UTF-8 -Duser.timezone=Asia/Shanghai "-Dapp.root=%CD%" "-Dapp.data=%APP_DATA%" "-Dapp.config=%APP_CONFIG%" "-Dapp.port=%APP_PORT%" -cp "%CD%\paper-desk.jar;%CD%\lib\*" Main
if errorlevel 1 pause
