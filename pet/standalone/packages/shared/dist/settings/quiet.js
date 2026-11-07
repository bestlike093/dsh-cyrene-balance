/** 把 HH:MM 换成当天分钟数；格式不对返回 null。 */
function toMinutes(value) {
    const matched = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
    if (matched === null)
        return null;
    return Number(matched[1]) * 60 + Number(matched[2]);
}
/**
 * 此刻是否处于免打扰。
 *
 * 起止相同按「没设区间」处理，返回 false。把一样的时间当成全天安静，
 * 只会在手滑时把声音彻底关掉，不如当它不生效。
 */
export function isQuietNow(quiet, now = new Date()) {
    if (!quiet.enabled)
        return false;
    const start = toMinutes(quiet.start);
    const end = toMinutes(quiet.end);
    if (start === null || end === null)
        return false;
    if (start === end)
        return false;
    const minutes = now.getHours() * 60 + now.getMinutes();
    // start > end 说明跨了零点，区间被拆成「今天到午夜」和「午夜到 end」两段。
    return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
/** 夜间不扰的宽松时间解析：允许单数字小时（9:05），与陪伴页原实现一致。 */
function toPresenceMinutes(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? ''));
    if (match === null)
        return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59)
        return null;
    return hour * 60 + minute;
}
/**
 * 此刻处于夜间不扰的哪种处理方式。
 *
 * from > to 视为跨零点；起止相同或格式不合法当没开启——
 * 一条坏配置不该把主动说话永久关掉。
 */
export function presenceQuietModeAt(now, quiet) {
    if (quiet?.enabled !== true)
        return 'off';
    const start = toPresenceMinutes(quiet.from);
    const end = toPresenceMinutes(quiet.to);
    if (start === null || end === null || start === end)
        return 'off';
    const minutes = now.getHours() * 60 + now.getMinutes();
    const inside = start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
    if (!inside)
        return 'off';
    const mode = quiet.mode;
    return mode === 'silent' || mode === 'reduce' ? mode : 'urgentOnly';
}
/** 此刻是否落在夜间不扰时段内（不分处理方式）。 */
export function isPresenceQuietNow(now, quiet) {
    return presenceQuietModeAt(now, quiet) !== 'off';
}
/**
 * 这一次该不该出声。
 *
 * manual（点了小喇叭）只受总开关和免打扰约束；
 * auto 还要看触发时机：every / proactive 都念，manual 模式下不自动念。
 */
export function shouldSpeakNow(voice, reason, now = new Date()) {
    if (!voice.enabled)
        return false;
    if (isQuietNow(voice.quietHours, now))
        return false;
    if (reason === 'manual')
        return true;
    return voice.trigger !== 'manual';
}
