const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
const form = document.getElementById('changePasswordForm');
const message = document.getElementById('changePasswordMessage');

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) window.location.href = 'index.html';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;
  const btn = document.getElementById('changePasswordBtn');

  if (password !== confirm) {
    message.dataset.type = 'error';
    message.textContent = 'As duas senhas precisam ser iguais.';
    return;
  }
  if (password.length < 8) {
    message.dataset.type = 'error';
    message.textContent = 'Use pelo menos 8 caracteres.';
    return;
  }

  btn.disabled = true;
  message.dataset.type = 'info';
  message.textContent = 'Salvando sua nova senha...';

  const { data: { user } } = await sb.auth.getUser();
  if (!user) { window.location.href = 'index.html'; return; }

  const { error: passwordError } = await sb.auth.updateUser({ password });
  if (passwordError) {
    message.dataset.type = 'error';
    message.textContent = passwordError.message;
    btn.disabled = false;
    return;
  }

  const { error: profileError } = await sb.from('profiles').update({
    force_password_change: false,
    password_changed_at: new Date().toISOString()
  }).eq('id', user.id);

  if (profileError) {
    message.dataset.type = 'error';
    message.textContent = 'A senha foi alterada, mas não foi possível concluir a atualização do perfil: ' + profileError.message;
    btn.disabled = false;
    return;
  }

  message.dataset.type = 'success';
  message.textContent = 'Senha atualizada! Entrando no NEXO...';
  setTimeout(() => window.location.href = 'app.html', 700);
});

init();
