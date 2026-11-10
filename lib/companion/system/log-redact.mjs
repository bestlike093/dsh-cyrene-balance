/**
 * 落盘日志脱敏。
 *
 * 控制台可以保留原文方便本机排查；写进 main.log 的那一份不该留下
 * 完整的 openid、被动回复令牌、API Key 或用户名。
 * 这一层只做字符串替换，不改日志结构，也不影响调用方拿到什么。
 */

const RULES = [
  // Bearer / sk- 之类直接出现的密钥。
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***'],
  [/\b(sk-[A-Za-z0-9_-]{8,})/g, 'sk-***'],
  // QQ 机器人 access token：Authorization: QQBot xxx。
  [/\b(QQBot)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 ***'],
  // key=value 形式的凭据。
  [
    /\b(appsecret|app_secret|clientsecret|client_secret|access_token|refresh_token|token|apikey|api_key|secret)\s*=\s*["']?[^"'\s,;]{4,}["']?/gi,
    '$1=***'
  ],
  // QQ 的 openid。
  [/\b(user_openid|member_openid|openid)\s*=\s*["']?[A-Za-z0-9_-]{4,}["']?/gi, '$1=***'],
  // 被动回复用的 msg_id / msg 令牌。
  [/\b(msg|msgid|msg_id)\s*=\s*["']?[A-Za-z0-9._~+/=-]{6,}["']?/gi, '$1=***'],
  // 裸的 QQ 机器人 ROBOT1.0_ 令牌（例如直接打印在错误信息里）。
  [/\bROBOT1\.0_[A-Za-z0-9._~+/=-]{8,}/g, 'ROBOT1.0_***'],
  // 裸的 32 位 hex（典型 openid）单独出现时也掩码，保留头尾便于对日志。
  [/\b[0-9a-f]{32}\b/gi, (match) => `${match.slice(0, 4)}…${match.slice(-4)}`],
  // Windows / macOS / Linux 用户目录。
  [/\b([A-Za-z]:[\\/]Users[\\/])[^\\/\s]+/gi, '$1***'],
  [/(\/(?:home|Users)\/)[^/\s]+/g, '$1***']
]

export function redactLogText(value) {
  if (typeof value !== 'string' || value === '') return value
  let text = value
  for (const [pattern, replacement] of RULES) text = text.replace(pattern, replacement)
  return text
}
