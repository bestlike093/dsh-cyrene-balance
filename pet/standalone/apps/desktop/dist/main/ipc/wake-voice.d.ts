export interface WakeManifestFile {
    path: string;
    url: string;
    sha256: string;
}
export interface WakeManifest {
    version: string;
    totalBytes?: number;
    files: WakeManifestFile[];
}
export interface WakeVoiceState {
    enabled: boolean;
    installedVersion: string | null;
}
export interface WakeVoiceDeps {
    registerChannel: (channel: string, listener: (...args: any[]) => unknown) => void;
    userData: string;
    /** 清单地址只从主进程配置来，渲染侧给不了，避免把下载指到任意位置。 */
    manifestUrl: string | null;
    fetchJson: (url: string) => Promise<unknown>;
    downloadBytes: (url: string) => Promise<Uint8Array>;
    sha256: (bytes: Uint8Array) => string;
    fs: {
        readFile: (path: string, encoding: 'utf8') => Promise<string>;
        writeFile: (path: string, data: string | Uint8Array) => Promise<void>;
        mkdir: (path: string, options: {
            recursive: true;
        }) => Promise<unknown>;
        rm: (path: string, options: {
            recursive: true;
            force: true;
        }) => Promise<void>;
        rename: (from: string, to: string) => Promise<void>;
        stat: (path: string) => Promise<{
            size: number;
            isDirectory: () => boolean;
        }>;
        readdir: (path: string) => Promise<string[]>;
    };
    pathJoin: (...parts: string[]) => string;
    log: (...args: unknown[]) => void;
    describeError: (error: unknown) => string;
}
export declare const WAKE_STATE_FILE = "wake-voice.json";
export declare const WAKE_ENGINE_DIR = "wake-engine";
/** 兜底上限：清单写错或被人换掉时不至于把磁盘写满。 */
export declare const WAKE_MAX_BYTES: number;
/**
 * 清单来自网络，逐项校验后才允许写盘。
 * 任何一项不合格都整单拒绝：宁可装不上，不可装进一个来路不明的文件。
 */
export declare function validateManifest(raw: unknown): WakeManifest;
export declare function registerWakeVoiceChannels(deps: WakeVoiceDeps): {
    isEnabled: () => boolean;
    /** 启动时读一次状态；否则麦克风权限在用户打开设置前会一直按「关闭」处理。 */
    init: () => Promise<void>;
};
