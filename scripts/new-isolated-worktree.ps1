param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('bugs', 'stripe-financeiro', 'testes', 'cloudflare-deploy', 'desempenho', 'ux-mobile', 'marketing-anuncios')]
  [string]$Area,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9][a-z0-9-]{2,40}$')]
  [string]$Nome
)

$ErrorActionPreference = 'Stop'
$base = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$marker = Get-Content -LiteralPath (Join-Path $base 'OFFICIAL_BASE.json') -Raw | ConvertFrom-Json
$expectedRemote = 'https://github.com/ori0n1/charm-book-now-main.git'
$remoteRef = 'refs/heads/official/bellza-production-34be84fa'

if ((git -C $base branch --show-current).Trim() -ne 'production-34be84fa') { throw 'Execute somente na base oficial local.' }
if (@(git -C $base status --porcelain=v1).Count -ne 0) { throw 'A base oficial local não está limpa.' }
if ((git -C $base remote get-url origin).Trim() -ne $expectedRemote) { throw 'O remoto GitHub da base oficial não corresponde ao esperado.' }

$localCommit = (git -C $base rev-parse HEAD).Trim()
$remoteLine = @(git -C $base ls-remote origin $remoteRef)
if ($LASTEXITCODE -ne 0 -or $remoteLine.Count -ne 1) { throw 'A branch oficial remota está ausente ou indisponível.' }
$remoteCommit = ($remoteLine[0] -split '\s+')[0]
if ($remoteCommit -ne $localCommit) { throw 'A base oficial local difere do GitHub. Nenhum worktree foi criado.' }

$oauthPath = Join-Path $env:APPDATA 'xdg.config\.wrangler\config\default.toml'
$oauthText = Get-Content -LiteralPath $oauthPath -Raw
$token = [regex]::Match($oauthText, '(?m)^\s*oauth_token\s*=\s*"([^"]+)"').Groups[1].Value
if (-not $token) { throw 'Sessão Cloudflare OAuth indisponível. Faça login interativo e tente novamente.' }
$uri = "https://api.cloudflare.com/client/v4/accounts/$($marker.cloudflareAccountId)/workers/scripts/$($marker.worker)/deployments"
$response = Invoke-RestMethod -Method Get -Uri $uri -Headers @{ Authorization = "Bearer $token" }
if (-not $response.success) { throw 'A consulta Cloudflare falhou. Nenhum worktree foi criado.' }
$latest = @($response.result.deployments | Sort-Object created_on -Descending | Select-Object -First 1)[0]
$active = @($latest.versions | Where-Object { $_.percentage -eq 100 })
if ($active.Count -ne 1 -or $active[0].version_id -ne $marker.cloudflareVersionId) {
  throw 'A produção ativa difere da base oficial. Nenhum worktree foi criado.'
}

if ($marker.sql.status -notin @('verified', 'agenda-sql-applied-via-editor')) {
  throw 'O estado das migrações de produção ainda não foi confirmado. Nenhum worktree foi criado.'
}

$parent = Join-Path (Split-Path $base -Parent) 'bellza-agent-worktrees'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$branch = "agent/$Area/$Nome-$stamp"
$target = Join-Path $parent "$Area-$Nome-$stamp"
if (Test-Path -LiteralPath $target) { throw 'O destino já existe. Nenhum worktree foi criado.' }
New-Item -ItemType Directory -Path $parent -Force | Out-Null
git -C $base worktree add -b $branch $target $localCommit
if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o worktree isolado.' }
Write-Output "Worktree isolado: $target; branch: $branch; base: $localCommit"
