const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const adminState = {
  session: null,
  user: null,
  profile: null,
  data: { users: [], subscriptions: [], payments: [], tickets: [], support_benefits: [], plans: [], audit: [], provider_settings: null, summary: {} },
  selectedUser: null,
  view: 'overview'
};

const $ = id => document.getElementById(id);
const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const fmtDateTime = v => v ? new Date(v).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }) : '—';
const fmtDate = v => v ? new Date(String(v).slice(0,10)+'T12:00:00').toLocaleDateString('pt-BR') : '—';
const money = v => Number(v || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

function roleLabel(role) {
  return { owner:'Proprietário', admin:'Administrador', support:'Suporte', user:'Usuário' }[role] || 'Usuário';
}
function subscriptionLabel(status) {
  return { active:'Ativa', trialing:'Teste', past_due:'Pagamento pendente', grace:'Carência', support:'NEXO Apoio', suspended:'Suspensa', cancelled:'Cancelada' }[status] || 'Sem assinatura';
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
  $('adminMrr').textContent = money(s.mrr || 0);
  $('adminOpenTicketsCount').textContent = s.open_tickets || 0;
  $('adminPendingBenefitsCount').textContent = s.pending_support_benefits || 0;
  const navCount=$('supportBenefitNavCount'); if(navCount){navCount.textContent=s.pending_support_benefits||0;navCount.classList.toggle('hidden',!(s.pending_support_benefits||0));}

  renderOverview();
  renderUsers();
  renderSubscriptions();
  renderSupport();
  renderBenefits();
  renderAudit();
}

function userName(user) {
  return user?.full_name || user?.email || 'Usuário';
}

function adminPlanById(planId) {
  return (adminState.data.plans || []).find(p => p.id === planId) || null;
}

function adminPlanName(sub) {
  const p=adminPlanById(sub?.plan_id);
  return p?.name || (['trialing','grace'].includes(sub?.status)?'NEXO Pro · teste':'NEXO');
}

function renderOverview() {
  const subs = [...(adminState.data.subscriptions || [])].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,5);
  $('overviewSubscriptions').innerHTML = subs.length ? subs.map(sub => {
    const user = (adminState.data.users || []).find(u => u.id === sub.user_id);
    return `<div class="admin-row-card">
      <div class="admin-row-card-main"><strong>${esc(userName(user))}</strong><small>${esc(user?.email || '')} · ${esc(adminPlanName(sub))} · próxima cobrança ${fmtDate(sub.next_billing_at)}</small></div>
      <span class="admin-status-badge ${sub.status}">${subscriptionLabel(sub.status)}</span>
    </div>`;
  }).join('') : '<div class="admin-empty">Nenhuma assinatura cadastrada.</div>';

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
      <td><strong>${esc(adminPlanName(u.subscription))}</strong><small><span class="admin-status-badge ${u.subscription?.status || 'cancelled'}">${subscriptionLabel(u.subscription?.status)}</span></small></td>
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

function renderSubscriptions() {
  const settings = adminState.data.provider_settings;
  const badge = $('asaasIntegrationBadge');
  const btn = $('configureAsaasBtn');
  const info = $('asaasIntegrationInfo');
  const configured = Boolean(settings?.webhook_id);
  badge.textContent = configured ? 'Conectado' : 'Não configurado';
  badge.className = `admin-status-badge ${configured ? 'active' : 'cancelled'}`;
  btn.disabled = configured;
  btn.textContent = configured ? 'Asaas conectado ✓' : 'Conectar Asaas';
  info.textContent = configured
    ? `Webhook ativo · ambiente ${settings.environment === 'sandbox' ? 'Sandbox' : 'Produção'} · configurado em ${fmtDateTime(settings.configured_at)}`
    : 'Conecte uma vez para o NEXO criar checkouts e receber confirmações automaticamente.';

  const s = adminState.data.summary || {};
  $('adminSubsActiveMetric').textContent = s.active_subscriptions || 0;
  $('adminSubsOverdueMetric').textContent = s.overdue_subscriptions || 0;
  $('adminSubsMrrMetric').textContent = money(s.mrr || 0);

  const subs = adminState.data.subscriptions || [];
  if (!subs.length) {
    $('adminSubscriptionList').innerHTML = '<div class="admin-empty">Nenhuma assinatura cadastrada.</div>';
  } else {
    $('adminSubscriptionList').innerHTML = `<table class="admin-table"><thead><tr><th>Cliente</th><th>Plano</th><th>Status</th><th>Provedor</th><th>Último pagamento</th><th>Próxima cobrança</th></tr></thead><tbody>${subs.map(sub => {
      const u=(adminState.data.users||[]).find(x=>x.id===sub.user_id);
      return `<tr><td><strong>${esc(userName(u))}</strong><small>${esc(u?.email||'')}</small></td><td><strong>${esc(adminPlanName(sub))}</strong></td><td><span class="admin-status-badge ${sub.status}">${subscriptionLabel(sub.status)}</span></td><td>${esc(String(sub.provider||'—').toUpperCase())}</td><td>${fmtDateTime(sub.last_payment_at)}</td><td>${fmtDate(sub.next_billing_at)}</td></tr>`;
    }).join('')}</tbody></table>`;
  }

  const payments = adminState.data.payments || [];
  if (!payments.length) {
    $('adminPaymentsList').innerHTML = '<div class="admin-empty">Nenhum pagamento de assinatura recebido ainda.</div>';
  } else {
    $('adminPaymentsList').innerHTML = `<table class="admin-table"><thead><tr><th>Cliente</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Método</th></tr></thead><tbody>${payments.slice(0,100).map(p => {
      const u=(adminState.data.users||[]).find(x=>x.id===p.user_id);
      return `<tr><td><strong>${esc(userName(u))}</strong><small>${esc(u?.email||'')}</small></td><td>${fmtDate(p.due_date)}</td><td>${money(p.amount)}</td><td><span class="admin-status-badge ${p.status==='received'||p.status==='confirmed'?'active':p.status==='overdue'||p.status==='failed'?'past_due':'cancelled'}">${esc(paymentLabel(p.status))}</span></td><td>${esc(p.billing_type||'—')}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
}

function paymentLabel(status) {
  return {pending:'Pendente',confirmed:'Confirmado',received:'Recebido',overdue:'Vencido',failed:'Falhou',refunded:'Estornado',chargeback:'Chargeback',cancelled:'Cancelado'}[status] || status || '—';
}

async function configureAsaas() {
  if (!confirm('Conectar o NEXO ao Asaas e criar o webhook automático de pagamentos?')) return;
  const btn=$('configureAsaasBtn');
  btn.disabled=true; btn.textContent='Conectando...';
  try {
    const data=await invokeAdmin('configure_asaas_webhook');
    alert(data.already_configured ? 'A integração Asaas já estava configurada.' : 'Asaas conectado! O NEXO já pode ativar assinaturas automaticamente.');
    await loadAdminDashboard();
  } catch(e) {
    alert('Não foi possível conectar o Asaas: '+e.message);
    btn.disabled=false; btn.textContent='Conectar Asaas';
  }
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


function benefitStatusLabel(status) {
  return {pending:'Em análise',approved:'Aprovado',rejected:'Recusado',cancelled:'Cancelado'}[status] || status || '—';
}

function renderBenefits() {
  const rows=adminState.data.support_benefits || [];
  if(!rows.length){$('adminBenefitsList').innerHTML='<div class="admin-empty">Nenhuma solicitação do NEXO Apoio.</div>';return;}
  const canReview=['owner','admin'].includes(adminState.profile?.role);
  $('adminBenefitsList').innerHTML=rows.map(r=>{
    const u=(adminState.data.users||[]).find(x=>x.id===r.user_id);
    return `<div class="admin-row-card support-benefit-row">
      <div class="admin-row-card-main">
        <strong>${esc(userName(u))}</strong>
        <small>${esc(u?.email||'')} · desligamento ${fmtDate(r.unemployment_date)} · solicitado ${fmtDateTime(r.created_at)}</small>
        ${r.customer_message?`<div class="admin-note">${esc(r.customer_message)}</div>`:''}
        ${r.status==='approved'?`<small>Extensão: ${fmtDate(r.extension_start)} até ${fmtDate(r.extension_end)}</small>`:''}
        ${r.decision_note?`<small>Observação: ${esc(r.decision_note)}</small>`:''}
      </div>
      <div class="admin-row-actions">
        <span class="admin-status-badge ${r.status==='approved'?'active':r.status==='pending'?'in_progress':'cancelled'}">${benefitStatusLabel(r.status)}</span>
        ${canReview&&r.status==='pending'&&r.document_path?`<button class="mini-btn" data-benefit-doc="${r.id}">Ver comprovante</button>`:''}
        ${canReview&&r.status==='pending'?`<button class="mini-btn success" data-benefit-approve="${r.id}">Aprovar +30 dias</button><button class="mini-btn danger" data-benefit-reject="${r.id}">Recusar</button>`:''}
        <button class="mini-btn" data-manage-user="${r.user_id}">Gerenciar usuário</button>
      </div>
    </div>`;
  }).join('');
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
  const titles = { overview:'Visão geral', users:'Usuários', activations:'Assinaturas', support:'Suporte', benefits:'NEXO Apoio', audit:'Auditoria' };
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
  $('adminManagedProtection').textContent = `${u.cpf_last4 ? 'CPF final '+u.cpf_last4 : 'CPF legado/não vinculado'} · Modo Proteção ${u.protection_mode?'ativo':'desativado'}`;
  $('adminManagedStatus').textContent = isBanned(u) ? 'Bloqueado' : 'Ativo';
  $('adminManagedStatus').className = `admin-status-badge ${isBanned(u)?'banned':'active'}`;
  $('adminNewEmail').value = u.email || '';
  $('temporaryPasswordBox').classList.add('hidden');

  const sub = u.subscription;
  $('adminManagedSubscriptionInfo').textContent = sub ? `${adminPlanName(sub)} · ${subscriptionLabel(sub.status)} · teste até ${fmtDate(sub.trial_ends_at)} · carência até ${fmtDate(sub.grace_ends_at)}${sub.support_extension_ends_at?' · Apoio até '+fmtDate(sub.support_extension_ends_at):''} · próxima cobrança ${fmtDate(sub.next_billing_at)}` : 'Sem assinatura cadastrada.';
  $('adminSubscriptionStatus').value = sub?.status || 'active';
  $('updateSubscriptionStatusBtn').disabled = !sub;

  $('toggleUserBanBtn').textContent = isBanned(u) ? 'Desbloquear usuário' : 'Bloquear usuário';
  $('toggleUserBanBtn').className = isBanned(u) ? 'btn btn-light' : 'btn btn-danger';
  $('adminUserModal').showModal();
}

function wireAdminEvents() {
  if (document.body.dataset.adminWired === '1') return;
  document.body.dataset.adminWired = '1';

  $('adminLogoutBtn').addEventListener('click', async()=>{ await sb.auth.signOut({scope:'local'}); window.location.href='index.html'; });
  $('adminRefreshBtn').addEventListener('click', loadAdminDashboard);
  $('adminUserSearch').addEventListener('input', renderUsers);
  $('configureAsaasBtn').addEventListener('click', configureAsaas);

  document.querySelectorAll('.admin-nav-item').forEach(btn => btn.addEventListener('click', ()=>switchAdminView(btn.dataset.adminView)));
  document.querySelectorAll('[data-admin-jump]').forEach(btn => btn.addEventListener('click', ()=>switchAdminView(btn.dataset.adminJump)));
  document.querySelectorAll('[data-admin-close]').forEach(btn => btn.addEventListener('click', ()=>$(btn.dataset.adminClose).close()));

  document.body.addEventListener('click', async e => {
    const manage = e.target.closest('[data-manage-user]');

    if (manage) return openUserModal(manage.dataset.manageUser);
    const benefitDoc=e.target.closest('[data-benefit-doc]');
    if(benefitDoc){
      try{const data=await invokeAdmin('get_support_benefit_document_url',{request_id:benefitDoc.dataset.benefitDoc});window.open(data.url,'_blank','noopener');}
      catch(err){alert('Não foi possível abrir o comprovante: '+err.message);} return;
    }
    const approveBenefit=e.target.closest('[data-benefit-approve]');
    if(approveBenefit){
      if(!confirm('Confirmou o desligamento na CTPS Digital? O NEXO concederá +30 dias e apagará o comprovante.'))return;
      const note=prompt('Observação da análise (opcional):')||'';
      try{const data=await invokeAdmin('approve_support_benefit',{request_id:approveBenefit.dataset.benefitApprove,note});alert(`NEXO Apoio aprovado: ${fmtDate(data.extension_start)} até ${fmtDate(data.extension_end)}.`);await loadAdminDashboard();}
      catch(err){alert('Erro: '+err.message);} return;
    }
    const rejectBenefit=e.target.closest('[data-benefit-reject]');
    if(rejectBenefit){
      const note=prompt('Informe brevemente o motivo da recusa:'); if(note===null)return;
      try{await invokeAdmin('reject_support_benefit',{request_id:rejectBenefit.dataset.benefitReject,note});await loadAdminDashboard();}
      catch(err){alert('Erro: '+err.message);} return;
    }
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
