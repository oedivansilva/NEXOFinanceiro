const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const adminState = {
  session: null,
  user: null,
  profile: null,
  data: { users: [], subscriptions: [], requests: [], tickets: [], plans: [], audit: [], summary: {} },
  selectedUser: null,
  view: 'overview'
};

const $ = id => document.getElementById(id);
const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const fmtDateTime = v => v ? new Date(v).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }) : '—';
const fmtDate = v => v ? new Date(v+'T12:00:00').toLocaleDateString('pt-BR') : '—';

function roleLabel(role) {
  return { owner:'Proprietário', admin:'Administrador', support:'Suporte', user:'Usuário' }[role] || 'Usuário';
}
function subscriptionLabel(status) {
  return { active:'Ativa', trialing:'Teste', past_due:'Pagamento pendente', grace:'Carência', suspended:'Suspensa', cancelled:'Cancelada' }[status] || 'Sem assinatura';
}
function requestLabel(status) {
  return { pending:'Pendente', approved:'Aprovada', rejected:'Recusada', cancelled:'Cancelada' }[status] || status;
}
function ticketLabel(status) {
  return { open:'Aberto', in_progress:'Em atendimento', resolved:'Resolvido', closed:'Fechado' }[status] || status;
}
function isBanned(user) {
  if (!user?.banned_until) return false;
  const d = new Date(user.banned_until);
  return !Number.isNaN(d.getTime()) && d.getTime() > Date.now();
}
function avatarText(name, email) {
  return String(name || email || 'U').trim().charAt(0).toUpperCase() || 'U';
}

async function invokeAdmin(action, payload = {}) {
  const { data, error } = await sb.functions.invoke('nexo-admin', {
    body: { action, ...payload }
  });
  if (error) {
    let message = error.message || 'Erro ao chamar o painel administrativo.';
    try {
      if (error.context?.json) {
        const ctx = await error.context.json();
        message = ctx?.error || message;
      }
    } catch (_) {}
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function initAdmin() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return;
  }
  adminState.session = session;
  adminState.user = session.user;

  const { data: profile } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  adminState.profile = profile || null;

  if (!profile || !['owner','admin','support'].includes(profile.role)) {
    $('bootstrapScreen').classList.remove('hidden');
    $('adminApp').classList.add('hidden');
    return;
  }

  $('bootstrapScreen').classList.add('hidden');
  $('adminApp').classList.remove('hidden');
  $('adminIdentity').textContent = profile.full_name || session.user.email || 'Administrador';
  $('adminRoleLabel').textContent = roleLabel(profile.role);

  wireAdminEvents();
  await loadAdminDashboard();
}

async function loadAdminDashboard() {
  $('adminRefreshBtn').disabled = true;
  $('adminRefreshBtn').textContent = 'Atualizando...';
  try {
    adminState.data = await invokeAdmin('dashboard');
    renderAdminAll();
  } catch (error) {
    console.error(error);
    alert('Não foi possível carregar o painel administrativo: ' + error.message + '\n\nConfira se a Edge Function "nexo-admin" foi publicada com Verify JWT desativado.');
  } finally {
    $('adminRefreshBtn').disabled = false;
    $('adminRefreshBtn').textContent = '↻ Atualizar';
  }
}

function renderAdminAll() {
  const s = adminState.data.summary || {};
  $('adminUsersCount').textContent = s.users || 0;
  $('adminActiveSubsCount').textContent = s.active_subscriptions || 0;
  $('adminPendingActivationsCount').textContent = s.pending_activations || 0;
  $('adminOpenTicketsCount').textContent = s.open_tickets || 0;

  renderOverview();
  renderUsers();
  renderActivations();
  renderSupport();
  renderAudit();
}

function userName(user) {
  return user?.full_name || user?.email || 'Usuário';
}

function renderOverview() {
  const pending = (adminState.data.requests || []).filter(r => r.status === 'pending').slice(0,4);
  $('overviewActivations').innerHTML = pending.length ? pending.map(r => `
    <div class="admin-row-card">
      <div class="admin-row-card-main"><strong>${esc(r.user_name || r.user_email || 'Usuário')}</strong><small>${esc(r.user_email || '')} · ${fmtDateTime(r.created_at)}</small></div>
      <div class="admin-row-actions"><button class="mini-btn success" data-approve-request="${r.id}">Aprovar</button></div>
    </div>`).join('') : '<div class="admin-empty">Nenhuma ativação pendente. 🎉</div>';

  const tickets = (adminState.data.tickets || []).filter(t => ['open','in_progress'].includes(t.status)).slice(0,4);
  $('overviewTickets').innerHTML = tickets.length ? tickets.map(t => `
    <div class="admin-row-card">
      <div class="admin-row-card-main"><strong>${esc(t.name || t.email)}</strong><small>${esc(t.subject)} · ${fmtDateTime(t.created_at)}</small></div>
      <span class="admin-status-badge ${t.status}">${ticketLabel(t.status)}</span>
    </div>`).join('') : '<div class="admin-empty">Nenhum chamado aberto.</div>';

  const recentUsers = [...(adminState.data.users || [])].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,6);
  $('overviewUsers').innerHTML = usersTable(recentUsers, false);
}

