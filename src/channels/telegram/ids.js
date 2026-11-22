// @ts-check
// Telegram ids (077): "tg:<bot id>#<chat id>". Telegram chat ids are numbers: a person's private chat is their user id
// (positive), groups and supergroups are negative. No phone numbers: a person's phone is known only after they share
// their own contact with the bot (people.js).
export const PREFIX = 'tg';
const RE = /^tg:(\d+)#(-?\d+)$/;
/** The bot (`account`) and Telegram's chat id (`native`) of an app chat id; null when it is not a Telegram chat. */
export const chatParts = (chat) => { const m = RE.exec(String(chat || '')); return m ? { account: m[1], native: m[2] } : null; };
export const isTelegramChat = (chat) => !!chatParts(chat);
export const isGroupChat = (chat) => Number(chatParts(chat)?.native) < 0;
export const isDirectChat = (chat) => Number(chatParts(chat)?.native) > 0;
/** The sender id of a direct chat (the user id), '' for groups. */
export const personOfChat = (chat) => (isDirectChat(chat) ? chatParts(chat).native : '');
