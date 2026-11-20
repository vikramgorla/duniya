// 092: the language people write in, for their preferences and the agent's reply language — non-Latin scripts by their
// Unicode script (Telugu, Hindi, Tamil, Kannada, Malayalam, Bengali, Gujarati, Punjabi, Urdu, Arabic, Russian,
// Ukrainian, Greek, Hebrew, Thai, Chinese, Japanese, Korean), romanized Telugu and Hindi by a word list; a few messages
// before a language is learned or changed; mixed Telugu + English follows the person's majority; the owner's choice stays.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

let t; let owner; let upkeepTick;
const G = 'g9@g.us';
const jid = (p) => `${p}@s.whatsapp.net`;
let n = 0;
const phone = () => `4179100${String(++n).padStart(4, '0')}`;
before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '10000' } }); owner = await t.login();
  ({ upkeepTick } = await import('../src/core/upkeep.js'));
  await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Sita', triggers: ['sita'], groupReplies: 'wake' } });
  await t.api(owner, 'POST', '/api/chats/bind', { chat: G, agent: 'sita' });
});
after(() => t.close());

const write = async (p, texts) => { for (const text of texts) await t.route(t.msg({ chat: G, text, phone: p, senderJid: jid(p), senderName: `P${p.slice(-3)}`, isGroup: true })); };
const learn = async () => { for (let i = 0; i < 4; i++) await upkeepTick(t.channel, Date.now()); };
const prefs = async (p) => (await t.api(owner, 'GET', `/api/people/${p}/prefs`)).body;
/** A person writes these messages; what language Duniya learned. */
const langOf = async (texts, p = phone()) => { await write(p, texts); await learn(); return (await prefs(p)).language; };

const SAMPLES = {
  te: ['నమస్కారం అందరికీ, రేపు సాయంత్రం కలుద్దాం', 'నేను ఐదు గంటలకు వస్తాను', 'సరే, అలాగే చేద్దాం'],
  hi: ['नमस्ते सबको, कल शाम को मिलते हैं', 'मैं पाँच बजे तक पहुँच जाऊँगा', 'ठीक है, ऐसा ही करते हैं'],
  ta: ['வணக்கம் எல்லோருக்கும், நாளை மாலை சந்திப்போம்', 'நான் ஐந்து மணிக்கு வருவேன்', 'சரி, அப்படியே செய்வோம்'],
  kn: ['ನಮಸ್ಕಾರ ಎಲ್ಲರಿಗೂ, ನಾಳೆ ಸಂಜೆ ಭೇಟಿಯಾಗೋಣ', 'ನಾನು ಐದು ಗಂಟೆಗೆ ಬರುತ್ತೇನೆ', 'ಸರಿ, ಹಾಗೆಯೇ ಮಾಡೋಣ'],
  ml: ['എല്ലാവർക്കും നമസ്കാരം, നാളെ വൈകുന്നേരം കാണാം', 'ഞാൻ അഞ്ച് മണിക്ക് വരാം', 'ശരി, അങ്ങനെ ചെയ്യാം'],
  bn: ['সবাইকে নমস্কার, কাল সন্ধ্যায় দেখা হবে', 'আমি পাঁচটার মধ্যে পৌঁছে যাব', 'ঠিক আছে, তাই করি'],
  gu: ['બધાને નમસ્તે, કાલે સાંજે મળીએ', 'હું પાંચ વાગ્યે આવીશ', 'સારું, એમ જ કરીએ'],
  pa: ['ਸਭ ਨੂੰ ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਕੱਲ੍ਹ ਸ਼ਾਮ ਨੂੰ ਮਿਲਦੇ ਹਾਂ', 'ਮੈਂ ਪੰਜ ਵਜੇ ਆਵਾਂਗਾ', 'ਠੀਕ ਹੈ, ਇਵੇਂ ਹੀ ਕਰਦੇ ਹਾਂ'],
  ur: ['سب کو سلام، کل شام کو ملتے ہیں', 'میں پانچ بجے تک پہنچ جاؤں گا', 'ٹھیک ہے، ایسا ہی کرتے ہیں'],
  ar: ['مرحبا بالجميع، نلتقي غدا مساء', 'سأصل في الساعة الخامسة', 'حسنا، لنفعل ذلك'],
  ru: ['Всем привет, увидимся завтра вечером', 'Я приеду к пяти часам', 'Хорошо, так и сделаем'],
  uk: ['Всім привіт, побачимося завтра ввечері', 'Я приїду о пʼятій', 'Добре, так і зробимо'],
  el: ['Γεια σας σε όλους, τα λέμε αύριο το βράδυ', 'Θα έρθω στις πέντε', 'Εντάξει, έτσι θα κάνουμε'],
  he: ['שלום לכולם, נתראה מחר בערב', 'אני אגיע בחמש', 'בסדר, ככה נעשה'],
  th: ['สวัสดีทุกคน พรุ่งนี้เย็นเจอกันนะ', 'ฉันจะไปถึงตอนห้าโมง', 'โอเค ทำแบบนั้นเลย'],
  zh: ['大家好，明天晚上见', '我五点到', '好的，就这么办'],
  ja: ['みなさん、こんにちは。明日の夜に会いましょう', '五時に着きます', 'わかりました、そうしましょう'],
  ko: ['안녕하세요 여러분, 내일 저녁에 만나요', '다섯 시에 도착할게요', '좋아요, 그렇게 해요'],
};

