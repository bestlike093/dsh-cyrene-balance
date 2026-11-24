/**
 * 识屏：把当前屏幕上看得见的文字读出来，整理成一句能进提示词的话。
 *
 * 走的是 Windows 自带的 OCR（Windows.Media.Ocr），不联网、不额外配密钥，
 * 图片只落在临时目录，读完就删。识别结果会进入这一轮的理解，
 * 所以必须由用户在设置里明确打开；默认关闭。
 *
 * 这里只做「文字 → 可用的一句」，截图和进程调用留在主进程，
 * 纯函数方便测试。
 */

/** 屏幕上多半是界面碎片，留太多会比正文还吵。 */
const MAX_LINES = 24
const MAX_CHARS = 500
/** 两个字符以下的行基本是图标旁的残字，除非带数字。 */
const MIN_LINE_CHARS = 2

/** 去掉控制字符、零宽字符和多余空白。 */
function cleanLine(raw) {
  return String(raw)
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    // 中文 OCR 常把每个字都拆开，和旁边的空白一起收掉。
    .replace(
      /(?<=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])\s+(?=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])/g,
      ''
    )
    .trim()
}

/** 纯时钟、纯数字短串多半是状态栏，读了也没用。 */
function isNoise(line) {
  if (/^\d{1,2}\s*[:：]\s*\d{2}$/.test(line)) return true
  // 100% / 12 / 2026 这类纯数字短串同样是状态栏残字，单独出现没有语义，一并滤掉。
  if (/^\d{1,8}(?:%|年)?$/.test(line)) return true
  return false
}

function isMeaningful(line) {
  if (line.length === 0) return false
  // 纯符号/纯标点不要。
  if (!/[\p{L}\p{N}]/u.test(line)) return false
  if (line.length < MIN_LINE_CHARS) return false
  if (isNoise(line)) return false
  // 整行都已经被脱敏替换掉，说明这一行没有可用的上下文。
  if (/^\[[^\]]*已隐藏\]$/.test(line)) return false
  return true
}

const REDACTED = {
  phone: '[手机号已隐藏]',
  idCard: '[身份证已隐藏]',
  bankCard: '[卡号已隐藏]',
  email: '[邮箱已隐藏]',
  secret: '[密钥已隐藏]',
  passwordLine: '[密码/验证码行已隐藏]'
}

/** 密码/验证码行整行替换：这类行里通常除了凭据没有别的语义。 */
const PASSWORD_LINE = /(?:密码|口令|验证码|动态码|password|passwd|pwd|otp|verification\s*code)\s*[:：=]\s*\S+/i
const PHONE = /(?<!\d)1[3-9]\d(?:[ -]?\d{4}){2}(?!\d)/g
const ID_CARD = /(?<!\d)\d{17}[\dXx](?!\d)/g
const BANK_CARD = /(?<!\d)(?:\d{4}[ -]?){3}\d{4}(?!\d)/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const API_KEY = /\b(?:sk|pk|ak)-[A-Za-z0-9_-]{12,}\b/g
const BEARER = /\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi

/**
 * 把屏幕上常见的敏感串替换掉，再交给提示词。
 *
 * 只做「行内替换」而不是删行：保留上下文（例如「手机号：…」），
 * 让模型知道这里有一项信息，但拿不到具体值。
 */
export function redactSensitiveText(value) {
  let text = String(value)
  if (PASSWORD_LINE.test(text)) return REDACTED.passwordLine
  text = text
    .replace(PHONE, REDACTED.phone)
    .replace(ID_CARD, REDACTED.idCard)
    .replace(BANK_CARD, REDACTED.bankCard)
    .replace(EMAIL, REDACTED.email)
    .replace(API_KEY, REDACTED.secret)
    .replace(BEARER, REDACTED.secret)
  return text
}

/**
 * 把 OCR 的逐行结果压成一句。
 *
 * @param {string[]|string|null} raw OCR 行数组，或已经用换行拼好的文本
 * @param {{ maxLines?: number, maxChars?: number }} options
 * @returns {string}
 */
export function summarizeScreenText(raw, options = {}) {
  const maxLines = Number.isFinite(options.maxLines) ? Math.max(1, options.maxLines) : MAX_LINES
  const maxChars = Number.isFinite(options.maxChars) ? Math.max(20, options.maxChars) : MAX_CHARS
  const lines = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/\r?\n/)
      : []

  const seen = new Set()
  const kept = []
  for (const item of lines) {
    if (typeof item !== 'string') continue
    const line = redactSensitiveText(cleanLine(item))
    if (!isMeaningful(line)) continue
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(line)
    if (kept.length >= maxLines) break
  }

  const joined = kept.join(' / ')
  if (joined.length <= maxChars) return joined
  // 按 Unicode 码点截断而不是 UTF-16 单元：emoji 这类代理对字符占两个单元，
  // 直接 slice 会在字符中间劈开，截出一个乱码尾巴。
  return `${Array.from(joined).slice(0, maxChars).join('').trimEnd()}…`
}

/**
 * 缩略图目标宽度：将来主进程接入 thumbnailSize 时用这个默认值，
 * 替换现在硬编码在识屏截图里的 1280x800。
 */
export const DEFAULT_THUMBNAIL_TARGET = 1280

/**
 * 主进程用：算出一块屏幕的缩略尺寸，太小认不出字，太大白烧 CPU。
 *
 * 注意：主进程目前没有接入这个函数（识屏截图直接硬编码 1280x800），
 * 这里是死代码，保留作为将来的尺寸约定。
 */
export function thumbnailSize(width, height, target = DEFAULT_THUMBNAIL_TARGET) {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: target, height: Math.round((target * 9) / 16) }
  }
  if (w <= target) return { width: Math.round(w), height: Math.round(h) }
  const scale = target / w
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

/**
 * Windows 自带 OCR 的 PowerShell 脚本。
 *
 * 单独写成 .ps1 再 -File 调用，避免把中文路径和引号塞进 -Command。
 * 输出一个 JSON 对象 { lines: string[] }，路径由调用方给。
 */
export const OCR_SCRIPT = `param(
  [Parameter(Mandatory = $true)][string]$ImagePath,
  [Parameter(Mandatory = $true)][string]$OutPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

# WinRT 的类型不会自动可见，先把用到的几个显式载入。
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and
  $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
})[0]

function Await($operation, $resultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
  '{"lines":[],"reason":"no-ocr-engine"}' | Set-Content -LiteralPath $OutPath -Encoding UTF8
  exit 2
}

$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$lines = @()
foreach ($line in $result.Lines) { $lines += $line.Text }

@{ lines = @($lines) } | ConvertTo-Json -Compress -Depth 3 | Set-Content -LiteralPath $OutPath -Encoding UTF8
`
