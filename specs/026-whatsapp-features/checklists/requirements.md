# Requirements checklist

- [X] Spec, plan, tasks and contracts consistent with the code
- [X] Constitution III: tools filtered per role in code; organizer-only tools refused even if the model calls them
- [X] Constitution IV: no MCP preview/confirm involved. The owner chose immediate WhatsApp actions for organizers
      (issue #2); admin MCP reset_group_invite_link still needs confirm_action
- [X] Constitution V: every action logged (`whatsapp.action`), reactions and votes logged
- [X] Constitution VII: tests with fakes (harness channel, fake Baileys socket, local HTTP server for media)
- [X] Security: SSRF guard, size limit, type check, no media downloads of incoming messages, phone numbers hidden from participants
- [X] DESIGN.md checklist: plain-language text, one state, destructive "Reset link" asks for confirmation, 375 px
      light and dark checked (screenshots), no periodic refresh involved
