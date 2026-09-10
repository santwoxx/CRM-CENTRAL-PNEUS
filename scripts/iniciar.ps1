<#
  Sobe o CRM inteiro e imprime o link publico para compartilhar.

      powershell -ExecutionPolicy Bypass -File scripts\iniciar.ps1

  O painel e servido pelo PROPRIO backend, entao existe um endereco so.
  Quando o tunel reinicia o endereco muda - mas basta reenviar o link novo,
  sem rebuild e sem reconfigurar nada.
#>
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

function Porta-Ativa($porta) {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $ok = $c.ConnectAsync('127.0.0.1', $porta).Wait(2000)
        $c.Close()
        return $ok
    } catch { return $false }
}

Write-Host "`n[1/5] Conferindo servicos de base" -ForegroundColor Cyan
$faltando = @()
if (-not (Porta-Ativa 5432))  { $faltando += 'PostgreSQL (5432)' }
if (-not (Porta-Ativa 6379))  { $faltando += 'Redis/Memurai (6379)' }
if ($faltando.Count -gt 0) {
    Write-Host "  FALTANDO: $($faltando -join ', ')" -ForegroundColor Red
    Write-Host "  Sao servicos do Windows. Verifique com:" -ForegroundColor Yellow
    Write-Host "    Get-Service postgresql*, Memurai" -ForegroundColor Yellow
    exit 1
}
Write-Host "  Postgres e Redis ok" -ForegroundColor Green

if (Porta-Ativa 11434) {
    Write-Host "  Ollama ok (IA local)" -ForegroundColor Green
} else {
    Write-Host "  Ollama parado - a IA vai falhar e as conversas irao direto para a fila humana" -ForegroundColor Yellow
    $exe = "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"
    if (Test-Path $exe) { Start-Process $exe; Write-Host "  iniciando Ollama..." -ForegroundColor Yellow }
}

Write-Host "`n[2/5] Painel compilado" -ForegroundColor Cyan
if (-not (Test-Path "packages\web\dist\index.html")) {
    Write-Host "  compilando (primeira vez, ~30s)..."
    npm run build -w @crm/shared | Out-Null
    npm run build -w @crm/web | Out-Null
}
Write-Host "  ok" -ForegroundColor Green

Write-Host "`n[3/5] Encerrando execucoes anteriores" -ForegroundColor Cyan
Get-Process cloudflared -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -EA SilentlyContinue |
    Where-Object { $_.CommandLine -match 'tsx watch|dist[\/](server|worker)' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }

# Encerrar por linha de comando nem sempre pega o processo certo: o node que
# realmente segura a porta pode ser um filho. Sem isto o servidor novo morre
# com EADDRINUSE e quem continua respondendo e a versao ANTIGA - com o painel
# desatualizado, o que e dificil de perceber.
Get-NetTCPConnection -LocalPort 3333 -State Listen -EA SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -EA SilentlyContinue }
Start-Sleep -Seconds 4

if (Get-NetTCPConnection -LocalPort 3333 -State Listen -EA SilentlyContinue) {
    Write-Host "  a porta 3333 continua ocupada - feche o processo manualmente" -ForegroundColor Red
    exit 1
}
Write-Host "  ok" -ForegroundColor Green

Write-Host "`n[4/5] Subindo API e worker" -ForegroundColor Cyan
Start-Process powershell -ArgumentList '-NoProfile','-Command','npm run dev:api'    -WorkingDirectory $raiz -WindowStyle Minimized
Start-Process powershell -ArgumentList '-NoProfile','-Command','npm run dev:worker' -WorkingDirectory $raiz -WindowStyle Minimized

$pronto = $false
foreach ($i in 1..45) {
    Start-Sleep -Seconds 2
    try {
        if ((Invoke-WebRequest 'http://localhost:3333/health/live' -TimeoutSec 3 -UseBasicParsing).StatusCode -eq 200) {
            $pronto = $true; break
        }
    } catch { }
}
if (-not $pronto) { Write-Host "  API nao respondeu a tempo" -ForegroundColor Red; exit 1 }
Write-Host "  API no ar em http://localhost:3333" -ForegroundColor Green

Write-Host "`n[5/5] Abrindo o tunel publico" -ForegroundColor Cyan
$log = "$env:TEMP\cloudflared.log"
if (Test-Path $log) { Remove-Item $log -Force }
Start-Process -FilePath "C:\Program Files (x86)\cloudflared\cloudflared.exe" `
    -ArgumentList 'tunnel','--url','http://localhost:3333' `
    -RedirectStandardError $log -RedirectStandardOutput "$env:TEMP\cloudflared.out" -WindowStyle Hidden

$url = $null
foreach ($i in 1..45) {
    Start-Sleep -Seconds 2
    if (Test-Path $log) {
        $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches -EA SilentlyContinue
        if ($m) { $url = $m.Matches[0].Value; break }
    }
}

if (-not $url) {
    Write-Host "  tunel nao abriu - o sistema segue acessivel em http://localhost:3333" -ForegroundColor Yellow
    exit 0
}

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "  LINK PARA COMPARTILHAR" -ForegroundColor Green
Write-Host "  $url" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green
Write-Host "`n  Contas de teste:"
Write-Host "    admin@centralpneus.com.br  / AdminPassword123!   (administrador)"
Write-Host "    carlos@centralpneus.com.br / Atendente123!       (atendente)"
Write-Host "`n  Enquanto esta janela e o PC estiverem ligados, o link funciona."
Write-Host "  O endereco muda a cada reinicio: rode este script e reenvie o link.`n"
