@echo off
setlocal enabledelayedexpansion

set "DB_PATH=%USERPROFILE%\AppData\Roaming\dev-time-tracker\usage.db"
set "SQL_PATH=%~dp0populate-database.sql"

echo Database path: !DB_PATH!
echo SQL script path: !SQL_PATH!

REM Check if sqlite3 is available
sqlite3 -version >nul 2>&1
if errorlevel 1 (
    echo ERROR: sqlite3 command not found. Please install SQLite3 command line tools.
    echo Download from: https://www.sqlite.org/download.html
    echo Or install via chocolatey: choco install sqlite
    exit /b 1
)

REM Delete existing database if it exists
if exist "!DB_PATH!" (
    echo Deleting existing database...
    del "!DB_PATH!"
)

REM Ensure directory exists
for %%F in ("!DB_PATH!") do set "DB_DIR=%%~dpF"
if not exist "!DB_DIR!" (
    echo Creating database directory...
    mkdir "!DB_DIR!"
)

REM Execute SQL script
echo Creating and populating database...
sqlite3 "!DB_PATH!" ".read '!SQL_PATH!'"

if errorlevel 1 (
    echo ERROR: Failed to execute SQL script
    exit /b 1
) else (
    echo SUCCESS: Database populated successfully!
    echo Database location: !DB_PATH!
)
