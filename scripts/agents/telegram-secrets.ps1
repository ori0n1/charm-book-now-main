param(
  [Parameter(Mandatory=$true)][ValidateSet('set','read','status','verify','selftest','set-all','gui','gui-remaining')][string]$Mode,
  [ValidatePattern('^(telegram-(atlas|sentinela|sherlock|valida|forge|guardiao)|openai-api)$')][string]$Name
)
$ErrorActionPreference = 'Stop'
trap {
  [Console]::Out.WriteLine("GUI_FATAL:$($_.Exception.GetType().Name):L$($_.InvocationInfo.ScriptLineNumber)")
  exit 1
}
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
function Save-ProtectedValue([string]$TargetPath, [securestring]$Value) {
  $directory = Split-Path $TargetPath -Parent
  $temp = Join-Path $directory ("bellza-secret-" + [guid]::NewGuid().ToString('N') + '.tmp')
  try {
    [System.IO.File]::WriteAllText($temp, (ConvertFrom-SecureString $Value))
    Protect-LocalFile $temp
    Move-Item -LiteralPath $temp -Destination $TargetPath -Force
  } finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}
function Read-HiddenValue([string]$Prompt) {
  [Console]::Write("${Prompt}: ")
  $value = [System.Security.SecureString]::new()
  while ($true) {
    $key = [Console]::ReadKey($true)
    if ($key.Key -eq [ConsoleKey]::Enter) { break }
    if ($key.Key -eq [ConsoleKey]::Backspace) {
      if ($value.Length -gt 0) { $value.RemoveAt($value.Length - 1) }
      continue
    }
    if ($key.KeyChar -ne [char]0) { $value.AppendChar($key.KeyChar) }
  }
  [Console]::WriteLine()
  if ($value.Length -eq 0) { throw 'EMPTY_SECRET_DENIED' }
  $value.MakeReadOnly()
  return $value
}
if ($Mode -eq 'selftest') {
  $path = Join-Path ([System.IO.Path]::GetTempPath()) ("bellza-dpapi-" + [guid]::NewGuid().ToString('N') + '.tmp')
  $synthetic = [guid]::NewGuid().ToString('N')
  try {
    $secure = ConvertTo-SecureString $synthetic -AsPlainText -Force
    Save-ProtectedValue $path $secure
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
$directory = Join-Path $env:LOCALAPPDATA 'Bellza\TelegramGateway\secrets'
if ($Mode -eq 'gui' -or $Mode -eq 'gui-remaining') {
  if (-not [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') -or
      -not [System.Reflection.Assembly]::LoadWithPartialName('System.Drawing')) {
    throw 'WINDOWS_FORMS_UNAVAILABLE'
  }
  $form = [System.Windows.Forms.Form]::new()
  $remaining = $Mode -eq 'gui-remaining'
  $form.Text = if ($remaining) { 'Bellza - Sherlock, Valida e Forge' }
    else { 'Bellza - credenciais Atlas, Sentinela e OpenAI' }
  $form.ClientSize = [System.Drawing.Size]::new(560, 288)
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.TopMost = $true
  $intro = [System.Windows.Forms.Label]::new()
  $intro.Text = if ($remaining) {
    'Cole o token COMPLETO do BotFather (numero:codigo), nao apenas o ID. Os caracteres ficam ocultos.'
  } else { 'Cole cada valor no campo correspondente. Os caracteres ficam ocultos.' }
  $intro.Location = [System.Drawing.Point]::new(20, 18)
  $intro.Size = [System.Drawing.Size]::new(520, 35)
  $form.Controls.Add($intro)
  $items = if ($remaining) {
    @(
      @{ Name = 'telegram-sherlock'; Label = 'Token Telegram Sherlock' },
      @{ Name = 'telegram-valida'; Label = 'Token Telegram Valida' },
      @{ Name = 'telegram-forge'; Label = 'Token Telegram Forge' }
    )
  } else {
    @(
      @{ Name = 'telegram-atlas'; Label = 'Token Telegram Atlas' },
      @{ Name = 'telegram-sentinela'; Label = 'Token Telegram Sentinela' },
      @{ Name = 'openai-api'; Label = 'Chave OpenAI API' }
    )
  }
  $boxes = @{}
  for ($index = 0; $index -lt $items.Count; $index++) {
    $item = $items[$index]
    $y = 60 + $index * 52
    $label = [System.Windows.Forms.Label]::new()
    $label.Text = $item.Label
    $label.Location = [System.Drawing.Point]::new(20, $y)
    $label.Size = [System.Drawing.Size]::new(165, 25)
    $form.Controls.Add($label)
    $box = [System.Windows.Forms.TextBox]::new()
    $box.Location = [System.Drawing.Point]::new(190, $y - 3)
    $box.Size = [System.Drawing.Size]::new(340, 27)
    $box.UseSystemPasswordChar = $true
    $box.MaxLength = 512
    if (Test-Path -LiteralPath (Join-Path $directory "$($item.Name).dpapi")) {
      $box.Enabled = $false
      $box.Text = 'JA GUARDADO'
    }
    $form.Controls.Add($box)
    $boxes[$item.Name] = $box
  }
  $save = [System.Windows.Forms.Button]::new()
  $save.Text = 'Guardar com DPAPI'
  $save.Location = [System.Drawing.Point]::new(340, 228)
  $save.Size = [System.Drawing.Size]::new(190, 36)
  $form.Controls.Add($save)
  $save.Add_Click({
    $currentName = ''
    try {
      foreach ($item in $items) {
        $currentName = $item.Name
        $box = $boxes[$currentName]
        if (-not $box.Enabled) { continue }
        $plain = $box.Text
        if ([string]::IsNullOrWhiteSpace($plain)) { throw 'EMPTY_VALUE' }
        if ($currentName -like 'telegram-*' -and
            $plain -notmatch '^\d{5,15}:[A-Za-z0-9_-]{20,}$') {
          throw 'TELEGRAM_TOKEN_FORMAT_INVALID'
        }
        $secure = [System.Security.SecureString]::new()
        foreach ($character in $plain.ToCharArray()) { $secure.AppendChar($character) }
        $secure.MakeReadOnly()
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        Save-ProtectedValue (Join-Path $directory "$currentName.dpapi") $secure
        $box.Clear()
        $box.Enabled = $false
        $plain = $null
      }
      $savedMessage = if ($remaining) { 'Sherlock, Valida e Forge guardados no perfil Windows.' }
        else { 'Atlas, Sentinela e OpenAI guardados no perfil Windows.' }
      [System.Windows.Forms.MessageBox]::Show($savedMessage,
        'Bellza', 'OK', 'Information') | Out-Null
      $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
      $form.Close()
    } catch {
      $errorCode = if ($_.Exception.Message -eq 'EMPTY_VALUE' -or
          $_.Exception.Message -eq 'TELEGRAM_TOKEN_FORMAT_INVALID') {
        $_.Exception.Message
      } else {
        "$($_.Exception.GetType().Name):L$($_.InvocationInfo.ScriptLineNumber)"
      }
      [Console]::Out.WriteLine("GUI_ERROR:${currentName}:$errorCode")
      $reason = switch ($_.Exception.Message) {
        'EMPTY_VALUE' { 'Preencha os tres campos antes de guardar.' }
        'TELEGRAM_TOKEN_FORMAT_INVALID' {
          'Use o token completo recebido do BotFather: numeros, dois-pontos e codigo. O ID do bot sozinho nao serve.'
        }
        default { 'Falha local ao guardar. Execute o autoteste DPAPI ou informe apenas o codigo do erro.' }
      }
      [System.Windows.Forms.MessageBox]::Show(
        "Nao foi possivel guardar $currentName. $reason",
        'Bellza', 'OK', 'Error') | Out-Null
    }
  })
  $form.Add_Shown({
    foreach ($item in $items) {
      if ($boxes[$item.Name].Enabled) { $boxes[$item.Name].Focus(); break }
    }
  })
  $form.Add_FormClosed({ foreach ($box in $boxes.Values) { $box.Clear() } })
  $result = $form.ShowDialog()
  if ($result -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }
  exit 0
}
if ($Mode -eq 'set-all') {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $names = @('telegram-atlas','telegram-sentinela','openai-api')
  Write-Host 'Bellza: Atlas, Sentinela e OpenAI na mesma janela.'
  Write-Host 'Cole cada valor apenas quando aparecer Valor para ... e prima Enter.'
  for ($index = 0; $index -lt $names.Count; $index++) {
    $currentName = $names[$index]
    $currentPath = Join-Path $directory "$currentName.dpapi"
    if (Test-Path -LiteralPath $currentPath) {
      Write-Host ("{0}/3 {1}: ja guardado." -f ($index + 1), $currentName)
      continue
    }
    Write-Host ("{0}/3 {1}" -f ($index + 1), $currentName)
    try {
      $inputValue = Read-HiddenValue "Valor para $currentName"
      Save-ProtectedValue $currentPath $inputValue
      Write-Host 'SAVED'
    } catch {
      Write-Host ("FALHA EM {0}: {1} (linha {2})" -f $currentName,
        $_.FullyQualifiedErrorId, $_.InvocationInfo.ScriptLineNumber)
      exit 1
    }
  }
  Write-Host 'CONCLUIDO: 3 entradas guardadas.'
  exit 0
}
if ([string]::IsNullOrWhiteSpace($Name)) { throw 'SECRET_NAME_REQUIRED' }
$path = Join-Path $directory "$Name.dpapi"
if ($Mode -eq 'status') {
  if (Test-Path -LiteralPath $path) { [Console]::Out.Write('PRESENT') }
  else { [Console]::Out.Write('MISSING') }
  exit 0
}
if ($Mode -eq 'verify') {
  if (-not (Test-Path -LiteralPath $path)) { [Console]::Out.Write('MISSING'); exit 2 }
  $pointer = [IntPtr]::Zero
  try {
    $encrypted = [System.IO.File]::ReadAllText($path)
    $secret = ConvertTo-SecureString $encrypted
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($Name -like 'telegram-*' -and
        $value -notmatch '^\d{5,15}:[A-Za-z0-9_-]{20,}$') {
      throw 'TOKEN_FORMAT_INVALID'
    }
    if ($Name -eq 'openai-api' -and [string]::IsNullOrWhiteSpace($value)) {
      throw 'API_KEY_EMPTY'
    }
    [Console]::Out.Write('DECRYPT_OK')
  } catch {
    [Console]::Out.Write("DECRYPT_FAILED:$($_.FullyQualifiedErrorId)")
    exit 1
  } finally {
    if ($pointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  }
  exit 0
}
if ($Mode -eq 'set') {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $secret = Read-HiddenValue "Valor para $Name"
  Save-ProtectedValue $path $secret
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
