param(
  [Parameter(Mandatory=$true)][ValidateSet('set','read','status','selftest')][string]$Mode,
  [ValidatePattern('^(telegram-(atlas|sentinela|sherlock|valida|forge|guardiao)|openai-api)$')][string]$Name
)
$ErrorActionPreference = 'Stop'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
function Protect-LocalFile([string]$FilePath) {
  $acl = Get-Acl -LiteralPath $FilePath
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($existing in @($acl.Access)) {
    $acl.RemoveAccessRuleSpecific($existing)
  }
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $user, 'FullControl', 'Allow')
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $FilePath -AclObject $acl
}
if ($Mode -eq 'selftest') {
  $path = Join-Path ([System.IO.Path]::GetTempPath()) ("bellza-dpapi-" + [guid]::NewGuid().ToString('N') + '.tmp')
  $synthetic = [guid]::NewGuid().ToString('N')
  try {
    $secure = ConvertTo-SecureString $synthetic -AsPlainText -Force
    [System.IO.File]::WriteAllText($path, (ConvertFrom-SecureString $secure))
    Protect-LocalFile $path
    $acl = Get-Acl -LiteralPath $path
    if (-not $acl.AreAccessRulesProtected) { throw 'ACL_NOT_PROTECTED' }
    $rules = @($acl.Access)
    if ($rules.Count -ne 1 -or
        $rules[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $user.Value) {
      throw 'ACL_NOT_ISOLATED'
    }
    $restored = ConvertTo-SecureString ([System.IO.File]::ReadAllText($path))
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($restored)
    try {
      if ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) -ne $synthetic) {
        throw 'DPAPI_ROUNDTRIP_FAILED'
      }
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    [Console]::Out.Write('DPAPI_SELFTEST_OK')
  } finally { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
  exit 0
}
if ([string]::IsNullOrWhiteSpace($Name)) { throw 'SECRET_NAME_REQUIRED' }
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
  $temp = Join-Path $directory ("$Name." + [guid]::NewGuid().ToString('N') + '.tmp')
  try {
    [System.IO.File]::WriteAllText($temp, $encrypted)
    Protect-LocalFile $temp
    Move-Item -LiteralPath $temp -Destination $path -Force
  } finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
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
