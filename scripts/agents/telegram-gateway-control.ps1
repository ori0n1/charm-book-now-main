param([Parameter(Mandatory=$true)][ValidateSet('start','stop','status')][string]$Mode)
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'telegram-gateway.mjs'
if ($Mode -eq 'start') {
  $current = & node $script status
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  if ($current -match '^EM_EXECUCAO') { [Console]::Out.WriteLine($current); exit 0 }
  $node = (Get-Command node -ErrorAction Stop).Source
  $quotedScript = '"' + $script + '"'
  $localDir = Join-Path $env:LOCALAPPDATA 'Bellza\TelegramGateway'
  New-Item -ItemType Directory -Path $localDir -Force | Out-Null
  Start-Process -FilePath $node -ArgumentList @($quotedScript, 'serve') -WorkingDirectory (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path -WindowStyle Hidden -RedirectStandardOutput (Join-Path $localDir 'gateway.out.log') -RedirectStandardError (Join-Path $localDir 'gateway.err.log')
  [Console]::Out.WriteLine('INICIO_SOLICITADO')
  exit 0
}
& node $script $Mode
exit $LASTEXITCODE
