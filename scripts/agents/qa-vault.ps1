param(
  [Parameter(Mandatory=$true)][ValidateSet('set','rotate','status','revoke','run','selftest')][string]$Mode,
  [ValidateSet('qa-a-password','qa-b-password','publishable-key')][string]$Name,
  [ValidateSet('STUDIO_QA_A','STUDIO_QA_B')][string]$Studio,
  [ValidateSet('auth-check')][string]$Operation = 'auth-check'
)
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$directory = Join-Path $env:LOCALAPPDATA 'Bellza\QA\secrets'

function Set-PrivateAcl([string]$Path) {
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($entry in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($entry) }
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
    $sid, 'FullControl', 'Allow'))
  Set-Acl -LiteralPath $Path -AclObject $acl
}
function Assert-PrivateAcl([string]$Path) {
  $acl = Get-Acl -LiteralPath $Path
  $rules = @($acl.Access)
  if (-not $acl.AreAccessRulesProtected -or $rules.Count -ne 1 -or
      $rules[0].AccessControlType -ne 'Allow' -or
      $rules[0].IdentityReference.Translate(
        [System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) {
    throw 'QA_VAULT_ACL_INVALID'
  }
}
function Save-Secret([string]$Path, [securestring]$Secret) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $temp = Join-Path $directory ("qa-" + [guid]::NewGuid().ToString('N') + '.tmp')
  try {
    [System.IO.File]::WriteAllText($temp, '')
    Set-PrivateAcl $temp
    [System.IO.File]::WriteAllText($temp, (ConvertFrom-SecureString $Secret))
    Move-Item -LiteralPath $temp -Destination $Path -Force
  } finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
  Assert-PrivateAcl $Path
}
function Unprotect-Secret([string]$Path) {
  Assert-PrivateAcl $Path
  $secure = ConvertTo-SecureString ([System.IO.File]::ReadAllText($Path))
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
if ($Mode -eq 'selftest') {
  $probe = Join-Path ([System.IO.Path]::GetTempPath()) ("bellza-qa-" + [guid]::NewGuid().ToString('N') + '.dpapi')
  $sample = [guid]::NewGuid().ToString('N')
  try {
    # Test the same DPAPI/ACL code without touching a real QA credential.
    $directory = Split-Path $probe -Parent
    Save-Secret $probe (ConvertTo-SecureString $sample -AsPlainText -Force)
    if ((Unprotect-Secret $probe) -ne $sample) { throw 'QA_VAULT_ROUNDTRIP_FAILED' }
    Write-Output 'QA_VAULT_SELFTEST_OK'
  } finally { Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue }
  exit 0
}
if ($Mode -eq 'run') {
  if (-not $Studio) { throw 'QA_STUDIO_REQUIRED' }
  $passwordName = if ($Studio -eq 'STUDIO_QA_A') { 'qa-a-password' } else { 'qa-b-password' }
  $passwordPath = Join-Path $directory "$passwordName.dpapi"
  $keyPath = Join-Path $directory 'publishable-key.dpapi'
  if (-not (Test-Path -LiteralPath $passwordPath) -or
      -not (Test-Path -LiteralPath $keyPath)) { throw 'QA_VAULT_ENTRY_MISSING' }
  $runExit = 1
  try {
    $env:BELLZA_QA_PASSWORD = Unprotect-Secret $passwordPath
    $env:BELLZA_QA_PUBLISHABLE = Unprotect-Secret $keyPath
    $runner = Join-Path $PSScriptRoot 'qa-auth-check.mjs'
    & node $runner --studio $Studio --operation $Operation
    $runExit = $LASTEXITCODE
  } finally {
    Remove-Item Env:BELLZA_QA_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:BELLZA_QA_PUBLISHABLE -ErrorAction SilentlyContinue
  }
  exit $runExit
}
if (-not $Name) { throw 'QA_VAULT_NAME_REQUIRED' }
$path = Join-Path $directory "$Name.dpapi"
if ($Mode -eq 'status') {
  if (-not (Test-Path -LiteralPath $path)) { Write-Output 'MISSING'; exit 0 }
  try { Assert-PrivateAcl $path; Write-Output 'PRESENT_PROTECTED' }
  catch { Write-Output 'ACL_INVALID'; exit 1 }
  exit 0
}
if ($Mode -eq 'revoke') {
  if (Test-Path -LiteralPath $path) { Assert-PrivateAcl $path; Remove-Item -LiteralPath $path -Force }
  Write-Output 'REVOKED_LOCAL_ONLY'
  exit 0
}
if ($Mode -eq 'set' -and (Test-Path -LiteralPath $path)) { throw 'QA_VAULT_ALREADY_SET' }
if ($Mode -eq 'rotate' -and -not (Test-Path -LiteralPath $path)) { throw 'QA_VAULT_ENTRY_MISSING' }
if ($Mode -eq 'rotate') { Assert-PrivateAcl $path }
$value = Read-Host "Introduza $Name (nao sera mostrado)" -AsSecureString
if ($value.Length -lt 12) { throw 'QA_VAULT_VALUE_TOO_SHORT' }
Save-Secret $path $value
Write-Output 'SAVED_PROTECTED'
