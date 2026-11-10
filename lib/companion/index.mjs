/**
 * companion-core：四个发行物共用的陪伴层。
 *
 * 这里只放纯函数与可注入依赖的状态机，不碰 Electron、不读全局路径。
 * 文件路径、时钟、随机数都由调用方注入，DSH 插件、独立壳、Cyrene 适配层
 * 才能共用同一套人格与节奏。
 *
 * 目录按「一轮对话从发生到沉淀」的顺序分域：
 * persona / sense / memory / state / time / speak / voice-out / deliver / assets / system
 */
/* persona */
export * from './persona/persona.mjs'
export * from './persona/traits.mjs'
export * from './persona/persona-time.mjs'
export * from './persona/persona-assessment.mjs'
export * from './persona/persona-rehearsal.mjs'
export * from './persona/speech-habits.mjs'
export * from './persona/companion-note.mjs'

/* sense */
export * from './sense/presence.mjs'
export * from './sense/environment-note.mjs'
export * from './sense/system-stats.mjs'
export * from './sense/weather-alert.mjs'
export * from './sense/lifestyle.mjs'
export * from './sense/city-coords.mjs'
export * from './sense/screen-reader.mjs'
export * from './sense/dsh-envelope.mjs'

/* memory */
export * from './memory/memory-store.mjs'
export * from './memory/memory-facts.mjs'
export * from './memory/memory-extract.mjs'
export * from './memory/memory-search.mjs'
export * from './memory/memory-intent.mjs'
export * from './memory/memory-lines.mjs'
export * from './memory/anniversary.mjs'
export * from './memory/human-time.mjs'
export * from './memory/stop-words.mjs'
export * from './memory/embedding.mjs'
export * from './memory/history-import.mjs'
export * from './memory/memory-facts.mjs'

/* state */
export * from './state/bond.mjs'
export * from './state/body-state.mjs'
export * from './state/body-service.mjs'
export * from './state/snapshot.mjs'
export * from './state/relationship-stage.mjs'
export * from './state/intimacy.mjs'
export * from './state/emotion-runtime.mjs'
export * from './state/emotion-afterglow.mjs'
export * from './state/emotion-expression.mjs'
export * from './state/emotion-needs.mjs'
export * from './state/inner-state.mjs'
export * from './state/sealed-store.mjs'
export * from './state/companion-store.mjs'

/* time */
export * from './time/schedule.mjs'
export * from './time/agenda.mjs'
export * from './time/agenda-runtime.mjs'
export * from './time/daily-plan.mjs'
export * from './time/daily-review.mjs'
export * from './time/reflection.mjs'

/* speak */
export * from './speak/proactive.mjs'
export * from './speak/opening.mjs'
export * from './speak/timing.mjs'
export * from './speak/presence-gate.mjs'
export * from './speak/thoughts.mjs'
export * from './speak/quiet-hours.mjs'
export * from './speak/daily-budget.mjs'
export * from './speak/daily-budget-gate.mjs'
export * from './speak/token-bucket.mjs'

/* voice-out */
export * from './voice-out/chat.mjs'
export * from './voice-out/request-guard.mjs'
export * from './voice-out/fallback-chain.mjs'
export * from './voice-out/local-emotion.mjs'
export * from './voice-out/reply-guard.mjs'
export * from './voice-out/reply-split.mjs'
export * from './voice-out/bubble-tone.mjs'
export * from './voice-out/emoji-tag.mjs'
export * from './voice-out/motion-tag.mjs'

/* deliver */
export * from './deliver/social.mjs'
export * from './deliver/social-profile.mjs'
export * from './deliver/meme-dictionary.mjs'
export * from './deliver/group-address.mjs'
export * from './deliver/group-manners.mjs'
export * from './deliver/group-reply-gate.mjs'
export * from './deliver/handoff.mjs'
export * from './deliver/qq-bridge.mjs'
export * from './deliver/qq-official.mjs'
export * from './deliver/qq-webhook.mjs'
export * from './deliver/remote-decision.mjs'
export * from './deliver/voice-codec.mjs'
export * from './deliver/voice-service.mjs'

/* assets */
export * from './assets/assets.mjs'
export * from './assets/models.mjs'
export * from './assets/packs.mjs'
export * from './assets/emoji-catalog.mjs'
export * from './assets/emoji-search.mjs'
export * from './assets/photo-studio.mjs'
export * from './assets/sticker-fallback.mjs'
export * from './assets/sticker-inbox.mjs'
export * from './assets/sticker-library.mjs'
export * from './assets/sticker-pickup.mjs'
export * from './assets/sticker-usage.mjs'
export * from './assets/sticker-vision.mjs'
export * from './assets/live2d-catalog.mjs'
export * from './assets/live2d-command.mjs'

/* system */
export * from './system/crypto-kit.mjs'
export * from './system/edition.mjs'
export * from './system/log-redact.mjs'
export * from './system/pet-error.mjs'
export * from './system/insight.mjs'
export * from './system/backup-vault.mjs'
export * from './system/sync.mjs'
export * from './system/syncCrypto.mjs'
export * from './system/sync-engine.mjs'
export * from './system/file-sync-transport.mjs'
export * from './system/memory-guard.mjs'
export * from './system/panel-view.mjs'
