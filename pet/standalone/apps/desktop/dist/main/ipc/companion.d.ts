type AnyRecord = Record<string, any>;
/**
 * 陪伴日程通道：只读今天这份节目单，以及「聊久了把后面顺延」这一个动作。
 *
 * 节目单的生成与节奏判断都在陪伴层和 core 里；这里只做参数收口与结果整形，
 * 不把整份计划暴露给渲染层。
 */
export interface CompanionAgendaDeps {
    registerChannel: (channel: string, listener: (...args: any[]) => unknown) => void;
    companionService: {
        enabled: () => boolean;
        agendaNote: () => Promise<string>;
        interruptAgenda: (minutes: number) => Promise<AnyRecord>;
    };
    log?: (...args: any[]) => void;
}
export declare function registerCompanionAgendaChannels(deps: CompanionAgendaDeps): void;
export {};
