/**
 * Agent Creator — エージェント作成モジュール
 *
 * エージェント作成UIの状態管理・バリデーション・データ変換ロジック。
 * DOM操作は renderAgentCreatorModal() に集約。
 *
 * 設計判断（CROSS-AI レビュー 2026-03-27）:
 *   - formState オブジェクト + applyStateToDOM() で手動同期
 *   - バニラ JS に双方向バインディングがないため、明示的な同期パターン
 *   - validateFormState() でバリデーションを集約
 *   - buildAgentData() で送信前変換
 */

/** エージェント上限数（ハートビート API 負荷軽減のため） */
export const MAX_AGENTS = 6;

/**
 * 絵文字グリッド — Unicode 13 以前の1コードポイント絵文字
 * カスタムグリッドで表示する選択肢。
 * 「その他を入力」フィールドで任意の絵文字も入力可能。
 */
export const EMOJI_GRID = [
  // 人物・ロール
  '🤖', '👤', '👩', '👨', '🧑', '🦸', '🧙', '🥷', '🧑‍🔬', '🧑‍💻',
  // 動物
  '🐱', '🐶', '🦊', '🐻', '🐼', '🦉', '🦋', '🐉',
  // オブジェクト
  '🔬', '✍️', '👔', '🎨', '📊', '⚡', '🎯', '💡',
  '🔥', '🌟', '💎', '🎭', '🎵', '📚', '🛠️', '🏆',
  // 自然
  '🌸', '🌊', '🌙', '☀️', '🌈', '❄️',
];

/**
 * フォーム状態の初期値を生成する
 * @returns {Object} 初期フォーム状態
 */
export function createFormState() {
  return {
    name: '',
    role: '',
    avatar: '🤖',
    color: '#6366f1',
    personality: {
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      neuroticism: 0.5,
    },
    voiceStyle: {
      pronoun: '',
      tone: '',
      ending: '',
    },
    isPreset: false,
  };
}

/**
 * プリセットテンプレートをフォーム状態に適用する（イミュータブル）
 * @param {Object} state - 現在のフォーム状態
 * @param {Object} preset - プリセット定義 (PRESET_AGENTS or EXTENDED_PRESETS の要素)
 * @returns {Object} プリセットが適用された新しいフォーム状態
 */
export function applyPreset(state, preset) {
  return {
    ...state,
    name: preset.name,
    role: preset.role,
    avatar: preset.avatar,
    color: preset.color,
    personality: { ...preset.personality },
    isPreset: true,
    // voiceStyle はプリセットに含まれない（personality.js の getVoiceStyle が担当）
    voiceStyle: { pronoun: '', tone: '', ending: '' },
  };
}

/**
 * Intl.Segmenter を使った絵文字バリデーション
 * 1セグメント = 1表示文字を保証する。
 *
 * @param {string} value - バリデーション対象
 * @returns {boolean} 有効な単一絵文字なら true
 */
export function validateEmoji(value) {
  if (!value || typeof value !== 'string') return false;

  // Intl.Segmenter で grapheme cluster に分割
  const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
  const segments = [...segmenter.segment(value)];

  // 1セグメントでなければ不正
  if (segments.length !== 1) return false;

  // ASCII のみの文字（a-z, 0-9 等）は絵文字ではない
  const codePoint = value.codePointAt(0);
  if (codePoint < 0x00A9) return false; // © 以降が絵文字の可能性

  return true;
}

/**
 * フォーム状態をバリデーションする
 * @param {Object} state - フォーム状態
 * @param {number} [currentAgentCount=0] - 現在のエージェント数
 * @returns {Array<Object>} エラーの配列 [{ field, message }]。空配列 = バリデーション通過
 */
