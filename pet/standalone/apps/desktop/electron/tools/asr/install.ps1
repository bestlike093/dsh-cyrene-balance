# Cyrene local ASR installer (faster-whisper)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Model small -SkipModel
#
# Notes:
# - The venv lives in this folder; the model cache lives in
#   %LOCALAPPDATA%\cyrene-asr\models (the project path has non-ASCII characters).
# - Set -Mirror hf to pull the model from hf-mirror.com (useful in CN)
# - Re-running is safe; existing venv is reused.

param(
  [string]$Model = "small",
  [string]$Python = "python",
  [ValidateSet("auto", "pipl", "tsinghua", "aliyun")]
  [string]$Index = "tsinghua",
  [ValidateSet("hf", "official")]
  [string]$Mirror = "hf",
  [switch]$SkipModel
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $here ".venv"
$venvPython = Join-Path $venv "Scripts\python.exe"

Write-Host "[1/4] checking python..."
$version = & $Python --version 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Error "Python not found. Install Python 3.10+ and make sure 'python' is on PATH."
}
Write-Host "      $version"

if (-not (Test-Path $venvPython)) {
  Write-Host "[2/4] creating venv at $venv"
  & $Python -m venv $venv
} else {
  Write-Host "[2/4] venv already exists, reusing"
}

Write-Host "[3/4] installing dependencies..."
$pipArgs = @("-m", "pip", "install", "--upgrade", "pip")
& $venvPython @pipArgs | Out-Null

$installArgs = @("-m", "pip", "install", "-r", (Join-Path $here "requirements.txt"))
switch ($Index) {
  "pipl"     { $installArgs += @("-i", "https://pypi.org/simple") }
  "tsinghua" { $installArgs += @("-i", "https://pypi.tuna.tsinghua.edu.cn/simple") }
  "aliyun"   { $installArgs += @("-i", "https://mirrors.aliyun.com/pypi/simple") }
  default    { }
}
& $venvPython @installArgs
if ($LASTEXITCODE -ne 0) { Write-Error "pip install failed." }

if (-not $SkipModel) {
  Write-Host "[4/4] pre-downloading model '$Model' (first run only, can take a few minutes)..."
  if ($Mirror -eq "hf") { $env:HF_ENDPOINT = "https://hf-mirror.com" }
  # Cache the model under %LOCALAPPDATA%: the project path contains non-ASCII
  # characters, and cmd/PowerShell would mangle it into question marks.
  $env:CYRENE_ASR_MODEL_DIR = Join-Path $env:LOCALAPPDATA "cyrene-asr\models"
  $code = @"
import os
from faster_whisper import WhisperModel
root = os.environ.get('CYRENE_ASR_MODEL_DIR') or os.path.join(r'$here', 'models')
os.makedirs(root, exist_ok=True)
print('downloading', '$Model', '->', root, flush=True)
WhisperModel('$Model', device='cpu', compute_type='int8', download_root=root)
print('model ready', flush=True)
"@
  $code | & $venvPython -
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Model download failed. The server will retry on first request."
  }
} else {
  Write-Host "[4/4] skipped model download"
}

Write-Host ""
Write-Host "Done. Start the server with:"
Write-Host "  $(Join-Path $here 'start.ps1')"
Write-Host ""
