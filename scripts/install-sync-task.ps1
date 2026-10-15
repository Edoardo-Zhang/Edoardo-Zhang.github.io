# 安装"作业箱收件同步"计划任务：登录 Windows 时运行一次，之后每 30 分钟运行一次。
# 电脑关机/断网期间错过的运行会在下次可用时补上；同步脚本本身永不删除任何文件。
# 用法（在项目根目录，普通 PowerShell 即可，无需管理员）：
#   powershell -ExecutionPolicy Bypass -File scripts/install-sync-task.ps1
#   可选参数：-SyncDir "E:\别的文件夹"   -Uninstall
param(
  [string]$SyncDir = 'D:\作业箱收件',
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$TaskName = '作业箱收件同步'

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "已移除计划任务「$TaskName」。已下载的作业仍保留在 $SyncDir。"
  exit 0
}

$Root = Split-Path -Parent $PSScriptRoot
$Script = Join-Path $Root 'sync\sync-submissions.mjs'
$Node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $Root 'server\.env'))) { throw "找不到 server\.env（同步需要其中的 OSS 配置）" }

New-Item -ItemType Directory -Force -Path $SyncDir | Out-Null

# 通过 cmd 设置 SYNC_DIR 后运行 node；窗口隐藏
$Arg = "/c set ""SYNC_DIR=$SyncDir"" && ""$Node"" ""$Script"""
$Action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $Arg -WorkingDirectory $Root
$AtLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Every30 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 30)
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($AtLogon, $Every30) -Settings $Settings `
  -Principal $Principal -Description '把作业箱里同学提交的作业从阿里云 OSS 同步到本机（只下载，不删除）。' -Force | Out-Null

Write-Host "已安装计划任务「$TaskName」：登录时 + 每 30 分钟同步到 $SyncDir"
Write-Host "现在先手动跑一次……"
Start-ScheduledTask -TaskName $TaskName
Write-Host "日志：$SyncDir\_sync.log"