export function validateFormState(state, currentAgentCount = 0) {
  const errors = [];

  // 名前
  const name = state.name.trim();
  if (!name) {
    errors.push({ field: 'name', message: 'エージェント名を入力してください' });
  } else if (name.length > 20) {
    errors.push({ field: 'name', message: 'エージェント名は20文字以内にしてください' });
  }

  // ロール
  const role = state.role.trim();
  if (!role) {
    errors.push({ field: 'role', message: 'ロールを入力してください' });
  }

  // アバター
  if (!validateEmoji(state.avatar)) {
    errors.push({ field: 'avatar', message: '有効な絵文字を選択してください' });
  }

  // Big Five パラメータ
  const personalityKeys = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
  for (const key of personalityKeys) {
    const val = state.personality[key];
    if (typeof val !== 'number' || val < 0 || val > 1) {
      errors.push({ field: 'personality', message: `${key} は 0.0〜1.0 の範囲で指定してください` });
      break; // 1つ見つかれば十分
    }
  }

  // エージェント上限
  if (currentAgentCount >= MAX_AGENTS) {
    errors.push({ field: 'agentCount', message: `エージェントは最大${MAX_AGENTS}体までです` });
  }

  return errors;
}

/**
 * フォーム状態を createAgent() に渡す形式に変換する
 * @param {Object} state - フォーム状態
 * @returns {Object} agent.js の createAgent() に渡すデータ
 */
export function buildAgentData(state) {
  const data = {
    name: state.name.trim(),
    role: state.role.trim(),
    avatar: state.avatar,
    color: state.color,
    personality: { ...state.personality },
    // ユーザー作成エージェントは常にカスタム扱い
    // （プリセットテンプレートは初期値の補助であり、作成後は isPreset: false）
    isPreset: false,
  };

  // voiceStyle は少なくとも1フィールドが入力されている場合のみ含める
  const vs = state.voiceStyle;
  const hasVoice = vs.pronoun.trim() || vs.tone.trim() || vs.ending.trim();
  if (hasVoice) {
    data.voiceStyle = {
      pronoun: vs.pronoun.trim(),
      tone: vs.tone.trim(),
      ending: vs.ending.trim(),
    };
  }

  return data;
}

// ============================================================
// UI レンダリング（DOM 操作はここに集約）
// ============================================================

import { PRESET_AGENTS, EXTENDED_PRESETS } from '../../core/personality.js';

/** Big Five の日本語ラベル */
const PERSONALITY_LABELS = {
  openness: '開放性',
  conscientiousness: '誠実性',
  extraversion: '外向性',
  agreeableness: '協調性',
  neuroticism: '神経症傾向',
};

/**
 * フォーム状態を DOM に反映する（手動同期）
 * プリセット選択時など、JavaScript側でstateが変わったときに呼ぶ。
 *
 * @param {Object} state - 現在のフォーム状態
 * @param {HTMLElement} container - モーダルのルート要素
 */
export function applyStateToDOM(state, container) {
  // テキストフィールド
  const nameInput = container.querySelector('#ac-name');
  const roleInput = container.querySelector('#ac-role');
  if (nameInput) nameInput.value = state.name;
  if (roleInput) roleInput.value = state.role;

  // アバター表示
  const avatarDisplay = container.querySelector('.avatar-current');
  if (avatarDisplay) avatarDisplay.textContent = state.avatar;

  // カラー
  const colorInput = container.querySelector('#ac-color');
  if (colorInput) colorInput.value = state.color;

  // Big Five スライダー
  for (const key of Object.keys(PERSONALITY_LABELS)) {
    const slider = container.querySelector(`#ac-${key}`);
    const valueDisplay = container.querySelector(`#ac-${key}-val`);
    if (slider) slider.value = state.personality[key] * 100;
    if (valueDisplay) valueDisplay.textContent = state.personality[key].toFixed(1);
  }

  // ボイススタイル
  const pronounInput = container.querySelector('#ac-pronoun');
  const toneInput = container.querySelector('#ac-tone');
  const endingInput = container.querySelector('#ac-ending');
  if (pronounInput) pronounInput.value = state.voiceStyle.pronoun;
  if (toneInput) toneInput.value = state.voiceStyle.tone;
  if (endingInput) endingInput.value = state.voiceStyle.ending;
}

/**
 * エージェント作成モーダルを生成しページに挿入する
 *
 * @param {Object} options
 * @param {number} options.currentAgentCount - 現在のエージェント数
 * @param {function} options.onSubmit - 作成ボタン押下時コールバック (agentData) => Promise
 * @param {function} options.onCancel - キャンセルコールバック
 * @returns {{ modal: HTMLElement, state: Object }} モーダル要素とフォーム状態
 */
