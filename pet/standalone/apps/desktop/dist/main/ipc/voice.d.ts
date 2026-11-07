type AnyRecord = Record<string, any>;
export interface VoiceChannelDeps {
    registerChannel: (channel: string, listener: (...args: any[]) => unknown) => void;
    getSettings: () => AnyRecord;
    planSpeak: (input: AnyRecord) => AnyRecord;
    createLocalTtsProvider: (options: AnyRecord) => {
        synthesize: (input: AnyRecord) => Promise<AnyRecord>;
    };
    dialog: {
        showOpenDialog: (options: AnyRecord) => Promise<{
            canceled: boolean;
            filePaths: string[];
        }>;
    };
    log: (...args: any[]) => void;
}
export declare function registerVoiceChannels(deps: VoiceChannelDeps): void;
export {};
