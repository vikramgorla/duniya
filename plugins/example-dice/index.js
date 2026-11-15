// Example plugin: attach it to an agent under Agents → Plugins ("example-dice").
// Plugins are optional code add-ons: tools the model can call, commands, or custom roles.

export default {
  /** Called once when the agent is loaded. */
  async init({ agent }) {},

  /**
   * Local tools the model can call, alongside MCP tools. Exposed as "local__<name>".
   * `roles` limits who gets the tool (default: everyone).
   */
  tools: [
    {
      name: 'roll_dice',
      description: 'Roll an N-sided die.',
      input_schema: { type: 'object', properties: { sides: { type: 'integer', minimum: 2, maximum: 100 } } },
      roles: ['organizer', 'participant'],
      async run({ sides = 6 }, ctx) {
        return { result: 1 + Math.floor(Math.random() * sides), askedBy: ctx.senderName };
      },
    },
  ],

  /** Override the role of a sender ('organizer' | 'participant'), or return undefined for the default. */
  async role(msg, agent) {},

  /**
   * Sees every message routed to this agent (even ones that don't trigger it).
   * Return a string to reply without calling Claude, or undefined to continue normally.
   */
  async onMessage({ msg, agent, role, triggered, channel }) {
    if (triggered && msg.text.trim().toLowerCase() === '!ping') return 'pong';
  },
};
