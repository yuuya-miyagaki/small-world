import { signIn, signUp } from '../../services/authService.js';
import { navigate } from '../router.js';

/**
 * ログインページをレンダリングする
 */
export function renderLogin() {
  const app = document.getElementById('app');
  let isSignUp = false;

  const render = () => {
    app.innerHTML = `
      <div class="login-page">
        <div class="login-card glass">
          <div class="login-logo">
            <span class="login-logo-icon">🌍</span>
            <h1>Small World</h1>
            <p>AI Organization Engine</p>
          </div>

          <form class="login-form" id="loginForm">
            <div id="loginError" class="login-error" style="display: none;"></div>

            <div class="form-group">
              <label for="email">メールアドレス</label>
              <input type="email" id="email" placeholder="you@example.com" required />
            </div>

            <div class="form-group">
              <label for="password">パスワード</label>
              <input type="password" id="password" placeholder="••••••••" required minlength="6" />
            </div>

            ${isSignUp ? `
              <div class="form-group">
                <label for="confirmPassword">パスワード確認</label>
                <input type="password" id="confirmPassword" placeholder="••••••••" required minlength="6" />
              </div>
            ` : ''}

            <button type="submit" class="btn btn-primary login-submit">
              ${isSignUp ? 'アカウント作成' : 'ログイン'}
            </button>
          </form>

          <div class="login-switch">
            ${isSignUp
              ? 'すでにアカウントをお持ちの方は <button id="switchAuth">ログイン</button>'
              : 'アカウントをお持ちでない方は <button id="switchAuth">新規登録</button>'
            }
          </div>
        </div>
      </div>
    `;

    // イベントバインド
    document.getElementById('loginForm').addEventListener('submit', handleSubmit);
    document.getElementById('switchAuth').addEventListener('click', () => {
      isSignUp = !isSignUp;
      render();
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');

    if (isSignUp) {
      const confirmPassword = document.getElementById('confirmPassword').value;
      if (password !== confirmPassword) {
        errorEl.textContent = 'パスワードが一致しません';
        errorEl.style.display = 'block';
        return;
      }
    }

    try {
      errorEl.style.display = 'none';
      if (isSignUp) {
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
      navigate('/worlds');
    } catch (error) {
      const errorMessages = {
        'auth/email-already-in-use': 'このメールアドレスは既に使用されています',
        'auth/invalid-email': '無効なメールアドレスです',
        'auth/wrong-password': 'パスワードが間違っています',
        'auth/user-not-found': 'アカウントが見つかりません',
        'auth/weak-password': 'パスワードは6文字以上にしてください',
        'auth/invalid-credential': 'メールアドレスまたはパスワードが間違っています',
      };
      errorEl.textContent = errorMessages[error.code] || error.message;
      errorEl.style.display = 'block';
    }
  };

  render();
}
