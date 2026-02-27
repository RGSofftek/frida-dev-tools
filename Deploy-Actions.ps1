<#
.SYNOPSIS
    Deploys Actions.txt to the destination defined in .env

.DESCRIPTION
    Reads the ACTIONS_DEST_PATH from .env and copies Actions.txt to that location.
    Creates the destination directory if it doesn't exist.

.EXAMPLE
    .\Deploy-Actions.ps1
#>

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $scriptDir ".env"
$sourceFile = Join-Path $scriptDir "Actions.txt"

if (-not (Test-Path $envFile)) {
    Write-Error "Missing .env file at: $envFile"
    exit 1
}

if (-not (Test-Path $sourceFile)) {
    Write-Error "Missing source file: $sourceFile"
    exit 1
}

$destPath = $null
$envLines = Get-Content $envFile
foreach ($line in $envLines) {
    $trimmed = $line.Trim()
    if ($trimmed -and -not $trimmed.StartsWith("#")) {
        if ($trimmed -match "^ACTIONS_DEST_PATH\s*=\s*(.+)$") {
            $destPath = $Matches[1].Trim()
        }
    }
}

if (-not $destPath) {
    Write-Error "ACTIONS_DEST_PATH not defined in .env"
    exit 1
}

if ((Test-Path $destPath) -and (Get-Item $destPath).PSIsContainer) {
    $destPath = Join-Path $destPath "Actions.txt"
} elseif (-not [System.IO.Path]::HasExtension($destPath)) {
    if (-not (Test-Path $destPath)) {
        New-Item -ItemType Directory -Path $destPath -Force | Out-Null
    }
    $destPath = Join-Path $destPath "Actions.txt"
}

$destDir = Split-Path -Parent $destPath
if ($destDir -and -not (Test-Path $destDir)) {
    Write-Host "Creating directory: $destDir"
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
}

Write-Host "Copying Actions.txt -> $destPath"
Copy-Item -Path $sourceFile -Destination $destPath -Force

Write-Host "Done." -ForegroundColor Green
