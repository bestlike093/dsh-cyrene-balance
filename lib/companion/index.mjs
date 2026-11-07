/**
 * companion-core：四个发行物共用的陪伴层。
 *
 * 这里只放纯函数与可注入依赖的状态机，不碰 Electron、不读全局路径。
 * 文件路径、时钟、随机数都由调用方注入，DSH 插件、独立壳、Cyrene 适配层
 * 才能共用同一套人格与节奏。
 */

export { buildPersonaPrompt, personaSectionDefaults } from './persona.mjs'
export {
  INTIMACY_EDITION,
  IS_PUBLIC_EDITION,
  INTIMACY_EDITION_LABEL
} from './edition.mjs'
export { humanDay, humanTime } from './human-time.mjs'
export {
  tokenize,
  cosineSimilarity,
  rankMemories,
  DEFAULT_SEARCH
} from './memory-search.mjs'
export {
  classifyMemoryIntent,
  memoryRecallPlan,
  planMemoryRecall,
  describeRecallPlan,
  MEMORY_INTENTS
} from './memory-intent.mjs'
export {
  createMemoryGuard,
  MEMORY_WARN_BYTES,
  MEMORY_CRITICAL_BYTES
} from './memory-guard.mjs'
export {
  normalizeConfig as normalizeEmbeddingConfig,
  fingerprint as embeddingFingerprint,
  similarity as embeddingSimilarity,
  createEmbeddingService,
  DEFAULT_EMBEDDING
} from './embedding.mjs'
export { createFactStore } from './memory-facts.mjs'
export { redactLogText } from './log-redact.mjs'
export { splitReply, burstDelay } from './reply-split.mjs'
export {
  createPresenceGate,
  inQuietHours,
  quietWindow,
  parseClock,
  DEFAULT_QUIET,
  DEFAULT_DAILY_CAP,
  DEFAULT_SILENCE_DAYS
} from './presence-gate.mjs'
export { guardReply } from './reply-guard.mjs'
export { extractMemoryCandidates } from './memory-extract.mjs'
export {
  scheduleAgenda,
  sessionAnchor,
  DEFAULT_SCHEDULE,
  SCHEDULE_VERSION
} from './schedule.mjs'
export {
  createCompanionStore,
  defaultSnapshot,
  normalizeSnapshot,
  applyEvent,
  STORE_VERSION,
  MAX_AFFECTION,
  MAX_CLOSENESS
} from './companion-store.mjs'
export {
  BACKUP_FORMAT,
  ENVELOPE_FORMAT,
  BACKUP_VERSION,
  MIN_PASSPHRASE_LENGTH,
  DEFAULT_KDF_ITERATIONS,
  createBackupBundle,
  createPlainBackup,
  parsePlainBackup,
  encryptBackup,
  decryptBackup,
  inspectBackup
} from './backup-vault.mjs'
export {
  createMemoryStore,
  defaultMemory,
  normalizeMemory,
  recallFrom,
  pruneMemory,
  weightOf,
  scoreOf,
  SLOTS,
  SOURCES,
  MEMORY_VERSION,
  MAX_ITEMS,
  HALF_LIFE_DAYS
} from './memory-store.mjs'
export {
  applyBondEvent,
  bondLevel,
  bondMood,
  bondSummary,
  decayBond,
  defaultBond,
  explainToday,
  normalizeBond,
  setAffinity,
  adjustAffinity,
  setAffinityLocked,
  BOND_DIMENSIONS,
  BOND_LEVELS,
  BOND_VERSION,
  DEFAULT_BOND_RULES
} from './bond.mjs'
export {
  DEFAULT_TIMING_LIMITS,
  emptyRhythm,
  normalizeRhythm,
  recordActivity,
  assessTiming,
  describeTiming,
  HOUR_MS,
  RHYTHM_SAMPLE_CAP
} from './timing.mjs'
export { describeAnniversaries } from './anniversary.mjs'
export {
  extractCandidates as extractSpeechCandidates,
  tailParticle,
  observeText,
  pickPhrases,
  buildHabitNote,
  createSpeechHabitStore
} from './speech-habits.mjs'
export { createMemeDictionary } from './meme-dictionary.mjs'
export {
  pickCue,
  recordOpening,
  markResponse,
  shouldGiveUp,
  openingsToday,
  usedKeyRecently,
  ledgerSummary,
  defaultLedger,
  normalizeLedger,
  CUE_KINDS,
  DEFAULT_OPENING,
  OPENING_VERSION
} from './opening.mjs'
export * from './stop-words.mjs'
export * from './social.mjs'
export * from './remote-decision.mjs'
export * from './qq-official.mjs'
export * from './qq-bridge.mjs'
export * from './qq-webhook.mjs'
export * from './intimacy.mjs'
export * from './proactive.mjs'
export * from './thoughts.mjs'
export * from './inner-state.mjs'
export * from './body-state.mjs'
export * from './body-service.mjs'
export * from './environment-note.mjs'
export * from './system-stats.mjs'
export * from './daily-review.mjs'
export * from './reflection.mjs'
export * from './agenda.mjs'
export * from './agenda-runtime.mjs'
export * from './daily-plan.mjs'
export * from './insight.mjs'
export * from './emotion-afterglow.mjs'
export * from './emotion-expression.mjs'
export * from './emotion-needs.mjs'
export * from './emotion-runtime.mjs'
export * from './lifestyle.mjs'
export * from './weather-alert.mjs'
export * from './emoji-tag.mjs'
export * from './presence.mjs'
export * from './quiet-hours.mjs'
export * from './assets.mjs'
export * from './emoji-catalog.mjs'
export * from './packs.mjs'
export * from './photo-studio.mjs'
export * from './sticker-library.mjs'
export * from './sticker-inbox.mjs'
export * from './voice-service.mjs'
export * from './models.mjs'
