// #74: docs diagrams are committed SVG images rendered from docs/diagrams/*.mmd (no ```mermaid blocks, which GitHub
// fails to render and the GitHub app shows as code). Static checks only; rendering needs Chrome (npm run docs:diagrams).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkDiagrams, hashInSvg, srcHash, DIAGRAMS } from '../scripts/render-diagrams.mjs';

test('every diagram SVG is up to date with its source and no Mermaid blocks remain', () => {
  const { problems, count } = checkDiagrams();
  assert.deepEqual(problems, []);
  assert.ok(count > 0);
});

test('diagram SVGs work inside <img>: pure SVG text, no external resources, light card background', () => {
  for (const f of readdirSync(DIAGRAMS).filter((x) => x.endsWith('.svg'))) {
    const svg = readFileSync(join(DIAGRAMS, f), 'utf8');
    assert.doesNotMatch(svg, /<foreignObject|<script|@import|url\(\s*['"]?(?:https?:)?\/\//i, f);
    assert.match(svg, /<svg[^>]*\swidth="\d+"[^>]*\sheight="\d+"/, `${f} has an intrinsic size`);
    assert.match(svg, /<rect[^>]*fill="#ffffff"/, `${f} has the white card background`);
  }
});

test('source hash: line endings do not matter, a changed source does', () => {
  assert.equal(srcHash('flowchart TD\r\n  A --> B\r\n'), srcHash('flowchart TD\n  A --> B\n'));
  assert.notEqual(srcHash('flowchart TD\n  A --> B\n'), srcHash('flowchart TD\n  A --> C\n'));
  assert.equal(hashInSvg(`<svg><!-- src-sha256: ${'a'.repeat(64)} --></svg>`), 'a'.repeat(64));
  assert.equal(hashInSvg('<svg></svg>'), undefined);
});
