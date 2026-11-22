// Imported for its effect by the harness (and by tests that make temporary folders without it): everything a test
// writes to the temporary folder (data folders, fake repositories, keys; its child processes too) goes under one folder
// per test process, removed when the process ends. A test run leaves nothing behind (before, a full run left about
// 8 GB in the system's temporary folder, every time).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'duniya-test-'));
process.env.TMPDIR = root;
process.on('exit', () => { try { rmSync(root, { recursive: true, force: true }); } catch { /* the system's own clean-up takes it */ } });
