param(
  [string]$Ffmpeg = 'ffmpeg',
  [string]$Revision = 'v2'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$source = Join-Path $root 'source-assets/video-originals'
$target = Join-Path $root 'public/input-assets'

foreach ($name in @('golden-hour', 'still-water', 'deep-forest', 'quiet-dawn')) {
  $inputFile = Join-Path $source "$name.mp4"
  $videoFile = Join-Path $target "$name-$Revision.mp4"
  $posterFile = Join-Path $target "$name-$Revision.webp"
  if (-not (Test-Path -LiteralPath $inputFile)) { throw "Missing source: $inputFile" }

  & $Ffmpeg -hide_banner -loglevel error -i $inputFile -map 0:v:0 -an `
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p `
    -movflags +faststart -map_metadata -1 -y $videoFile
  if ($LASTEXITCODE -ne 0) { throw "Video encode failed: $name" }

  & $Ffmpeg -hide_banner -loglevel error -ss 0.12 -i $inputFile `
    -frames:v 1 -c:v libwebp -quality 82 -y $posterFile
  if ($LASTEXITCODE -ne 0) { throw "Poster encode failed: $name" }

  Write-Output "$name  $([math]::Round((Get-Item $videoFile).Length / 1MB, 2)) MB"
}