function usersTable(users, actions = true) {
  if (!users.length) return '<div class="admin-empty">Nenhum usuário encontrado.</div>';
  return `<table class="admin-table"><thead><tr><th>Usuário</th><th>Cadastro</th><th>Último acesso</th><th>Assinatura</th><th>Status</th>${actions?'<th></th>':''}</tr></thead><tbody>${users.map(u => {
    const banned = isBanned(u);
    return `<tr>
      <td><strong>${esc(userName(u))}</strong><small>${esc(u.email || '')}</small></td>
      <td>${fmtDateTime(u.created_at)}</td>
      <td>${fmtDateTime(u.last_sign_in_at)}</td>
      <td><span class="admin-status-badge ${u.subscription?.status || 'cancelled'}">${subscriptionLabel(u.subscription?.status)}</span></td>
      <td><span class="admin-status-badge ${banned?'banned':'active'}">${banned?'Bloqueado':'Ativo'}</span>${u.force_password_change?'<small>Troca de senha pendente</small>':''}</td>
      ${actions?`<td><button class="mini-btn" data-manage-user="${u.id}">Gerenciar</button></td>`:''}
    </tr>`;
  }).join('')}</tbody></table>`;
}

function renderUsers() {
  const q = String($('adminUserSearch')?.value || '').trim().toLowerCase();
  const users = (adminState.data.users || []).filter(u => !q || `${u.full_name || ''} ${u.email || ''}`.toLowerCase().includes(q));
  $('adminUsersTable').innerHTML = usersTable(users, true);
}

function renderActivations() {
  const requests = adminState.data.requests || [];
  if (!requests.length) {
    $('adminActivationList').innerHTML = '<div class="admin-empty">Nenhuma solicitação de assinatura.</div>';
    return;
  }
  $('adminActivationList').innerHTML = requests.map(r => `
    <div class="admin-row-card">
      <div class="admin-row-card-main">
        <strong>${esc(r.user_name || r.user_email || 'Usuário')}</strong>
        <small>${esc(r.user_email || '')} · solicitada em ${fmtDateTime(r.created_at)}</small>
        ${r.admin_note?`<small>Nota: ${esc(r.admin_note)}</small>`:''}
      </div>
      <div class="admin-row-actions">
        <span class="admin-status-badge ${r.status}">${requestLabel(r.status)}</span>
        ${r.status==='pending'?`<button class="mini-btn success" data-approve-request="${r.id}">Aprovar</button><button class="mini-btn danger" data-reject-request="${r.id}">Recusar</button>`:''}
      </div>
    </div>`).join('');
}

function renderSupport() {
  const tickets = adminState.data.tickets || [];
  if (!tickets.length) {
    $('adminSupportList').innerHTML = '<div class="admin-empty">Nenhuma solicitação de suporte.</div>';
    return;
  }
  $('adminSupportList').innerHTML = tickets.map(t => `
    <div class="admin-row-card">
      <div class="admin-row-card-main">
        <strong>${esc(t.name || t.email)}</strong>
        <small>${esc(t.email)} · ${esc(t.subject)} · ${fmtDateTime(t.created_at)}</small>
        ${t.message?`<div class="admin-note">${esc(t.message)}</div>`:''}
        ${t.resolution_note?`<small>Resolução: ${esc(t.resolution_note)}</small>`:''}
      </div>
      <div class="admin-row-actions">
        <span class="admin-status-badge ${t.status}">${ticketLabel(t.status)}</span>
        ${t.linked_user_id?`<button class="mini-btn" data-manage-user="${t.linked_user_id}">Gerenciar usuário</button>`:''}
        ${t.status==='open'?`<button class="mini-btn" data-ticket-progress="${t.id}">Atender</button>`:''}
        ${['open','in_progress'].includes(t.status)?`<button class="mini-btn success" data-ticket-resolve="${t.id}">Resolver</button>`:''}
      </div>
    </div>`).join('');
}

