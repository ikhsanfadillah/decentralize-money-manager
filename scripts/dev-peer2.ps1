# Jalankan instance Peer 2 menggunakan executable yang sudah dikompilasi oleh Instance 1
$rootDir = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $rootDir "src-tauri\target\debug\tauri-app.exe"
if (-not (Test-Path $exe)) {
    $exe = Join-Path $rootDir "src-tauri\target\release\tauri-app.exe"
}

if (-not (Test-Path $exe)) {
    Write-Host "Executable belum ditemukan. Pastikan Peer 1 ('pnpm tauri dev') sudah berjalan terlebih dahulu." -ForegroundColor Yellow
    exit 1
}

$env:ENV_FILE = ".env.peer2"
$env:DMM_P2P_PORT = "11205"
Write-Host "Menjalankan Peer 2 dengan konfigurasi .env.peer2 (menghubungkan ke Vite localhost:1420)..." -ForegroundColor Green
& $exe

