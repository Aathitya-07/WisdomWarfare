# PowerShell script to start both backend servers
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Starting Wisdom Warfare Servers..." -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

$backend_path = Get-Location

# Start Main Server (Port 4001)
Write-Host "▶️  Starting Main Server on Port 4001..." -ForegroundColor Green
Start-Process powershell -ArgumentList "cd '$backend_path'; npm start" -NoNewWindow

Start-Sleep -Seconds 2

# Start Crossword Server (Port 4002)
Write-Host "▶️  Starting Crossword Server on Port 4002..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "cd '$backend_path'; npm run start:crossword" -NoNewWindow

Write-Host ""
Write-Host "✅ Both servers are starting..." -ForegroundColor Green
Write-Host ""
Write-Host "📍 Main Server:     http://localhost:4001" -ForegroundColor Cyan
Write-Host "📍 Crossword Server: http://localhost:4002" -ForegroundColor Cyan
Write-Host "📍 Frontend:         http://localhost:3000 (if running)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Wait 3-5 seconds for servers to fully start..." -ForegroundColor Yellow
Write-Host ""
