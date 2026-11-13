param([ValidateSet('live', 'visual-fault')][string]$Mode = 'live')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$state = Join-Path $root ('.bellza-agent-state\phase15-operational\' +
  [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $state -Force | Out-Null
$stdinFile = Join-Path $state 'empty.stdin'
$stdoutFile = Join-Path $state 'stdout.txt'
$stderrFile = Join-Path $state 'stderr.txt'
$metricsFile = Join-Path $state 'metrics.json'
[System.IO.File]::WriteAllBytes($stdinFile, [byte[]]@())

# The reader must use only the pre-existing restricted Wrangler OAuth session.
foreach ($entry in @(Get-ChildItem Env:)) {
  if ($entry.Name -match '^(CLOUDFLARE_|CF_API_|SUPABASE_|STRIPE_)') {
    Remove-Item -LiteralPath "Env:$($entry.Name)" -ErrorAction SilentlyContinue
  }
}

$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $node)) { throw 'NODE_NOT_AVAILABLE' }
$entry = if ($Mode -eq 'visual-fault') {
  'scripts/agents/phase15-visual-fault.mjs'
} else {
  'scripts/agents/monitor-visual-live.mjs'
}
$started = Get-Date
$deadline = $started.AddMinutes(3)
$child = Start-Process -FilePath $node -ArgumentList $entry `
  -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardInput $stdinFile `
  -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile -PassThru
$known = @{}
$known[[int]$child.Id] = $true
$chromiumPids = @{}
$peakNode = [long]0
$peakChromium = [long]0
$peakCombined = [long]0
$peakOther = [long]0
$samples = 0
$owner = 'UNKNOWN'
$timedOut = $false

do {
  $processes = @(Get-CimInstance -ClassName Win32_Process)
  foreach ($process in $processes) {
    if ($known.ContainsKey([int]$process.ParentProcessId)) {
      $known[[int]$process.ProcessId] = $true
    }
  }
  $nodeBytes = [long]0
  $chromiumBytes = [long]0
  $otherBytes = [long]0
  foreach ($process in $processes) {
    if (-not $known.ContainsKey([int]$process.ProcessId)) { continue }
    $bytes = [long]$process.WorkingSetSize
    if ($process.Name -match '^node(?:\.exe)?$') {
      $nodeBytes += $bytes
    } elseif ($process.Name -match '(?:chrome|chromium|headless)') {
      $chromiumBytes += $bytes
      $chromiumPids[[int]$process.ProcessId] = $true
    } else {
      $otherBytes += $bytes
    }
    if ([int]$process.ProcessId -eq [int]$child.Id -and $owner -eq 'UNKNOWN') {
      try {
        $identity = Invoke-CimMethod -InputObject $process -MethodName GetOwner
        if ($identity.ReturnValue -eq 0) {
          $owner = "$($identity.Domain)\$($identity.User)"
        }
      } catch { $owner = 'UNAVAILABLE' }
    }
  }
  $peakNode = [math]::Max($peakNode, $nodeBytes)
  $peakChromium = [math]::Max($peakChromium, $chromiumBytes)
  $peakOther = [math]::Max($peakOther, $otherBytes)
  $peakCombined = [math]::Max($peakCombined, $nodeBytes + $chromiumBytes)
  $samples++
  $child.Refresh()
  if (-not $child.HasExited) { Start-Sleep -Milliseconds 300 }
} while (-not $child.HasExited -and (Get-Date) -lt $deadline)

if (-not $child.HasExited) {
  $timedOut = $true
  foreach ($pidValue in @($known.Keys | Sort-Object -Descending)) {
    try { Stop-Process -Id ([int]$pidValue) -Force -ErrorAction Stop }
    catch { }
  }
  $child.WaitForExit(5000) | Out-Null
}
$finished = Get-Date
Start-Sleep -Seconds 2
$remaining = @(Get-CimInstance -ClassName Win32_Process | Where-Object {
  $chromiumPids.ContainsKey([int]$_.ProcessId) -and
  $_.Name -match '(?:chrome|chromium|headless)'
} | Select-Object -ExpandProperty ProcessId)
$exitCode = if ($child.HasExited) { $child.ExitCode } else { $null }
$metrics = [ordered]@{
  probeDirectory = $state
  mode = $Mode
  startUtc = $started.ToUniversalTime().ToString('o')
  finishUtc = $finished.ToUniversalTime().ToString('o')
  durationMs = [math]::Round(($finished - $started).TotalMilliseconds)
  account = $owner
  rootPid = [int]$child.Id
  exitCode = $exitCode
  timedOut = $timedOut
  samples = $samples
  peakNodeWorkingSetBytes = $peakNode
  peakChromiumWorkingSetBytes = $peakChromium
  peakNodePlusChromiumBytes = $peakCombined
  peakOtherDescendantBytes = $peakOther
  chromiumProcessCount = $chromiumPids.Count
  orphanChromiumPids = $remaining
}
$metrics | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $metricsFile
$metrics | ConvertTo-Json -Compress -Depth 3