function renderAudit() {
  const rows = adminState.data.audit || [];
  if (!rows.length) {
    $('adminAuditTable').innerHTML = '<div class="admin-empty">Nenhuma ação administrativa registrada.</div>';
    return;
  }
  $('adminAuditTable').innerHTML = `<table class="admin-table"><thead><tr><th>Data</th><th>Administrador</th><th>Ação</th><th>Usuário / Entidade</th></tr></thead><tbody>${rows.map(a => `<tr>
    <td>${fmtDateTime(a.created_at)}</td>
    <td>${esc(a.admin_name || 'Sistema')}</td>
    <td><span class="admin-code">${esc(a.action)}</span></td>
    <td>${esc(a.target_name || a.entity_type || '—')}</td>
  </tr>`).join('')}</tbody></table>`;
}

function switchAdminView(view) {
  adminState.view = view;
  document.querySelectorAll('.admin-nav-item').forEach(b => b.classList.toggle('active', b.dataset.adminView === view));
  document.querySelectorAll('.admin-view').forEach(v => v.classList.remove('active'));
  $(view+'AdminView').classList.add('active');
  const titles = { overview:'Visão geral', users:'Usuários', activations:'Assinaturas', support:'Suporte', audit:'Auditoria' };
  $('adminViewTitle').textContent = titles[view] || 'Administração';
}

function openUserModal(userId) {
  const u = (adminState.data.users || []).find(x => x.id === userId);
  if (!u) return;
  adminState.selectedUser = u;
  $('adminManagedUserId').value = u.id;
  $('adminUserModalTitle').textContent = userName(u);
  $('adminManagedAvatar').textContent = avatarText(u.full_name, u.email);
  $('adminManagedName').textContent = userName(u);
  $('adminManagedEmail').textContent = u.email || '—';
  $('adminManagedMeta').textContent = `${roleLabel(u.role)} · cadastro ${fmtDateTime(u.created_at)} · último acesso ${fmtDateTime(u.last_sign_in_at)}`;
  $('adminManagedStatus').textContent = isBanned(u) ? 'Bloqueado' : 'Ativo';
  $('adminManagedStatus').className = `admin-status-badge ${isBanned(u)?'banned':'active'}`;
  $('adminNewEmail').value = u.email || '';
  $('temporaryPasswordBox').classList.add('hidden');

  const sub = u.subscription;
  $('adminManagedSubscriptionInfo').textContent = sub ? `${subscriptionLabel(sub.status)} · início ${fmtDate(sub.started_at)} · próxima cobrança ${fmtDate(sub.next_billing_at)}` : 'Sem assinatura cadastrada.';
  $('adminSubscriptionStatus').value = sub?.status || 'active';
  $('updateSubscriptionStatusBtn').disabled = !sub;

  $('toggleUserBanBtn').textContent = isBanned(u) ? 'Desbloquear usuário' : 'Bloquear usuário';
  $('toggleUserBanBtn').className = isBanned(u) ? 'btn btn-light' : 'btn btn-danger';
  $('adminUserModal').showModal();
}

async function approveRequest(id) {
  const nextBilling = prompt('Próxima cobrança na InfinitePay (AAAA-MM-DD). Se não souber, deixe vazio:') || '';
  if (nextBilling && !/^\d{4}-\d{2}-\d{2}$/.test(nextBilling)) return alert('Use o formato AAAA-MM-DD.');
  if (!confirm('Confirmar que você verificou o pagamento/assinatura na InfinitePay e deseja liberar o NEXO?')) return;
  try {
    await invokeAdmin('approve_activation', { request_id:id, next_billing_at:nextBilling || null });
    await loadAdminDashboard();
  } catch (e) { alert('Erro: '+e.message); }
}

async function rejectRequest(id) {
  const note = prompt('Motivo da recusa (opcional):') || '';
  if (!confirm('Recusar esta solicitação de ativação?')) return;
  try {
    await invokeAdmin('reject_activation', { request_id:id, admin_note:note });
    await loadAdminDashboard();
  } catch (e) { alert('Erro: '+e.message); }
}

