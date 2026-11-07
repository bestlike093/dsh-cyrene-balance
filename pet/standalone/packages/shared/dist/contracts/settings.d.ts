/**
 * 配置 schema v2.1 契约（文档第 13 章）。
 * 与现有扁平 SettingsV2 并存：v2.1 是目标形状，迁移函数负责过渡。
 */
import type { CryptoSuiteId } from './crypto.js';
import type { TokenBudget } from './memory.js';
import type { EmotionTag, ProfileName } from '../types/model.js';
import type { Permission, RenderMode } from '../types/module.js';
import type { SettingsV2 } from '../types/settings.js';
export interface UiSettingsV21 {
    readonly profile: ProfileName;
    readonly theme: string;
    readonly scale: number;
    readonly fpsCap: number;
}
export interface ModuleSettingsV21 {
    readonly enabled: boolean;
    readonly renderMode: RenderMode;
    readonly permissions?: readonly Permission[];
    readonly config?: Readonly<Record<string, unknown>>;
    readonly timeoutMs?: number;
    readonly timeoutPolicy?: 'fallback-local' | 'block';
}
export interface EmotionSettingsV21 {
    readonly vocab: readonly EmotionTag[];
    readonly similarityThreshold: number;
    readonly pairOnly: boolean;
}
export interface ChannelCredentialsV21 {
    readonly enabled: boolean;
    /** 形如 vault:qq-token；settings.json 里永远不出现凭据值 */
    readonly credentialRef?: string;
}
export interface QqChannelSettings extends ChannelCredentialsV21 {
    readonly appId: string;
}
export interface WechatChannelSettings extends ChannelCredentialsV21 {
    readonly mode: 'ilink';
}
export interface WebhookChannelSettings extends ChannelCredentialsV21 {
    readonly url: string;
}
export interface ChannelsSettingsV21 {
    readonly qq: QqChannelSettings;
    readonly wechat: WechatChannelSettings;
    readonly webhook: WebhookChannelSettings;
}
export interface VaultKdfSettingsV21 {
    readonly algo: 'argon2id';
    readonly m: number;
    readonly t: number;
    readonly p: number;
}
export interface VaultSettingsV21 {
    readonly backend: 'system-keychain' | 'passphrase' | 'plaintext-dir';
    readonly suite: CryptoSuiteId;
    readonly pqEnabled: boolean;
    readonly kdf: VaultKdfSettingsV21;
    readonly rotationDays: number;
    readonly decryptWindowDays: number;
    readonly auditChain: boolean;
    readonly redactTelemetry: boolean;
    readonly isolatedProcess: boolean;
}
export interface InteropSettingsV21 {
    readonly enabled: boolean;
    readonly probeIntervalMin: number;
    readonly maxClockDriftMs: number;
    readonly consistencyPolicy: 'warn' | 'block';
    readonly trustedPeersPath: string;
    readonly lanFallback: boolean;
}
export interface MemorySettingsV21 {
    readonly syncEnabled: boolean;
    readonly summaryEveryTurns: number;
    readonly summaryMaxAgeMin: number;
    readonly tokenBudget: TokenBudget;
    readonly salienceHalfLifeDays: number;
    readonly salienceFloor: number;
    readonly tombstoneInsteadOfDelete: boolean;
}
export interface SettingsV21 {
    readonly schemaVersion: 2;
    readonly ui: UiSettingsV21;
    readonly modules: Readonly<Record<string, ModuleSettingsV21>>;
    readonly emotion: EmotionSettingsV21;
    readonly channels: ChannelsSettingsV21;
    readonly vault: VaultSettingsV21;
    readonly interop: InteropSettingsV21;
    readonly memory: MemorySettingsV21;
    /** 迁移时未识别的旧字段，留作回滚，不在设置页展示 */
    readonly _legacy?: Readonly<Record<string, unknown>>;
}
export declare const DEFAULT_SETTINGS_V21: SettingsV21;
/**
 * v1/v2 扁平配置 → v2.1 嵌套配置。
 * 未知字段进 _legacy；card profile 强制 scale=1（文档 13.1）。
 */
export declare function settingsV2ToV21(legacy: SettingsV2): SettingsV21;
