$ErrorActionPreference = "Stop"

$baselineCommit = "832bc0b4d91fa2a5d05c2de334e3428e187b7e4a"
$workspacePath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$trackedFiles = @(
  "public/manifest.webmanifest",
  "src/lib/auth-landing.ts",
  "src/routes/_authenticated/admin.agenda.tsx"
)

git -C $workspacePath restore --source=$baselineCommit -- $trackedFiles
if ($LASTEXITCODE -ne 0) {
  throw "Não foi possível restaurar os ficheiros rastreados."
}

$newFiles = @(
  "src/components/agenda/professional-timeline-utils.ts",
  "src/components/agenda/professional-timeline.tsx",
  "src/components/agenda/timeline-appointment-drawer.tsx",
  "tests/professional-agenda-timeline.spec.ts"
)

foreach ($relativePath in $newFiles) {
  $targetPath = [System.IO.Path]::GetFullPath((Join-Path $workspacePath $relativePath))
  if (-not $targetPath.StartsWith($workspacePath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Caminho de rollback fora do workspace: $targetPath"
  }

  if (Test-Path -LiteralPath $targetPath) {
    Remove-Item -LiteralPath $targetPath -Force
  }
}

Write-Host "Rollback visual da agenda concluído para $baselineCommit."
