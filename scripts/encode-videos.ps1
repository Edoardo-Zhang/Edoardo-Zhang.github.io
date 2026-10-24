param(
  [string]$Ffmpeg = 'ffmpeg',
  [string]$Revision = 'v3'
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

  # 横版（电脑 / 平板 / 横屏手机）：保持源帧率 24fps，1280x720
  & $Ffmpeg -hide_banner -loglevel error -i $inputFile -map 0:v:0 -an -vf 'fps=24' `
    -c:v libx264 -preset slower -crf 23 -profile:v high -pix_fmt yuv420p -g 48 `
    -movflags +faststart -map_metadata -1 -y $videoFile
  if ($LASTEXITCODE -ne 0) { throw "Video encode failed: $name" }

  # 竖屏手机：只裁画面中间 404x720（竖屏手机本来就只显示这一条），体积约为横版的 1/5
  $phoneFile = Join-Path $target "$name-$Revision-m.mp4"
  & $Ffmpeg -hide_banner -loglevel error -i $inputFile -map 0:v:0 -an -vf 'fps=24,crop=404:720:(in_w-404)/2:0' `
    -c:v libx264 -preset slower -crf 25 -profile:v high -pix_fmt yuv420p -g 48 `
    -movflags +faststart -map_metadata -1 -y $phoneFile
  if ($LASTEXITCODE -ne 0) { throw "Phone video encode failed: $name" }

  & $Ffmpeg -hide_banner -loglevel error -ss 0.05 -i $inputFile `
    -frames:v 1 -c:v libwebp -quality 80 -y $posterFile
  if ($LASTEXITCODE -ne 0) { throw "Poster encode failed: $name" }
  & $Ffmpeg -hide_banner -loglevel error -ss 0.05 -i $inputFile -frames:v 1 -vf 'crop=404:720:(in_w-404)/2:0' `
    -c:v libwebp -quality 80 -y (Join-Path $target "$name-$Revision-m.webp")
  if ($LASTEXITCODE -ne 0) { throw "Phone poster encode failed: $name" }

  Write-Output "$name  横版 $([math]::Round((Get-Item $videoFile).Length / 1KB)) KB · 手机 $([math]::Round((Get-Item $phoneFile).Length / 1KB)) KB"
}
