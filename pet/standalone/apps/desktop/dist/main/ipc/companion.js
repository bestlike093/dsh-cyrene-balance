/** 手动顺延的上限：超过四小时就不像「被打断」，更像想改整个作息了。 */
const MAX_DELAY_MINUTES = 240;
export function registerCompanionAgendaChannels(deps) {
    const register = deps.registerChannel;
    /** 现在和接下来各是什么；还没生成今天的单时 note 为空串。 */
    register('pet:companion:agenda', async () => {
        try {
            const note = await deps.companionService.agendaNote();
            return {
                ok: true,
                enabled: deps.companionService.enabled() !== false,
                note: typeof note === 'string' ? note : ''
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log?.('[companion] 读取日程失败：', message);
            return { ok: false, code: 'READ_FAILED', message };
        }
    });
    /**
     * 手动把剩下的安排往后推。
     *
     * 真正改不改由 core 决定：睡觉不动、后面压不出时间也不动，
     * 返回的 reason 交给界面翻译成一句人话。
     */
    register('pet:companion:agenda:reschedule', async (_event, payload) => {
        const minutes = Math.round(Number(payload?.minutes));
        if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_DELAY_MINUTES) {
            return { ok: false, code: 'INVALID_MINUTES' };
        }
        try {
            const result = await deps.companionService.interruptAgenda(minutes);
            let note = '';
            try {
                note = await deps.companionService.agendaNote();
            }
            catch {
                note = '';
            }
            return {
                ok: true,
                changed: result?.changed === true,
                reason: typeof result?.reason === 'string' ? result.reason : null,
                note: typeof note === 'string' ? note : ''
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log?.('[companion] 重排日程失败：', message);
            return { ok: false, code: 'RESCHEDULE_FAILED', message };
        }
    });
}
