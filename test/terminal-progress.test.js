import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeTerminalProgress } from '../server/sessions.js';

function transcript(prompt) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shed-progress-')), 's.jsonl');
  const now = Date.now();
  fs.writeFileSync(file, [
    { type: 'user', timestamp: new Date(now).toISOString(), message: { role: 'user', content: prompt } },
    { type: 'assistant', timestamp: new Date(now + 1000).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: 'Here and ready.' }] } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  return { file, createdAt: new Date(now - 1000).toISOString() };
}

for (const prompt of ['hello?', 'copy', 'ok', 'a longer message than eight characters']) {
  test(`a delivered message is matched in the transcript: "${prompt}"`, () => {
    const { file, createdAt } = transcript(prompt);
    const progress = claudeTerminalProgress({ id: `t-${prompt}`, transcriptFile: file, createdAt, prompt, transcriptOffset: 0 });
    assert.equal(progress.found, true);
    assert.match(progress.output, /Here and ready/);
  });
}

test('a different message is not matched', () => {
  const { file, createdAt } = transcript('hello?');
  assert.equal(claudeTerminalProgress({ id: 't-other', transcriptFile: file, createdAt, prompt: 'copy', transcriptOffset: 0 }).found, false);
});
