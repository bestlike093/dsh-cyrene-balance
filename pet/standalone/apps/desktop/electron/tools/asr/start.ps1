# Start the local ASR server (runs in the foreground; close the window to stop).
param(
  [int]$Port = 8123,
  [string]$Model = "small",
  [string]$Device = "cpu",
  [string]$ComputeType = "int8"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $here ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
  Write-Error "venv not found. Run install.ps1 first."
}

$env:CYRENE_ASR_MODEL = $Model
$env:CYRENE_ASR_DEVICE = $Device
$env:CYRENE_ASR_COMPUTE = $ComputeType
# Keep the model cache under %LOCALAPPDATA%: the project path contains non-ASCII
# characters, and passing it through cmd/PowerShell mangles it into question marks.
$env:CYRENE_ASR_MODEL_DIR = Join-Path $env:LOCALAPPDATA "cyrene-asr\models"
# Use the mirror when the model still has to be downloaded for the first time.
if (-not $env:HF_ENDPOINT) { $env:HF_ENDPOINT = "https://hf-mirror.com" }

& $venvPython (Join-Path $here "server.py") --port $Port --model $Model --device $Device --compute-type $ComputeType
