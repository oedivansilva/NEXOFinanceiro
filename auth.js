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
  if (error) return showMessage(error.message);
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
    options: { data: { full_name: name } }
  });
  if (error) return showMessage(error.message);
  if (data.session) window.location.href = 'app.html';
  else showMessage('Conta criada. Confira seu e-mail para confirmar o cadastro.', 'success');
});
