# 从 Windows 一键发布到服务器：构建 -> 打包 -> 上传 -> 解包 -> 重启后端
# 用法： powershell -ExecutionPolicy Bypass -File publish.ps1 -Key "D:\path\to\id_ed25519"
param(
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$Server = 'root@43.142.131.119',
  [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tar = Join-Path $env:TEMP 'zuoyexiang-payload.tar.gz'
$sshOpts = @('-i', $Key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15')

if (-not $SkipBuild) {
  Write-Host '== 1/4 构建前端 =='
  Push-Location $repo; npm run build; Pop-Location
}
Write-Host '== 2/4 打包（不含 node_modules / .env）=='
if (Test-Path $tar) { Remove-Item $tar -Force }
tar.exe -czf $tar --exclude=node_modules --exclude=.env -C $repo dist server
if ($LASTEXITCODE -ne 0) { throw '打包失败' }

Write-Host '== 3/4 上传 =='
scp @sshOpts $tar ($Server + ':/tmp/payload.tar.gz')
if ($LASTEXITCODE -ne 0) { throw '上传失败' }

Write-Host '== 4/4 解包并重启 =='
$remote = 'tar -xzf /tmp/payload.tar.gz -C /opt/zuoyexiang && rm -f /tmp/payload.tar.gz && chown -R zuoyexiang:zuoyexiang /opt/zuoyexiang && cd /opt/zuoyexiang/server && sudo -u zuoyexiang npm ci --omit=dev >/dev/null 2>&1 && systemctl restart zuoyexiang && sleep 1 && curl -fsS http://127.0.0.1/api/health && echo "  <- 后端已重启并健康"'
ssh @sshOpts $Server $remote
Write-Host '发布完成'
