# Contract: Bot Definition

A bot is a folder `bots/<id>/` (id = folder name; folders starting with `_` or `.` are ignored).

## `bot.json`

See [data-model.md](../data-model.md#bot-repo-botsidbotjson--live-overrides-data_dirbotsidjson) for fields.
Secrets are referenced as `${NAME}` and resolved at call time from panel secrets, then environment.

Tool rule globs use `*` and `?` and match fully qualified names:

- MCP tools: `<serverKey>:<toolName>` (exposed to the model as `<serverKey>__<toolName>`)
- Local tools: `local:<name>` (exposed as `local__<name>`)
- Memory tools: `memory:<name>` (exposed as `memory__<name>`, feature 004)

Effective tools for role R = (allow[R] matches) − (deny matches) − {confirm.tool}.

## `prompt.md`

The bot's system instructions (plain text/markdown). The platform appends time, chat type, role rules,
WhatsApp formatting rules, memory context (004) and `extraPrompt`.

## `index.js` (optional, ES module, default export)

```js
export default {
  async init({ bot }) {},
  tools: [{ name, description, input_schema, roles?: ['organizer','participant'],
            async run(input, ctx) { return string | object } }],
  async role(msg, bot) { return 'organizer' | 'participant' | undefined },
  async onMessage({ msg, bot, role, triggered, channel }) { return string | undefined },
};
```

- `ctx` = `{ bot, role, chat, senderName, requester, text, isGroup, source }`.
- `onMessage` sees every routed message; returning a string replies without calling the model.
- Errors thrown by a local tool are returned to the model as tool errors and logged.
