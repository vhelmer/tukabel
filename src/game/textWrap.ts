import { CanvasTextMetrics } from 'pixi.js';

// Thai has no spaces between words. Pixi would break such a token between any
// two graphemes, so a token with Thai script is split at dictionary words.
const thai = /[฀-๿]/u;
const words =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('th', { granularity: 'word' })
    : null;
const split = CanvasTextMetrics.wordWrapSplit.bind(CanvasTextMetrics);
CanvasTextMetrics.wordWrapSplit = (token: string) =>
  words && thai.test(token)
    ? [...words.segment(token)].map((part) => part.segment)
    : split(token);
