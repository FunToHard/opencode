export * as ShellPreamble from "./preamble.js"

/**
 * Lightweight PowerShell preamble to prevent context bloat when agents run directory listing commands
 * (`ls`, `dir`, `gci`, `Get-ChildItem`).
 *
 * Automatically excludes noisy directories ('node_modules', 'target', '.git', etc.) while informing
 * the model that items were pruned, and preserving the '-All' override switch and pipeline integrity.
 */
export const POWERSHELL_PREAMBLE = `if (-not (Get-Command Get-ChildItem -CommandType Function -ErrorAction SilentlyContinue)) {
  function Get-ChildItem {
    [CmdletBinding(DefaultParameterSetName='Items', SupportsTransactions=$true)]
    param(
      [Parameter(ParameterSetName='Items', Position=0, ValueFromPipeline=$true, ValueFromPipelineByPropertyName=$true)]
      [string[]]$Path,
      [Parameter(ParameterSetName='LiteralItems', Mandatory=$true, ValueFromPipelineByPropertyName=$true)]
      [Alias('PSPath')][string[]]$LiteralPath,
      [Parameter(Position=1)][string]$Filter,
      [string[]]$Include,
      [string[]]$Exclude,
      [Alias('s')][switch]$Recurse,
      [uint32]$Depth,
      [switch]$Force,
      [switch]$Name,
      [Alias('NoFilter','NoPrune')][switch]$All
    )
    process {
      $clean = [System.Collections.Generic.Dictionary[string,object]]::new($PSBoundParameters)
      $clean.Remove('All') | Out-Null; $clean.Remove('NoFilter') | Out-Null; $clean.Remove('NoPrune') | Out-Null
      if ($All.IsPresent -or ($env:OPENCODE_NO_PRUNE -eq '1') -or ($env:OPENCODE_NO_SHELL_PRUNE -eq '1')) {
        Microsoft.PowerShell.Management\\Get-ChildItem @clean
        return
      }
      $prune = @('node_modules','target','.git','.venv','venv','__pycache__','bin','obj','dist','build')
      $items = Microsoft.PowerShell.Management\\Get-ChildItem @clean
      $pruned = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
      foreach ($item in $items) {
        $n = if ($item -is [System.IO.FileSystemInfo]) { $item.Name } else { "$item" }
        if ($n -in $prune) {
          [void]$pruned.Add($n)
        } else {
          $item
        }
      }
      if ($pruned.Count -gt 0) {
        $names = ($pruned | Sort-Object) -join ', '
        Write-Host "[OpenCode: Pruned $($pruned.Count) item(s) ($names). Use -All to include]" -ForegroundColor DarkYellow
      }
    }
  }
};`

/**
 * Lightweight POSIX shell function for `ls` to prevent context bloat.
 * Uses GNU ls --ignore when available, with fallback and OPENCODE_NO_PRUNE=1 bypass.
 */
export const POSIX_PREAMBLE = `ls() {
  if [ "$OPENCODE_NO_PRUNE" = "1" ] || [ "$OPENCODE_NO_SHELL_PRUNE" = "1" ]; then
    command ls "$@"
    return
  fi
  if command ls --version >/dev/null 2>&1; then
    command ls --ignore=node_modules --ignore=target --ignore=.git --ignore=.venv --ignore=__pycache__ --ignore=dist --ignore=build "$@"
  else
    command ls "$@"
  fi
};`

/**
 * Wraps an agent shell command with the directory pruning preamble based on the shell flavor.
 */
export function wrap(file: string, command: string, isPowerShell: boolean): string {
  if (isPowerShell) {
    return `${POWERSHELL_PREAMBLE}\n${command}`
  }
  return `${POSIX_PREAMBLE}\n${command}`
}
