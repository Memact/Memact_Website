$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $root 'dist'
$releaseRoot = Join-Path $distRoot 'memact-release'
if (Test-Path $releaseRoot) { Remove-Item -Recurse -Force $releaseRoot }
New-Item -ItemType Directory -Force $releaseRoot | Out-Null

Write-Host 'Packaging app (PyInstaller, encrypted bytecode)...'
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
  $pythonCmd = Get-Command py -ErrorAction SilentlyContinue
}
if (-not $pythonCmd) {
  throw 'Python executable not found. Install Python 3.11+ or add it to PATH.'
}
& $pythonCmd.Source -m PyInstaller --noconfirm --clean --onefile --name memact `
  --exclude-module PyQt5 --exclude-module PySide2 --exclude-module PySide6 `
  --add-data "assets;assets" --add-data "extension;extension" main.py

Write-Host 'Assembling release bundle (no .py sources)...'
Copy-Item (Join-Path $distRoot 'memact.exe') $releaseRoot
Copy-Item (Join-Path $root 'LICENSE') $releaseRoot
Copy-Item (Join-Path $root 'README.md') $releaseRoot

Get-ChildItem -Path $releaseRoot
Write-Host 'Done.'
