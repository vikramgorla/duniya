# Spec 051: OS updates that finish the job and explain what they leave (#96)

Bug: on Ubuntu 24.04 (Oracle, 1 GB) **Install OS updates** ran `apt upgrade`: snapd was *deferred due to phasing*,
three kernel meta-packages were *kept back*, "0 upgraded … 4 not upgraded". The panel still listed snapd as available
with no explanation.

## User stories

1. **Everything that can install, installs (P1).** *When* the owner presses **Install OS updates**, *then* the root
   helper runs `apt-get full-upgrade` (non-interactive, keep existing config files, needrestart lists only) so new
   kernels install, then `apt-get autoremove --purge` (the running kernel stays). A run cut off earlier is finished
   first (`dpkg --configure -a`). apt runs at low priority; a low-memory note is logged on small servers.
2. **Gradual roll-outs are explained (P1).** Ubuntu phased updates are respected by default. The list marks them
   *Rolling out gradually — Ubuntu installs this automatically within days*; **Include gradual updates now**
   (`os-update-all`, confirm dialog) adds `-o APT::Get::Always-Include-Phased-Updates=true`. Security updates are
   never treated as phased.
3. **Grouped list (P1).** *Will install (N)*, *Rolling out gradually (N)*, *Held back (N)* with a reason (*On hold
   (apt-mark hold)* or *needs a dependency change apt will not make automatically*). The **Server** tab badge counts
   only *will install* (and shows `!` when only a restart is pending). Detection: `apt-get -s full-upgrade` (lists
   and Inst lines; apt 2 and apt 3 layouts), `apt-cache policy` (`(phased N%)` next to the candidate: a simulation
   as the app user may ignore phasing) and `apt-mark showhold`.
4. **Clear result (P1).** After a run: one line, e.g. *Installed 3 updates · 4 new packages · 4 old packages removed ·
   1 rolling out gradually · restart needed*; the raw apt output stays under **Output**.
5. **Restart needed (P1).** When `/var/run/reboot-required` exists: *Restart needed to finish (new kernel)* with the
   packages from `reboot-required.pkgs`, since when, and **Restart server** (confirm dialog). The weekly summary adds
   one line when the restart has waited more than 7 days.
6. **Old helper (P2).** The in-panel app update runs as the app user and cannot replace the root helper. The helper
   carries `# duniya-ops-version: N`; with an older one the page says to run `sudo duniya update` (which now
   refreshes the helper when `deploy/ops` is unchanged from the commit) or re-run the installer, and
   `os-update-all` is refused with that message.
7. **Admin MCP (P2).** `list_os_updates` returns the groups; `run_maintenance` accepts `os-update-all`;
   `get_maintenance_status` includes the result line and the restart status.

## Out of scope

- Restarting automatically, scheduling OS updates, unholding packages from the panel.
