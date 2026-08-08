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


const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
const supportAccessModal = document.getElementById('supportAccessModal');
const supportAccessForm = document.getElementById('supportAccessForm');
const supportRequestMessage = document.getElementById('supportRequestMessage');

forgotPasswordBtn?.addEventListener('click', () => {
  supportAccessForm?.reset();
  supportRequestMessage.textContent = '';
  const loginEmail = document.getElementById('loginEmail')?.value?.trim();
  if (loginEmail) document.getElementById('supportEmail').value = loginEmail;
  supportAccessModal?.showModal();
});

document.getElementById('closeSupportAccessModal')?.addEventListener('click', () => supportAccessModal?.close());

supportAccessForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('sendSupportRequestBtn');
  btn.disabled = true;
  supportRequestMessage.dataset.type = 'info';
  supportRequestMessage.textContent = 'Enviando para o suporte...';

  try {
    const { data, error } = await sb.functions.invoke('nexo-admin', {
      body: {
        action: 'submit_support_request',
        name: document.getElementById('supportName').value.trim(),
        email: document.getElementById('supportEmail').value.trim(),
        message: document.getElementById('supportMessage').value.trim(),
        website: document.getElementById('supportWebsite').value.trim()
      }
    });

    if (error) {
      let message = error.message || 'Não foi possível enviar a solicitação.';
      try {
        if (error.context?.json) {
          const ctx = await error.context.json();
          message = ctx?.error || message;
        }
      } catch (_) {}
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);

    supportRequestMessage.dataset.type = 'success';
    supportRequestMessage.textContent = data?.message || 'Solicitação enviada. O suporte NEXO irá redefinir seu acesso.';
    setTimeout(() => supportAccessModal?.close(), 1800);
  } catch (err) {
    supportRequestMessage.dataset.type = 'error';
    supportRequestMessage.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
