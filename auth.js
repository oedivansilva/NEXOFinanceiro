const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
const authMessage = document.getElementById('authMessage');

function showMessage(message, type = 'error') {
  authMessage.textContent = message;
  authMessage.dataset.type = type;
}

async function redirectIfLogged() {
  const { data } = await sb.auth.getSession();
  if (data.session) window.location.href = 'app.html';
}
redirectIfLogged();

document.querySelectorAll('.auth-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.authTab + 'Form').classList.add('active');
    showMessage('', '');
  });
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage('Entrando...', 'info');

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  const { error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.message?.toLowerCase().includes('invalid login credentials')) {
      return showMessage('E-mail ou senha incorretos.');
    }
    return showMessage(error.message);
  }

  window.location.href = 'app.html';
});

document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage('Criando sua conta...', 'info');

  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name }
    }
  });

  if (error) {
    if (error.message?.toLowerCase().includes('already registered')) {
      return showMessage('Este e-mail já possui uma conta. Use a opção Entrar.');
    }
    return showMessage(error.message);
  }

  if (data.session) {
    showMessage('Conta criada com sucesso! Entrando...', 'success');
    setTimeout(() => {
      window.location.href = 'app.html';
    }, 350);
    return;
  }

  // Se chegar aqui, a confirmação de e-mail ainda está ativa no projeto Supabase.
  showMessage('O cadastro foi criado, mas o Supabase ainda está exigindo confirmação de e-mail.', 'error');
});