export function renderAgentCreatorModal({ currentAgentCount = 0, onSubmit, onCancel }) {
  let formState = createFormState();

  // --- モーダル HTML 生成 ---
  const allPresets = [...PRESET_AGENTS, ...EXTENDED_PRESETS];

  const modal = document.createElement('div');
  modal.className = 'agent-creator-modal';
  modal.id = 'agent-creator-modal';
  modal.innerHTML = `
    <div class="agent-creator-content">
      <!-- Header -->
      <div class="agent-creator-header">
        <span class="header-icon">🤖</span>
        <h3>エージェントを作成</h3>
      </div>

      <!-- Presets -->
      <div class="preset-section">
        <span class="preset-label">プリセットテンプレート</span>
        <div class="preset-grid">
          ${allPresets.map((p, i) => `
            <button class="preset-card" data-preset-index="${i}" type="button">
              <span class="preset-emoji">${p.avatar}</span>
              <span class="preset-name">${p.name}風</span>
            </button>
          `).join('')}
          <button class="preset-card preset-custom" data-preset-index="-1" type="button">
            ⬜ ゼロから作成
          </button>
        </div>
      </div>

      <!-- Basic Info -->
      <div class="section-divider">基本情報</div>

      <div class="form-group">
        <label for="ac-name">名前</label>
        <input type="text" id="ac-name" placeholder="エージェント名（20文字以内）" maxlength="20">
        <div class="form-error" id="ac-name-error"></div>
      </div>

      <div class="form-group">
        <label for="ac-role">ロール</label>
        <input type="text" id="ac-role" placeholder="リサーチャー、デザイナー等">
        <div class="form-error" id="ac-role-error"></div>
      </div>

      <div class="form-group">
        <label>アバター</label>
        <div class="avatar-picker" style="position: relative;">
          <div class="avatar-current">${formState.avatar}</div>
          <div class="emoji-grid-container" id="emoji-grid-popup">
            <div class="emoji-grid">
              ${EMOJI_GRID.map(e => `<button class="emoji-grid-btn" type="button" data-emoji="${e}">${e}</button>`).join('')}
            </div>
            <div class="emoji-custom-input">
              <input type="text" id="ac-emoji-custom" placeholder="その他を入力">
            </div>
          </div>
        </div>
        <div class="form-error" id="ac-avatar-error"></div>
      </div>

      <div class="form-group">
        <label for="ac-color">カラー</label>
        <input type="color" id="ac-color" value="${formState.color}">
      </div>

      <!-- Personality Sliders -->
      <div class="section-divider">性格（Big Five）</div>

      <div class="personality-sliders">
        ${Object.entries(PERSONALITY_LABELS).map(([key, label]) => `
          <div class="slider-row">
            <span class="slider-label">${label}</span>
            <div class="slider-track">
              <input type="range" id="ac-${key}" min="0" max="100" value="50" step="5">
            </div>
            <span class="slider-value" id="ac-${key}-val">0.5</span>
          </div>
        `).join('')}
      </div>

      <!-- Voice Style -->
      <div class="section-divider">口調（任意）</div>

      <div class="voice-style-fields">
        <label for="ac-pronoun">一人称</label>
        <input type="text" id="ac-pronoun" placeholder="僕、私、あたし等">

        <label for="ac-tone">話し方</label>
        <input type="text" id="ac-tone" placeholder="知的で少しオタクっぽい等">

        <label for="ac-ending">語尾</label>
        <input type="text" id="ac-ending" placeholder="「〜だよ！」等">
      </div>

      <!-- Validation Errors -->
      <div class="form-error" id="ac-general-error"></div>

      <!-- Actions -->
      <div class="agent-creator-actions">
        <button class="btn-cancel" id="ac-cancel" type="button">キャンセル</button>
        <button class="btn-create" id="ac-submit" type="button">✨ 作成</button>
      </div>
    </div>
  `;

  // --- イベントハンドラ ---

  // プリセット選択
  modal.querySelectorAll('.preset-card').forEach((card) => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.presetIndex, 10);
      // 全プリセットカードの selected を消す
      modal.querySelectorAll('.preset-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');

      if (idx >= 0 && idx < allPresets.length) {
        formState = applyPreset(formState, allPresets[idx]);
      } else {
        // ゼロから作成
        formState = createFormState();
      }
      applyStateToDOM(formState, modal);
    });
  });

  // テキストフィールド → state 同期
  const syncInput = (id, updater) => {
    const el = modal.querySelector(`#${id}`);
    if (el) el.addEventListener('input', () => updater(el.value));
  };

  syncInput('ac-name', (v) => { formState.name = v; });
  syncInput('ac-role', (v) => { formState.role = v; });
  syncInput('ac-color', (v) => { formState.color = v; });
  syncInput('ac-pronoun', (v) => { formState.voiceStyle.pronoun = v; });
  syncInput('ac-tone', (v) => { formState.voiceStyle.tone = v; });
  syncInput('ac-ending', (v) => { formState.voiceStyle.ending = v; });

  // Big Five スライダー → state 同期
  for (const key of Object.keys(PERSONALITY_LABELS)) {
    const slider = modal.querySelector(`#ac-${key}`);
    const valueDisplay = modal.querySelector(`#ac-${key}-val`);
    if (slider) {
      slider.addEventListener('input', () => {
        const val = parseInt(slider.value, 10) / 100;
        formState.personality[key] = val;
        if (valueDisplay) valueDisplay.textContent = val.toFixed(1);
      });
    }
  }

  // 絵文字ピッカー: トグル
  const avatarCurrent = modal.querySelector('.avatar-current');
  const emojiPopup = modal.querySelector('#emoji-grid-popup');
  if (avatarCurrent && emojiPopup) {
    avatarCurrent.addEventListener('click', () => {
      emojiPopup.classList.toggle('open');
    });
  }

  // 絵文字ピッカー: グリッド選択
  modal.querySelectorAll('.emoji-grid-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      formState.avatar = btn.dataset.emoji;
      applyStateToDOM(formState, modal);
      emojiPopup?.classList.remove('open');
    });
  });

  // 絵文字ピッカー: カスタム入力（「その他を入力」フィールド）
  const emojiCustom = modal.querySelector('#ac-emoji-custom');
  if (emojiCustom) {
    emojiCustom.addEventListener('input', () => {
      const val = emojiCustom.value.trim();
      if (val && validateEmoji(val)) {
        formState.avatar = val;
        applyStateToDOM(formState, modal);
      }
    });
  }

  // キャンセル
  const cancelBtn = modal.querySelector('#ac-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      modal.remove();
      onCancel?.();
    });
  }

  // オーバーレイクリックで閉じる
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      onCancel?.();
    }
  });

  // 作成ボタン
  const submitBtn = modal.querySelector('#ac-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      // バリデーション実行
      const errors = validateFormState(formState, currentAgentCount);
      clearErrors(modal);

      if (errors.length > 0) {
        showErrors(modal, errors);
        return;
      }

      // 送信中ガード
      submitBtn.disabled = true;
      submitBtn.textContent = '作成中...';

      try {
        const agentData = buildAgentData(formState);
        await onSubmit?.(agentData);
        modal.remove();
      } catch (error) {
        const generalError = modal.querySelector('#ac-general-error');
        if (generalError) {
          generalError.textContent = `作成に失敗しました: ${error.message}`;
          generalError.classList.add('visible');
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '✨ 作成';
      }
    });
  }

  // ページに挿入
  document.body.appendChild(modal);

  return { modal, get state() { return formState; } };
}

// ============================================================
// 内部ヘルパー
// ============================================================

function clearErrors(container) {
  container.querySelectorAll('.form-error').forEach((el) => {
    el.textContent = '';
    el.classList.remove('visible');
  });
}

function showErrors(container, errors) {
  for (const err of errors) {
    const errorEl = container.querySelector(`#ac-${err.field}-error`);
    if (errorEl) {
      errorEl.textContent = err.message;
      errorEl.classList.add('visible');
    } else {
      // フィールド固有のエラー表示がない場合は一般エラーに
      const general = container.querySelector('#ac-general-error');
      if (general) {
        general.textContent = err.message;
        general.classList.add('visible');
      }
    }
  }
}
