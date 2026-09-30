# Publish zuoyexiang to the server: build -> pack -> upload -> unpack -> restart backend
# Usage: powershell -ExecutionPolicy Bypass -File publish.ps1 -Key "D:\path\to\id_ed25519"
#   HK (active):    -Server 43.129.85.64  -User ubuntu   (default)
#   SH (standby):   -Server 43.142.131.119 -User root   (only after ICP filing)
param(
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$Server = '43.129.85.64',
  [string]$User = 'ubuntu',
  [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tar = Join-Path $env:TEMP 'zuoyexiang-payload.tar.gz'
$sshOpts = @('-i', $Key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15')
$target = $User + '@' + $Server

if (-not $SkipBuild) {
  Write-Host '== 1/4 build =='
  Push-Location $repo; npm run build; Pop-Location
}
Write-Host '== 2/4 pack (exclude node_modules / .env) =='
if (Test-Path $tar) { Remove-Item $tar -Force }
tar.exe -czf $tar --exclude=node_modules --exclude=.env -C $repo dist server
if ($LASTEXITCODE -ne 0) { throw 'pack failed' }

Write-Host '== 3/4 upload =='
scp @sshOpts $tar ($target + ':/tmp/payload.tar.gz')
if ($LASTEXITCODE -ne 0) { throw 'upload failed' }

Write-Host '== 4/4 unpack and restart =='
$inner = 'rm -rf /tmp/zxy-payload && mkdir -p /tmp/zxy-payload && tar -xzf /tmp/payload.tar.gz -C /tmp/zxy-payload && rm -f /tmp/payload.tar.gz && rsync -a --delete /tmp/zxy-payload/dist/ /opt/zuoyexiang/dist/ && rsync -a --delete --exclude node_modules --exclude .env /tmp/zxy-payload/server/ /opt/zuoyexiang/server/ && rm -rf /tmp/zxy-payload && chown -R zuoyexiang:zuoyexiang /opt/zuoyexiang && cd /opt/zuoyexiang/server && sudo -u zuoyexiang npm ci --omit=dev >/dev/null 2>&1 && systemctl restart zuoyexiang && sleep 1 && curl -fsS http://127.0.0.1:3000/api/health'
$quoted = [char]39 + $inner + [char]39
ssh @sshOpts $target ('sudo sh -c ' + $quoted)
Write-Host 'published OK'
