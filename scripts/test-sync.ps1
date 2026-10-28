# Script otomasi testing sinkronisasi P2P multi-device di 1 PC
$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$exePath = Join-Path $rootDir "src-tauri\target\release\tauri-app.exe"

if (-not (Test-Path $exePath)) {
    Write-Host "File executable release belum tersedia, melakukan build terlebih dahulu..." -ForegroundColor Cyan
    Push-Location $rootDir
    try {
        pnpm tauri build
    } finally {
        Pop-Location
    }
}

# Direktori data terisolasi untuk masing-masing peer
$peer1Dir = Join-Path $rootDir ".data-peer1"
$peer2Dir = Join-Path $rootDir ".data-peer2"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  P2P Money Manager - Multi-Peer Testing  " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "[1/2] Menjalankan Peer 1 (Data: $peer1Dir)..." -ForegroundColor Green

$psi1 = New-Object System.Diagnostics.ProcessStartInfo
$psi1.FileName = $exePath
$psi1.Environment["DMM_DATA_DIR"] = $peer1Dir
$psi1.UseShellExecute = $false
[System.Diagnostics.Process]::Start($psi1) | Out-Null

Start-Sleep -Seconds 1

Write-Host "[2/2] Menjalankan Peer 2 (Data: $peer2Dir)..." -ForegroundColor Yellow

$psi2 = New-Object System.Diagnostics.ProcessStartInfo
$psi2.FileName = $exePath
$psi2.Environment["DMM_DATA_DIR"] = $peer2Dir
$psi2.UseShellExecute = $false
[System.Diagnostics.Process]::Start($psi2) | Out-Null

Write-Host ""
Write-Host "Kedua instance telah berjalan berdampingan!" -ForegroundColor Green
Write-Host "Langkah pengujian:" -ForegroundColor White
Write-Host "  1. Pada jendela Peer 1: Buka Buku Kas -> Masuk Settings -> Buat Undangan QR -> Salin Kode" -ForegroundColor Gray
Write-Host "  2. Pada jendela Peer 2: Klik 'Gabung via Undangan' -> Paste kode -> Gabung Buku" -ForegroundColor Gray
Write-Host "  3. Input transaksi di salah satu jendela dan amati sinkronisasi otomatis!" -ForegroundColor Gray

