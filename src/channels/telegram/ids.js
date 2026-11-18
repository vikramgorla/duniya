// @ts-check
// Telegram ids (077): "tg:<bot id>#<chat id>". Telegram chat ids are numbers: a person's private chat is their user id
// (positive), groups and supergroups are negative. No phone numbers: a person's phone is known only after they share
// their own contact with the bot (people.js).
export const PREFIX = 'tg';
const RE = /^tg:(\d+)#(-?\d+)$/;
const parts = (chat) => RE.exec(String(chat || ''));
export const isTelegramChat = (chat) => !!parts(chat);
export const isGroupChat = (chat) => Number(parts(chat)?.[2]) < 0;
export const isDirectChat = (chat) => Number(parts(chat)?.[2]) > 0;
/** The sender id of a direct chat (the user id), '' for groups. */
export const personOfChat = (chat) => (isDirectChat(chat) ? parts(chat)[2] : '');
