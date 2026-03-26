import { describe, it, expect } from 'vitest';
import { generateSystemPrompt, describeMood, PRESET_AGENTS } from '../../src/core/personality.js';

describe('Personality Module', () => {
  describe('PRESET_AGENTS', () => {
    it('should have 3 preset agents', () => {
      expect(PRESET_AGENTS).toHaveLength(3);
    });

    it('each agent should have name, role, avatar, color, and personality', () => {
      for (const agent of PRESET_AGENTS) {
        expect(agent.name).toBeTruthy();
        expect(agent.role).toBeTruthy();
        expect(agent.avatar).toBeTruthy();
        expect(agent.color).toBeTruthy();
        expect(agent.personality).toBeDefined();
        expect(agent.personality.openness).toBeGreaterThanOrEqual(0);
        expect(agent.personality.openness).toBeLessThanOrEqual(1);
      }
    });

    it('Kai should be a researcher with high openness and low extraversion', () => {
      const kai = PRESET_AGENTS.find((a) => a.name === 'Kai');
      expect(kai).toBeDefined();
      expect(kai.role).toBe('リサーチャー');
      expect(kai.personality.openness).toBeGreaterThan(0.7);
      expect(kai.personality.extraversion).toBeLessThan(0.5);
    });

    it('Mia should be a writer with high agreeableness and conscientiousness', () => {
      const mia = PRESET_AGENTS.find((a) => a.name === 'Mia');
      expect(mia).toBeDefined();
      expect(mia.role).toBe('ライター');
      expect(mia.personality.agreeableness).toBeGreaterThan(0.7);
      expect(mia.personality.conscientiousness).toBeGreaterThan(0.7);
    });

    it('Rex should be a manager with high extraversion and low neuroticism', () => {
      const rex = PRESET_AGENTS.find((a) => a.name === 'Rex');
      expect(rex).toBeDefined();
      expect(rex.role).toBe('マネージャー');
      expect(rex.personality.extraversion).toBeGreaterThan(0.7);
      expect(rex.personality.neuroticism).toBeLessThan(0.3);
    });
  });

  describe('generateSystemPrompt', () => {
    const mockAgent = {
      name: 'TestAgent',
      role: 'テスター',
      personality: {
        openness: 0.9,
        conscientiousness: 0.8,
        extraversion: 0.3,
        agreeableness: 0.5,
        neuroticism: 0.4,
      },
      mood: {
        energy: 0.7,
        stress: 0.3,
        valence: 0.6,
        dominantEmotion: 'neutral',
      },
    };

    it('should include agent name in the prompt', () => {
      const prompt = generateSystemPrompt(mockAgent);
      expect(prompt).toContain('TestAgent');
    });

    it('should include role in the prompt', () => {
      const prompt = generateSystemPrompt(mockAgent);
      expect(prompt).toContain('テスター');
    });

    it('should reflect high openness as curiosity-related traits', () => {
      const prompt = generateSystemPrompt(mockAgent);
      expect(prompt).toContain('好奇心');
    });

    it('should reflect low extraversion as introverted traits', () => {
      const prompt = generateSystemPrompt(mockAgent);
      expect(prompt).toContain('じっくり考え');
    });

    it('should include memories when provided', () => {
      const prompt = generateSystemPrompt(mockAgent, {
        memories: [{ summary: '昨日の会議で重要な決定があった' }],
      });
      expect(prompt).toContain('昨日の会議で重要な決定があった');
    });

    it('should include relationships when provided', () => {
      const prompt = generateSystemPrompt(mockAgent, {
        relationships: {
          'Mia': { score: 0.8 },
        },
      });
      expect(prompt).toContain('Mia');
      expect(prompt).toContain('親しい');
    });
  });

  describe('describeMood', () => {
    it('should describe high energy', () => {
      const description = describeMood({ energy: 0.9, stress: 0.2, valence: 0.5 });
      expect(description).toContain('エネルギー');
    });

    it('should describe low energy', () => {
      const description = describeMood({ energy: 0.2, stress: 0.2, valence: 0.5 });
      expect(description).toContain('疲れ');
    });

    it('should describe high stress', () => {
      const description = describeMood({ energy: 0.5, stress: 0.8, valence: 0.5 });
      expect(description).toContain('ストレス');
    });

    it('should describe positive valence', () => {
      const description = describeMood({ energy: 0.5, stress: 0.2, valence: 0.9 });
      expect(description).toContain('前向き');
    });
  });
});
