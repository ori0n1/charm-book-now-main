param(
  [Parameter(Mandatory=$true)][ValidateRange(1,[long]::MaxValue)][long]$OwnerUserId,
  [Parameter(Mandatory=$true)][ValidateRange(1,[long]::MaxValue)][long]$AtlasBotId,
  [Parameter(Mandatory=$true)][ValidateRange(1,[long]::MaxValue)][long]$SentinelaBotId
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$template = Join-Path $root 'docs\agents-telegram-config.example.json'
$monitorState = Join-Path (Split-Path $root -Parent) 'public-visual-phase15-20261113\.bellza-agent-state'
if (-not (Test-Path -LiteralPath (Join-Path $monitorState 'monitor-state.json'))) {
  throw 'MONITOR_STATE_UNAVAILABLE'
}
$directory = Join-Path $env:LOCALAPPDATA 'Bellza\TelegramGateway'
$path = Join-Path $directory 'config.json'
if (Test-Path -LiteralPath $path) { throw 'CONFIG_ALREADY_EXISTS' }
$config = Get-Content -LiteralPath $template -Raw | ConvertFrom-Json
$config.ownerUserId = $OwnerUserId
$config.ownerChatId = $OwnerUserId
$config.stateDir = Join-Path $directory 'state'
$config.monitorStateDir = $monitorState
$config.bots.atlas | Add-Member -NotePropertyName expectedBotId -NotePropertyValue $AtlasBotId -Force
$config.bots.sentinela | Add-Member -NotePropertyName expectedBotId -NotePropertyValue $SentinelaBotId -Force
foreach ($key in @('sherlock','valida','forge','guardiao')) {
  $config.bots.$key.enabled = $false
}
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$json = $config | ConvertTo-Json -Depth 10
$file = [System.IO.FileStream]::new($path, [System.IO.FileMode]::CreateNew,
  [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try {
  $writer = [System.IO.StreamWriter]::new($file)
  try { $writer.WriteLine($json) } finally { $writer.Dispose() }
} finally { $file.Dispose() }
$acl = Get-Acl -LiteralPath $path
$acl.SetAccessRuleProtection($true, $false)
foreach ($existing in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($existing) }
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
  $user, 'FullControl', 'Allow'))
Set-Acl -LiteralPath $path -AclObject $acl
[Console]::Out.WriteLine('CONFIG_READY Atlas e Sentinela; outros bots desativados.')
