/**
 * agentCreator.js Unit Tests
 *
 * エージェント作成モジュールのテスト。
 * UI コンポーネントのロジック部分（状態管理、バリデーション、データ変換）をテスト。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createFormState,
  applyPreset,
  validateFormState,
  buildAgentData,
  validateEmoji,
  EMOJI_GRID,
  MAX_AGENTS,
} from '../../src/ui/components/agentCreator.js';
import { PRESET_AGENTS, EXTENDED_PRESETS } from '../../src/core/personality.js';

describe('AgentCreator Module', () => {
  // ============================================
  // 1. createFormState — 初期状態の生成
  // ============================================
  describe('createFormState', () => {
    it('should return a valid initial form state with defaults', () => {
      const state = createFormState();

      expect(state.name).toBe('');
      expect(state.role).toBe('');
      expect(state.avatar).toBe('🤖');
      expect(state.color).toBe('#6366f1');
      expect(state.personality.openness).toBe(0.5);
      expect(state.personality.conscientiousness).toBe(0.5);
      expect(state.personality.extraversion).toBe(0.5);
      expect(state.personality.agreeableness).toBe(0.5);
      expect(state.personality.neuroticism).toBe(0.5);
      expect(state.voiceStyle.pronoun).toBe('');
      expect(state.voiceStyle.tone).toBe('');
      expect(state.voiceStyle.ending).toBe('');
      expect(state.isPreset).toBe(false);
    });
  });

  // ============================================
  // 2. applyPreset — プリセットテンプレートの適用
  // ============================================
  describe('applyPreset', () => {
    it('should apply Kai preset correctly', () => {
      const state = createFormState();
      const preset = PRESET_AGENTS.find((p) => p.name === 'Kai');
      const result = applyPreset(state, preset);

      expect(result.name).toBe('Kai');
      expect(result.role).toBe('リサーチャー');
      expect(result.avatar).toBe('🔬');
      expect(result.color).toBe('#6366f1');
      expect(result.personality.openness).toBe(0.9);
      expect(result.personality.extraversion).toBe(0.3);
      expect(result.isPreset).toBe(true);
    });

    it('should apply extended preset (Nova) correctly', () => {
      const state = createFormState();
      const preset = EXTENDED_PRESETS.find((p) => p.name === 'Nova');
      const result = applyPreset(state, preset);

      expect(result.name).toBe('Nova');
      expect(result.role).toBe('デザイナー');
      expect(result.avatar).toBe('🎨');
      expect(result.personality.openness).toBe(0.95);
    });

    it('should return a new object (immutable)', () => {
      const state = createFormState();
      const preset = PRESET_AGENTS[0];
      const result = applyPreset(state, preset);

      expect(result).not.toBe(state);
      expect(result.personality).not.toBe(state.personality);
    });
  });

  // ============================================
  // 3. validateFormState — バリデーション
  // ============================================
  describe('validateFormState', () => {
    let validState;

    beforeEach(() => {
      validState = createFormState();
      validState.name = 'TestAgent';
      validState.role = 'テスター';
      validState.avatar = '🧪';
    });

    it('should pass with valid state', () => {
      const errors = validateFormState(validState);
      expect(errors).toEqual([]);
    });

    it('should fail when name is empty', () => {
      validState.name = '';
      const errors = validateFormState(validState);
      expect(errors).toContainEqual(
        expect.objectContaining({ field: 'name' })
      );
    });

    it('should fail when name is too long (>20 chars)', () => {
      validState.name = 'a'.repeat(21);
      const errors = validateFormState(validState);
      expect(errors).toContainEqual(
        expect.objectContaining({ field: 'name' })
      );
    });

    it('should fail when role is empty', () => {
      validState.role = '';
      const errors = validateFormState(validState);
      expect(errors).toContainEqual(
        expect.objectContaining({ field: 'role' })
      );
    });

    it('should fail when avatar is not a valid emoji', () => {
      validState.avatar = 'abc';
      const errors = validateFormState(validState);
      expect(errors).toContainEqual(
        expect.objectContaining({ field: 'avatar' })
      );
    });

    it('should fail when personality values are out of range', () => {
      validState.personality.openness = 1.5;
      const errors = validateFormState(validState);
      expect(errors).toContainEqual(
        expect.objectContaining({ field: 'personality' })
      );
    });

    it('should fail when personality values are negative', () => {
      validState.personality.neuroticism = -0.1;
      const errors = validateFormState(validState);
      expect(errors).toContainEqual(
        expect.objectContaining({ field: 'personality' })
      );
    });

    it('should accept agent count within limit', () => {
      const errors = validateFormState(validState, 3);
      expect(errors).toEqual([]);
    });

    it('should fail when agent count exceeds MAX_AGENTS', () => {
      const errors = validateFormState(validState, MAX_AGENTS);
      expect(errors).toContainEqual(
        expect.objectContaining({ field: 'agentCount' })
      );
    });
  });

  // ============================================
  // 4. buildAgentData — 送信前データ変換
  // ============================================
  describe('buildAgentData', () => {
    it('should transform form state into agent data for createAgent', () => {
      const state = createFormState();
      state.name = 'Luna';
      state.role = 'デザイナー';
      state.avatar = '🎨';
      state.color = '#8b5cf6';
      state.personality.openness = 0.9;
      state.isPreset = false;

      const data = buildAgentData(state);

      expect(data.name).toBe('Luna');
      expect(data.role).toBe('デザイナー');
      expect(data.avatar).toBe('🎨');
      expect(data.color).toBe('#8b5cf6');
      expect(data.personality.openness).toBe(0.9);
      expect(data.isPreset).toBe(false);
    });

    it('should include voiceStyle only when at least one field is filled', () => {
      const state = createFormState();
      state.name = 'Test';
      state.role = 'Test';

      // No voice style
      let data = buildAgentData(state);
      expect(data.voiceStyle).toBeUndefined();

      // With voice style
      state.voiceStyle.pronoun = '僕';
      data = buildAgentData(state);
      expect(data.voiceStyle).toBeDefined();
      expect(data.voiceStyle.pronoun).toBe('僕');
    });

    it('should trim whitespace from text fields', () => {
      const state = createFormState();
      state.name = '  Luna  ';
      state.role = '  デザイナー  ';
      state.voiceStyle.pronoun = '  あたし  ';

      const data = buildAgentData(state);
      expect(data.name).toBe('Luna');
      expect(data.role).toBe('デザイナー');
      expect(data.voiceStyle.pronoun).toBe('あたし');
    });
  });

  // ============================================
  // 5. validateEmoji — 絵文字バリデーション
  // ============================================
  describe('validateEmoji', () => {
    it('should accept single emoji characters', () => {
      expect(validateEmoji('😀')).toBe(true);
      expect(validateEmoji('🔬')).toBe(true);
      expect(validateEmoji('🎨')).toBe(true);
      expect(validateEmoji('👔')).toBe(true);
    });

    it('should reject non-emoji strings', () => {
      expect(validateEmoji('abc')).toBe(false);
      expect(validateEmoji('A')).toBe(false);
      expect(validateEmoji('12')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateEmoji('')).toBe(false);
    });

    it('should reject multiple emoji (2+ grapheme clusters)', () => {
      expect(validateEmoji('😀😀')).toBe(false);
    });
  });

  // ============================================
  // 6. EMOJI_GRID — 絵文字グリッドデータ
  // ============================================
  describe('EMOJI_GRID', () => {
    it('should be a non-empty array of emoji strings', () => {
      expect(Array.isArray(EMOJI_GRID)).toBe(true);
      expect(EMOJI_GRID.length).toBeGreaterThan(0);
    });

    it('each emoji should pass validateEmoji', () => {
      for (const emoji of EMOJI_GRID) {
        expect(validateEmoji(emoji)).toBe(true);
      }
    });
  });

  // ============================================
  // 7. MAX_AGENTS — 定数
  // ============================================
  describe('MAX_AGENTS', () => {
    it('should be 6', () => {
      expect(MAX_AGENTS).toBe(6);
    });
  });
});
