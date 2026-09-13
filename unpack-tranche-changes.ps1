<#
  Unpacks tranche-changes.bundle.txt back into the TrancheWA-App source tree.

  USAGE (run from the TrancheWA-App repo root on the other machine):
      pwsh ./unpack-tranche-changes.ps1
  or:
      powershell -ExecutionPolicy Bypass -File .\unpack-tranche-changes.ps1

  Options:
      -Bundle  Path to the bundle file (default: .\tranche-changes.bundle.txt)
      -Root    Repo root where files are written (default: current directory)
      -DryRun  List what would be written without changing anything

  Each file is overwritten at its path. Afterwards, review with `git status` /
  `git diff` before committing so you can reconcile any local changes.
#>
param(
    [string]$Bundle = ".\tranche-changes.bundle.txt",
    [string]$Root   = ".",
    [switch]$DryRun
)

if (-not (Test-Path $Bundle)) {
    Write-Error "Bundle not found: $Bundle"
    exit 1
}

$lines = [System.IO.File]::ReadAllLines((Resolve-Path $Bundle), [System.Text.Encoding]::UTF8)
$rootFull = (Resolve-Path $Root).Path

$written = 0
$new = 0
$overwritten = 0
$i = 0
while ($i -lt $lines.Count) {
    $line = $lines[$i]
    if ($line -like '===== * =====') {
        $rel = $line.Substring(6, $line.Length - 12)   # strip "===== " and " ====="
        $b64 = if (($i + 1) -lt $lines.Count) { $lines[$i + 1] } else { "" }
        $dest = Join-Path $rootFull $rel
        $existed = Test-Path $dest

        if ($DryRun) {
            $tag = if ($existed) { "overwrite" } else { "new" }
            Write-Host ("[{0,-9}] {1}" -f $tag, $rel)
        }
        else {
            $bytes = [Convert]::FromBase64String($b64)
            $dir = Split-Path $dest -Parent
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            [System.IO.File]::WriteAllBytes($dest, $bytes)
            if ($existed) { $overwritten++; Write-Host ("[overwrite] {0}" -f $rel) }
            else          { $new++;        Write-Host ("[new]       {0}" -f $rel) }
        }
        $written++
        $i += 2
    }
    else {
        $i++
    }
}

Write-Host ""
if ($DryRun) {
    Write-Host ("DRY RUN - {0} file(s) would be written. Re-run without -DryRun to apply." -f $written)
} else {
    Write-Host ("Done. {0} file(s) written ({1} new, {2} overwritten)." -f $written, $new, $overwritten)
    Write-Host "Next: run 'git status' and 'git diff' to review, then build and commit."
}
