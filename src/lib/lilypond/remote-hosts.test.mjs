import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedRemoteLilyUrl } from '../lilypond-remote.mjs';

test('configured hosts: R2 vars and LILYPOND_REMOTE_ASSET_HOSTS parsed like URLs', () => {
  const env = {
    R2_PUBLIC_URL: 'https://pub-abc.r2.dev/',
    LILYPOND_REMOTE_ASSET_HOSTS: ' scores.example.org , https://cdn.example.net/, HTTPS://Mixed.Example.com/path , odd.example:8443, bad host^ ',
  };
  for (const url of [
    'https://pub-abc.r2.dev/scores/a.svg',
    'https://scores.example.org/a.svg',
    'https://cdn.example.net/x/a.svg',
    'https://mixed.example.com/a.svg',
    'https://odd.example:8443/a.svg',
  ]) assert.equal(isAllowedRemoteLilyUrl(url, env), true, url);

  for (const url of [
    'https://attacker.r2.dev/a.svg',
    'https://odd.example/a.svg', // port must match
    'https://scores.example.org:444/a.svg',
    'http://scores.example.org/a.svg',
    'https://u:p@scores.example.org/a.svg',
    'https://evil.example/a.svg',
    'not a url',
  ]) assert.equal(isAllowedRemoteLilyUrl(url, env), false, url);
});

test('nothing configured → nothing allowed', () => {
  assert.equal(isAllowedRemoteLilyUrl('https://pub-abc.r2.dev/a.svg', {}), false);
});
