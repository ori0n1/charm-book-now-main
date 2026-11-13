$ErrorActionPreference = 'Stop'
$node = 'C:\Program Files\nodejs\node.exe'
$gateway = Join-Path $PSScriptRoot 'telegram-gateway.mjs'
if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or
    -not (Test-Path -LiteralPath $gateway -PathType Leaf)) {
  exit 2
}
& $node $gateway serve --monitor-events
exit $LASTEXITCODE
