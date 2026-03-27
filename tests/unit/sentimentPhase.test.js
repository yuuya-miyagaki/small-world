import { describe, it, expect } from 'vitest';
import { analyzeSentimentLocal, detectConversationPhase } from '../../src/core/personality.js';

describe('analyzeSentimentLocal（ルールベース感情分析）', () => {
  it('ポジティブなテキストを正しく判定する', () => {
    const result = analyzeSentimentLocal('今日はとても嬉しい！面白い発見があった');
    expect(result[0].label).toContain('positive');
    expect(result[0].score).toBeGreaterThan(0.5);
  });

  it('ネガティブなテキストを正しく判定する', () => {
    const result = analyzeSentimentLocal('残念だけど、この問題は困ったな');
    expect(result[0].label).toContain('negative');
    expect(result[0].score).toBeLessThan(0.5);
  });

  it('ニュートラルなテキストを正しく判定する', () => {
    const result = analyzeSentimentLocal('明日の会議は10時からです');
    expect(result[0].label).toBe('neutral');
    expect(result[0].score).toBe(0.5);
  });

  it('空文字列をニュートラルとして判定する', () => {
    const result = analyzeSentimentLocal('');
    expect(result[0].label).toBe('neutral');
  });

  it('ポジティブとネガティブが拮抗する場合はニュートラル', () => {
    const result = analyzeSentimentLocal('嬉しいけど残念');
    expect(result[0].label).toBe('neutral');
  });
});

describe('detectConversationPhase（会話フェーズ検出）', () => {
  it('メッセージ数3以下はgreetingフェーズ', () => {
    expect(detectConversationPhase([], 2)).toBe('greeting');
  });

  it('疑問符が多いとinquiryフェーズ', () => {
    const memories = [
      { content: 'それはどういう意味？' },
      { content: 'なぜそう思うの？' },
      { content: 'テスト' },
    ];
    expect(detectConversationPhase(memories, 5)).toBe('inquiry');
  });

  it('メッセージ数10以上はdeep_diveフェーズ', () => {
    expect(detectConversationPhase([], 12)).toBe('deep_dive');
  });

  it('通常の会話はdiscussionフェーズ', () => {
    const memories = [
      { content: '面白い話題だね' },
      { content: 'そうだね' },
    ];
    expect(detectConversationPhase(memories, 6)).toBe('discussion');
  });
});
