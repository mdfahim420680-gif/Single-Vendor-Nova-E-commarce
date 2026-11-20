import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceSearchPlaceholderFrame,
  DEFAULT_SEARCH_PLACEHOLDER_CONFIG,
  resolveSearchPlaceholderConfig,
  splitSearchPlaceholderGraphemes,
  type SearchPlaceholderFrame,
} from './searchPlaceholder';

test('search placeholder animation types, pauses, deletes, and cycles phrases in order', () => {
  const phraseLengths = [2, 1];
  let frame: SearchPlaceholderFrame = { phraseIndex: 0, characterCount: 0, phase: 'typing' };

  frame = advanceSearchPlaceholderFrame(frame, phraseLengths);
  assert.deepEqual(frame, { phraseIndex: 0, characterCount: 1, phase: 'typing' });
  frame = advanceSearchPlaceholderFrame(frame, phraseLengths);
  frame = advanceSearchPlaceholderFrame(frame, phraseLengths);
  assert.deepEqual(frame, { phraseIndex: 0, characterCount: 2, phase: 'pause' });
  frame = advanceSearchPlaceholderFrame(frame, phraseLengths);
  assert.deepEqual(frame.phase, 'deleting');
  frame = advanceSearchPlaceholderFrame(frame, phraseLengths);
  frame = advanceSearchPlaceholderFrame(frame, phraseLengths);
  frame = advanceSearchPlaceholderFrame(frame, phraseLengths);
  assert.deepEqual(frame.phase, 'transition');
  frame = advanceSearchPlaceholderFrame(frame, phraseLengths);
  assert.deepEqual(frame, { phraseIndex: 1, characterCount: 0, phase: 'typing' });

  frame = advanceSearchPlaceholderFrame(frame, phraseLengths);
  frame = advanceSearchPlaceholderFrame(frame, phraseLengths);
  frame = advanceSearchPlaceholderFrame(frame, phraseLengths);
  frame = advanceSearchPlaceholderFrame(frame, phraseLengths);
  frame = advanceSearchPlaceholderFrame(frame, phraseLengths);
  frame = advanceSearchPlaceholderFrame(frame, phraseLengths);
  assert.deepEqual(frame, { phraseIndex: 0, characterCount: 0, phase: 'typing' });
});

test('search placeholder grapheme splitting preserves Bengali text', () => {
  const phrase = 'আপনার পছন্দের সেরা মানের পণ্য খুঁজে নিন...';
  const graphemes = splitSearchPlaceholderGraphemes(phrase);

  assert.ok(graphemes.length > 0);
  assert.equal(graphemes.join(''), phrase);
});

test('invalid or inactive public placeholder settings fall back safely', () => {
  const config = resolveSearchPlaceholderConfig({
    animationEnabled: true,
    typingSpeed: -1,
    deletingSpeed: 35,
    phrasePause: 1800,
    transitionPause: 300,
    phrases: [{ text: '   ', enabled: true, displayOrder: 0 }],
  });

  assert.equal(config.typingSpeed, DEFAULT_SEARCH_PLACEHOLDER_CONFIG.typingSpeed);
  assert.deepEqual(config.phrases, []);
});
