export interface SearchPlaceholderPhrase {
  text: string;
  enabled: boolean;
  displayOrder: number;
}

export interface SearchPlaceholderConfig {
  animationEnabled: boolean;
  typingSpeed: number;
  deletingSpeed: number;
  phrasePause: number;
  transitionPause: number;
  phrases: SearchPlaceholderPhrase[];
}

export type SearchPlaceholderPhase = 'typing' | 'pause' | 'deleting' | 'transition';

export interface SearchPlaceholderFrame {
  phraseIndex: number;
  characterCount: number;
  phase: SearchPlaceholderPhase;
}

export const DEFAULT_SEARCH_PLACEHOLDER_CONFIG: SearchPlaceholderConfig = {
  animationEnabled: true,
  typingSpeed: 60,
  deletingSpeed: 35,
  phrasePause: 1800,
  transitionPause: 300,
  phrases: [
    'আপনার পছন্দের সেরা মানের পণ্য খুঁজে নিন...',
    'মানসম্মত পণ্য, কেনাকাটায় পরিপূর্ণ আস্থা...',
    'হাজারো পণ্যের মাঝে খুঁজে নিন আপনার পছন্দেরটি...',
    'পছন্দের পণ্য কিনুন সেরা দামে...',
    'আপনার দৈনন্দিন জীবনের প্রয়োজনীয় সব পণ্য...',
    'দারুণ সব পণ্যের চমৎকার সংগ্রহ...',
    'কেনাকাটা হোক আরও সহজ ও আনন্দময়...',
    'আপনার পছন্দ, আমাদের অগ্রাধিকার...',
  ].map((text, displayOrder) => ({ text, enabled: true, displayOrder })),
};

export const DEFAULT_SEARCH_PLACEHOLDER_TEXT = 'Search for products... (English or বাংলা)';

interface SegmentPart {
  segment: string;
}

interface GraphemeSegmenter {
  segment(input: string): Iterable<SegmentPart>;
}

type IntlWithSegmenter = typeof Intl & {
  Segmenter?: new (
    locales?: string | string[],
    options?: { granularity: 'grapheme' },
  ) => GraphemeSegmenter;
};

export function splitSearchPlaceholderGraphemes(value: string): string[] {
  const Segmenter = (Intl as IntlWithSegmenter).Segmenter;
  if (Segmenter) {
    return Array.from(new Segmenter('bn', { granularity: 'grapheme' }).segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTiming(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function resolveSearchPlaceholderConfig(value: unknown): SearchPlaceholderConfig {
  if (!isRecord(value)) return DEFAULT_SEARCH_PLACEHOLDER_CONFIG;

  const configuredPhrases = Array.isArray(value.phrases)
    ? value.phrases
        .filter(
          (phrase): phrase is Record<string, unknown> =>
            isRecord(phrase) &&
            typeof phrase.text === 'string' &&
            phrase.text.trim().length > 0 &&
            Array.from(phrase.text).length <= 140 &&
            typeof phrase.enabled === 'boolean' &&
            typeof phrase.displayOrder === 'number' &&
            Number.isInteger(phrase.displayOrder),
        )
        .sort((a, b) => Number(a.displayOrder) - Number(b.displayOrder))
        .slice(0, 20)
        .map(({ text, enabled, displayOrder }) => ({
          text: String(text).trim(),
          enabled: Boolean(enabled),
          displayOrder: Number(displayOrder),
        }))
    : [];
  const activePhrases = configuredPhrases.filter((phrase) => phrase.enabled);

  return {
    animationEnabled:
      typeof value.animationEnabled === 'boolean'
        ? value.animationEnabled
        : DEFAULT_SEARCH_PLACEHOLDER_CONFIG.animationEnabled,
    typingSpeed: isTiming(value.typingSpeed, 20, 250)
      ? value.typingSpeed
      : DEFAULT_SEARCH_PLACEHOLDER_CONFIG.typingSpeed,
    deletingSpeed: isTiming(value.deletingSpeed, 20, 250)
      ? value.deletingSpeed
      : DEFAULT_SEARCH_PLACEHOLDER_CONFIG.deletingSpeed,
    phrasePause: isTiming(value.phrasePause, 500, 10000)
      ? value.phrasePause
      : DEFAULT_SEARCH_PLACEHOLDER_CONFIG.phrasePause,
    transitionPause: isTiming(value.transitionPause, 0, 3000)
      ? value.transitionPause
      : DEFAULT_SEARCH_PLACEHOLDER_CONFIG.transitionPause,
    phrases: activePhrases,
  };
}

export function getSearchPlaceholderFrameDelay(
  phase: SearchPlaceholderPhase,
  config: SearchPlaceholderConfig,
): number {
  if (phase === 'pause') return config.phrasePause;
  if (phase === 'deleting') return config.deletingSpeed;
  if (phase === 'transition') return config.transitionPause;
  return config.typingSpeed;
}

export function advanceSearchPlaceholderFrame(
  frame: SearchPlaceholderFrame,
  phraseLengths: number[],
): SearchPlaceholderFrame {
  const phraseLength = phraseLengths[frame.phraseIndex] ?? 0;
  if (frame.phase === 'typing') {
    return frame.characterCount < phraseLength
      ? { ...frame, characterCount: frame.characterCount + 1 }
      : { ...frame, phase: 'pause' };
  }
  if (frame.phase === 'pause') return { ...frame, phase: 'deleting' };
  if (frame.phase === 'deleting') {
    return frame.characterCount > 0
      ? { ...frame, characterCount: frame.characterCount - 1 }
      : { ...frame, phase: 'transition' };
  }
  return {
    phraseIndex: (frame.phraseIndex + 1) % Math.max(phraseLengths.length, 1),
    characterCount: 0,
    phase: 'typing',
  };
}