function wireAdminEvents() {
  if (document.body.dataset.adminWired === '1') return;
  document.body.dataset.adminWired = '1';

  $('adminLogoutBtn').addEventListener('click', async()=>{ await sb.auth.signOut({scope:'local'}); window.location.href='index.html'; });
  $('adminRefreshBtn').addEventListener('click', loadAdminDashboard);
  $('adminUserSearch').addEventListener('input', renderUsers);

  document.querySelectorAll('.admin-nav-item').forEach(btn => btn.addEventListener('click', ()=>switchAdminView(btn.dataset.adminView)));
  document.querySelectorAll('[data-admin-jump]').forEach(btn => btn.addEventListener('click', ()=>switchAdminView(btn.dataset.adminJump)));
  document.querySelectorAll('[data-admin-close]').forEach(btn => btn.addEventListener('click', ()=>$(btn.dataset.adminClose).close()));

  document.body.addEventListener('click', async e => {
    const manage = e.target.closest('[data-manage-user]');
    if (manage) return openUserModal(manage.dataset.manageUser);
    const approve = e.target.closest('[data-approve-request]');
    if (approve) return approveRequest(approve.dataset.approveRequest);
    const reject = e.target.closest('[data-reject-request]');
    if (reject) return rejectRequest(reject.dataset.rejectRequest);
    const progress = e.target.closest('[data-ticket-progress]');
    if (progress) {
      try { await invokeAdmin('update_ticket', { ticket_id:progress.dataset.ticketProgress, status:'in_progress' }); await loadAdminDashboard(); }
      catch(err){ alert('Erro: '+err.message); }
      return;
    }
    const resolve = e.target.closest('[data-ticket-resolve]');
    if (resolve) {
      const note = prompt('Como o chamado foi resolvido?') || '';
      try { await invokeAdmin('update_ticket', { ticket_id:resolve.dataset.ticketResolve, status:'resolved', resolution_note:note }); await loadAdminDashboard(); }
      catch(err){ alert('Erro: '+err.message); }
      return;
    }
  });

  $('generateTempPasswordBtn').addEventListener('click', async()=>{
    const u = adminState.selectedUser; if(!u) return;
    if(!confirm(`Gerar uma nova senha temporária para ${userName(u)}? A senha atual deixará de funcionar.`)) return;
    try {
      const data = await invokeAdmin('reset_password', { user_id:u.id });
      $('temporaryPasswordValue').textContent = data.temporary_password;
      $('temporaryPasswordBox').classList.remove('hidden');
      alert('Senha temporária criada. Entregue-a ao usuário por um canal seguro.');
      await loadAdminDashboard();
    } catch(e){ alert('Erro: '+e.message); }
  });

  $('copyTemporaryPasswordBtn').addEventListener('click', async()=>{
    const value = $('temporaryPasswordValue').textContent;
    try { await navigator.clipboard.writeText(value); $('copyTemporaryPasswordBtn').textContent='Copiado!'; setTimeout(()=>$('copyTemporaryPasswordBtn').textContent='Copiar',1200); }
    catch(_){ alert('Copie manualmente: '+value); }
  });

  $('updateAdminEmailBtn').addEventListener('click', async()=>{
    const u=adminState.selectedUser; if(!u)return;
    const email=$('adminNewEmail').value.trim();
    if(!email)return alert('Informe o novo e-mail.');
    if(!confirm(`Alterar o e-mail de ${userName(u)} para ${email}?`))return;
    try { await invokeAdmin('update_email',{user_id:u.id,email}); $('adminUserModal').close(); await loadAdminDashboard(); }
    catch(e){alert('Erro: '+e.message);}
  });

  $('updateSubscriptionStatusBtn').addEventListener('click', async()=>{
    const u=adminState.selectedUser; if(!u?.subscription)return;
    const status=$('adminSubscriptionStatus').value;
    if(!confirm(`Alterar a assinatura para "${subscriptionLabel(status)}"?`))return;
    try { await invokeAdmin('set_subscription_status',{user_id:u.id,status}); $('adminUserModal').close(); await loadAdminDashboard(); }
    catch(e){alert('Erro: '+e.message);}
  });

  $('toggleUserBanBtn').addEventListener('click', async()=>{
    const u=adminState.selectedUser; if(!u)return;
    const banned=isBanned(u);
    if(!confirm(`${banned?'Desbloquear':'Bloquear'} o acesso de ${userName(u)}?`))return;
    try { await invokeAdmin(banned?'unban_user':'ban_user',{user_id:u.id}); $('adminUserModal').close(); await loadAdminDashboard(); }
    catch(e){alert('Erro: '+e.message);}
  });
}

$('claimOwnerBtn').addEventListener('click', async()=>{
  if(!confirm('Definir esta conta como PROPRIETÁRIA do NEXO Financeiro?'))return;
  $('claimOwnerBtn').disabled=true;
  $('bootstrapMessage').textContent='Ativando...';
  try{
    const {data,error}=await sb.rpc('claim_nexo_owner');
    if(error)throw error;
    $('bootstrapMessage').dataset.type='success';
    $('bootstrapMessage').textContent='Painel administrativo ativado! Recarregando...';
    setTimeout(()=>location.reload(),700);
  }catch(e){
    $('bootstrapMessage').dataset.type='error';
    $('bootstrapMessage').textContent=e.message;
    $('claimOwnerBtn').disabled=false;
  }
});

initAdmin();
