/**
 * 人格提示词拼装（转发层）。
 *
 * 唯一实现是 lib/companion/persona/persona.mjs。
 * 这里保留旧路径的导入兼容：历史上有两份同名模块，现已收敛成一份，
 * 改人格只改那一处，这里不再维护第二份文案。
 */
export {
  buildPersonaPrompt,
  buildPersonaCoreText,
  buildNowPrompt,
  personaSectionDefaults,
  PERSONA_SCOPES,
  CONFLICT_RULE_ZH,
  CONFLICT_RULE_EN,
} from './companion/persona/persona.mjs'
