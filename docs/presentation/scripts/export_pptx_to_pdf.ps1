param(
  [string]$InputPptx = "docs/presentation/CollabIDE_Final_Presentation.pptx",
  [string]$OutputPdf = "docs/presentation/CollabIDE_Final_Presentation.pdf"
)

$ErrorActionPreference = "Stop"

$absInput = (Resolve-Path $InputPptx).Path
$absOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPdf))

$ppt = $null
$pres = $null
$openedExisting = $false

try {
  $ppt = New-Object -ComObject PowerPoint.Application
  $hadOpenPresentations = ($ppt.Presentations.Count -gt 0)

  # Open read-only and windowless (WithWindow = 0) so it does not disrupt the desktop
  $pres = $ppt.Presentations.Open($absInput, -1, 0, 0)
  # 32 = ppSaveAsPDF
  $pres.SaveAs($absOutput, 32)
  Write-Output "Exported PDF: $absOutput ($((Get-Item $absOutput).Length) bytes)"
} finally {
  if ($pres -ne $null) {
    try { $pres.Close() } catch {}
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($pres) | Out-Null
  }
  if ($ppt -ne $null) {
    if (-not $hadOpenPresentations -and $ppt.Presentations.Count -eq 0) {
      try { $ppt.Quit() } catch {}
    }
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