test('non-Latin scripts: each language from three real-looking messages (Unicode script, no dependency)', async () => {
  const got = {};
  for (const [lang, texts] of Object.entries(SAMPLES)) got[lang] = await langOf(texts);
  assert.deepEqual(got, Object.fromEntries(Object.keys(SAMPLES).map((k) => [k, k])));
});

test('romanized Telugu and Hindi by a word list; the agent is told to answer the same way', async () => {
  const te = phone();
  assert.equal(await langOf(['Sare Vikram garu', 'ela unnaru andaru?', 'nenu repu vastanu, meeru kuda randi'], te), 'te-Latn');
  assert.equal(await langOf(['kya haal hai bhai', 'main abhi aa raha hoon', 'theek hai, kal milte hain']), 'hi-Latn');
  assert.equal((await prefs(te)).languageName, 'Telugu in Latin letters');
  t.script.push([{ type: 'text', text: 'Sare garu!' }]);
  await write(te, ['sita sare, ippudu cheppandi']);
  assert.match(t.userTurn(t.claudeReqs.length - 1), /Writes Telugu in Latin letters: answer in Telugu written in Latin letters/);
});

test('a few messages first: two are not enough; one message in another language does not change a learned one', async () => {
  assert.equal(await langOf(SAMPLES.te.slice(0, 2)), '', 'two messages: not learned yet');
  const p = phone();
  assert.equal(await langOf(SAMPLES.te, p), 'te');
  assert.equal(await langOf(['Where are we meeting tomorrow and what time is it?'], p), 'te', 'one English message changes nothing');
  assert.equal(await langOf(['ok', '👍', 'haha'], p), 'te', 'messages that say nothing keep it');
  await write(p, ['I will be there in the evening with the kids', 'Can you send me the address of the hall?', 'What time is the lunch on Sunday?', 'We are on the way, see you in ten minutes', 'Thanks for the photos, they are lovely']);
  await learn();
  assert.equal((await prefs(p)).language, 'en', 'a clear majority of their recent messages changes it');
});

test('mixed Telugu + English messages follow the person\'s majority', async () => {
  const MIXED = ['Meeting ki I will come by six, రేపు కలుద్దాం', 'Please send the address, నేను వస్తాను', 'Okay, I will bring the food and drinks, సరే'];
  const en = phone();
  await write(en, ['Where is the meeting tomorrow?', 'I will bring the chairs for the hall', 'Is the lunch on Sunday at the temple?', 'Thanks, see you all there']);
  assert.equal(await langOf(MIXED, en), 'en', 'mostly English: English');
  const te = phone();
  await write(te, SAMPLES.te);
  assert.equal(await langOf(MIXED, te), 'te', 'mostly Telugu: Telugu');
  assert.equal(await langOf(MIXED), 'te', 'only mixed: the script decides');
});

test('a language the owner set is never overwritten; Automatic gives the learned one back; the panel gets the list', async () => {
  const p = phone();
  await write(p, SAMPLES.ta);
  const pid = (await t.api(owner, 'GET', `/api/people/${p}`)).body.id;
  let r = (await t.api(owner, 'PUT', `/api/people/${pid}/prefs`, { language: 'kn' })).body;
  assert.deepEqual([r.language, r.auto.language], ['kn', false]);
  assert.equal(r.languages.te, 'Telugu');
  assert.equal(await langOf([...SAMPLES.ta, ...SAMPLES.ta], p), 'kn');
  r = (await t.api(owner, 'PUT', `/api/people/${pid}/prefs`, { language: 'auto' })).body;
  assert.equal(r.language, 'ta');
  assert.equal((await t.api(owner, 'PUT', `/api/people/${pid}/prefs`, { language: 'te-Latn' })).body.language, 'te-Latn');
});
