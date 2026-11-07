import type { QuietHours, VoiceSettings } from '../types/settings.js';
/**
 * 此刻是否处于免打扰。
 *
 * 起止相同按「没设区间」处理，返回 false。把一样的时间当成全天安静，
 * 只会在手滑时把声音彻底关掉，不如当它不生效。
 */
export declare function isQuietNow(quiet: QuietHours, now?: Date): boolean;
/** 夜间不扰（陪伴页）的处理方式；与语音页的 QuietHours 是两套独立设置。 */
export type PresenceQuietMode = 'off' | 'silent' | 'reduce' | 'urgentOnly';
/** 夜间不扰的配置形状；只取判定需要的字段，主进程与渲染层都能直接用。 */
export interface PresenceQuietHours {
    enabled?: boolean;
    from?: unknown;
    to?: unknown;
    mode?: unknown;
}
/**
 * 此刻处于夜间不扰的哪种处理方式。
 *
 * from > to 视为跨零点；起止相同或格式不合法当没开启——
 * 一条坏配置不该把主动说话永久关掉。
 */
export declare function presenceQuietModeAt(now: Date, quiet: PresenceQuietHours | null | undefined): PresenceQuietMode;
/** 此刻是否落在夜间不扰时段内（不分处理方式）。 */
export declare function isPresenceQuietNow(now: Date, quiet: PresenceQuietHours | null | undefined): boolean;
export type SpeakReason = 'auto' | 'manual';
/**
 * 这一次该不该出声。
 *
 * manual（点了小喇叭）只受总开关和免打扰约束；
 * auto 还要看触发时机：every / proactive 都念，manual 模式下不自动念。
 */
export declare function shouldSpeakNow(voice: VoiceSettings, reason: SpeakReason, now?: Date): boolean;
