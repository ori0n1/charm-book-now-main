param(
  [Parameter(Mandatory=$true)][ValidateSet('set','read','status')][string]$Mode,
  [Parameter(Mandatory=$true)][ValidatePattern('^(telegram-(atlas|sentinela|sherlock|valida|forge|guardiao)|openai-api)$')][string]$Name
)
$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:LOCALAPPDATA 'Bellza\TelegramGateway\secrets'
$path = Join-Path $directory "$Name.dpapi"
if ($Mode -eq 'status') {
  if (Test-Path -LiteralPath $path) { [Console]::Out.Write('PRESENT') }
  else { [Console]::Out.Write('MISSING') }
  exit 0
}
if ($Mode -eq 'set') {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $secret = Read-Host "Valor para $Name" -AsSecureString
  $encrypted = ConvertFrom-SecureString $secret
  [System.IO.File]::WriteAllText($path, $encrypted)
  $acl = Get-Acl -LiteralPath $path
  $acl.SetAccessRuleProtection($true, $false)
  $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $user, 'FullControl', 'Allow')
  $acl.SetAccessRule($rule)
  Set-Acl -LiteralPath $path -AclObject $acl
  [Console]::Out.Write('SAVED')
  exit 0
}
if (-not (Test-Path -LiteralPath $path)) { exit 2 }
$encrypted = [System.IO.File]::ReadAllText($path)
$secret = ConvertTo-SecureString $encrypted
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
