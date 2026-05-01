import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function readText(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

test('manifest is MV3 MeowBreak with broad eligible site injection', () => {
  const manifest = readJson('manifest.json');

  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.name, /MeowBreak/);
  assert.equal(manifest.background?.service_worker, 'background.js');
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('tabs'));
  assert.ok(manifest.permissions.includes('alarms'));
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['<all_urls>']);
  assert.deepEqual(manifest.web_accessible_resources[0].matches, ['<all_urls>']);
});

test('background owns shared browser-wide timer and eligible tab overlay routing', () => {
  const background = readText('background.js');

  assert.match(background, /chrome\.storage\.local/);
  assert.match(background, /chrome\.windows\.onFocusChanged/);
  assert.match(background, /chrome\.tabs\.onActivated/);
  assert.match(background, /usageSeconds/);
  assert.match(background, /breakEndsAt/);
  assert.match(background, /activeTabHint/);
  assert.match(background, /ignoreFocus/);
  assert.match(background, /SHOW_BREAK_OVERLAY/);
  assert.doesNotMatch(background, /twitter|facebook|reddit|youtube|threads|bsky|sns/i);
});

test('content script renders dismissible overlay without local usage countdown', () => {
  const content = readText('content.js');

  assert.match(content, /SHOW_BREAK_OVERLAY/);
  assert.match(content, /DISMISS_BREAK/);
  assert.match(content, /assets\/meowbreak-pounce\.webm/);
  assert.match(content, /assets\/meowbreak-nap\.webm/);
  assert.doesNotMatch(content, /setInterval\([^)]*usage|localSeconds|usageLimit\s*\*/s);
});

test('content script renders a small next-break countdown widget from background state', () => {
  const content = readText('content.js');
  const css = readText('content.css');

  assert.match(content, /meowbreak-next-break/);
  assert.match(content, /refreshNextBreakWidget/);
  assert.match(content, /GET_STATE/);
  assert.match(content, /breakActive/);
  assert.match(content, /removeNextBreakWidget\(\)/);
  assert.match(css, /#meowbreak-next-break/);
  assert.match(css, /bottom:\s*16px/);
  assert.match(css, /right:\s*16px/);
  assert.match(css, /border-radius:\s*999px/);
});

test('background preserves short focus-away pauses and resets after fifteen minutes away', () => {
  const background = readText('background.js');

  assert.match(background, /FOCUS_RESUME_GRACE_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
  assert.match(background, /focusLostAt/);
  assert.match(background, /handleFocusChanged/);
  assert.match(background, /now\s*-\s*state\.focusLostAt\s*>=\s*FOCUS_RESUME_GRACE_MS/);
  assert.match(background, /usageSeconds:\s*0/);
});

test('popup reports remaining time until the next break while eligible', () => {
  const popup = readText('popup.js');

  assert.match(popup, /remainingSeconds/);
  assert.match(popup, /nextBreakAt/);
  assert.match(popup, /until next break/);
  assert.match(popup, /getActiveTabHint/);
  assert.match(popup, /ignoreFocus/);
});

test('popup keeps limit and break controls but removes social checkbox list', () => {
  const html = readText('popup.html');
  const popup = readText('popup.js');

  assert.match(html, /id="usageLimit"/);
  assert.match(html, /id="breakTime"/);
  assert.match(html, /id="dismissBtn"/);
  assert.doesNotMatch(html, /sns|social|Twitter|YouTube|Facebook|Reddit|Threads|Bluesky/i);
  assert.doesNotMatch(popup, /sns|social|Twitter|YouTube|Facebook|Reddit|Threads|Bluesky/i);
});

test('README documents unpacked install, restricted pages, implementation summary, and Chrome run caveat', () => {
  const readme = readText('README.md');

  assert.match(readme, /Chrome2\/Profile 1/);
  assert.match(readme, /chrome:\/\/extensions/);
  assert.match(readme, /Load unpacked/);
  assert.match(readme, /chrome:\/\/ pages/);
  assert.match(readme, /Chrome Web Store/);
  assert.match(readme, /countdown/i);
  assert.match(readme, /15 minutes/i);
  assert.match(readme, /Implementation summary/i);
  assert.match(readme, /not run Chrome|Chrome was not run/i);
});

test('local cat assets are present', () => {
  for (const asset of [
    'assets/meowbreak-pounce.webm',
    'assets/meowbreak-nap.webm',
    'assets/meowbreak-icon16.png',
    'assets/meowbreak-icon48.png',
    'assets/meowbreak-icon128.png',
  ]) {
    assert.equal(existsSync(path.join(root, asset)), true, `${asset} should exist`);
  }
});
