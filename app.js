const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const state = {
  user: null,
  profile: null,
  accounts: [],
  cards: [],
  categories: [],
  incomeSources: [],
  transactions: [],
  invoices: [],
  invoicePayments: [],
  plans: [],
  plan: null,
  entitlements: { plan_code: 'nexo-essencial', can_use_support: false, can_use_protection: false, effective_status: 'loading' },
  subscription: null,
  checkoutSession: null,
  supportBenefitRequest: null,
  accessStatus: 'loading',
  protectionSpendResolver: null,
  billingReturnHandled: false,
  billingLoaded: false,
  selectedMonth: '',
  transactionType: 'expense'
};

const $ = (id) => document.getElementById(id);
const money = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const isoToday = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};
const parseMoney = (value) => {
  if (typeof value === 'number') return value;
  const cleaned = String(value || '').trim().replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  return Number(cleaned || 0);
};
const escapeHtml = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const fmtDate = (date) => date ? new Date(date + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const uid = () => state.user?.id;

const addDaysIso = (dateString, days) => {
  const d = new Date(`${dateString}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
};
const daysUntil = (dateString) => {
  if (!dateString) return null;
  const a = new Date(`${isoToday()}T12:00:00`);
  const b = new Date(`${dateString}T12:00:00`);
  return Math.ceil((b-a)/86400000);
};
const isStaff = () => ['owner','admin','support'].includes(state.profile?.role);

function effectiveStatusFromSubscription(sub = state.subscription) {
  if (isStaff()) return 'active';
  if (!sub) return 'suspended';
  if (sub.status === 'active') return 'active';
  const today = isoToday();
  if (sub.support_extension_start && sub.support_extension_ends_at && today >= sub.support_extension_start && today <= sub.support_extension_ends_at) return 'support';
  if (sub.trial_ends_at && today <= sub.trial_ends_at && ['trialing','grace','support'].includes(sub.status)) return 'trialing';
  if (sub.grace_ends_at && today <= sub.grace_ends_at && ['trialing','grace','support'].includes(sub.status)) return 'grace';
  return sub.status || 'suspended';
}

function hasWriteAccess() {
  if (isStaff()) return true;
  return ['active','trialing','grace','support'].includes(state.accessStatus || effectiveStatusFromSubscription());
}

function requireWriteAccess() {
  if (hasWriteAccess()) return true;
  alert('Seu NEXO está em modo somente leitura. Seus dados continuam aqui, mas é necessário regularizar a assinatura para fazer alterações.');
  switchView('subscription');
  return false;
}

const DEFAULT_PLANS = [
  {
    code: 'nexo-essencial', name: 'NEXO Essencial',
    description: 'Organização financeira completa para contas, cartões, faturas e planejamento.',
    price: 19.90, theme_key: 'essential', includes_support: false, includes_protection: false, sort_order: 10
  },
  {
    code: 'nexo-plus', name: 'NEXO Plus',
    description: 'Tudo do Essencial, com o benefício NEXO Apoio em caso de desemprego.',
    price: 29.90, theme_key: 'plus', includes_support: true, includes_protection: false, sort_order: 20
  },
  {
    code: 'nexo-pro', name: 'NEXO Pro',
    description: 'Experiência premium com NEXO Apoio e Proteção Financeira completa.',
    price: 39.90, theme_key: 'pro', includes_support: true, includes_protection: true, sort_order: 30
  }
];
const DEFAULT_PLAN = DEFAULT_PLANS[0];

function planByCode(code) {
  return state.plans.find(p => p.code === code) || DEFAULT_PLANS.find(p => p.code === code) || DEFAULT_PLAN;
}

function currentPlanCode() {
  if (isStaff()) return 'nexo-pro';
  if (state.entitlements?.plan_code) return state.entitlements.plan_code;
  if (['trialing','grace'].includes(subscriptionStatusKey())) return 'nexo-pro';
  const byIdPlan = state.plans.find(p => p.id === state.subscription?.plan_id);
  return byIdPlan?.code || 'nexo-essencial';
}

function currentPlan() {
  return planByCode(currentPlanCode());
}

function canUseSupport() {
  return isStaff() || Boolean(state.entitlements?.can_use_support);
}

function canUseProtection() {
  return isStaff() || Boolean(state.entitlements?.can_use_protection);
}

function applyPlanTheme() {
  const code = currentPlanCode();
  const theme = code === 'nexo-pro' ? 'pro' : code === 'nexo-plus' ? 'plus' : 'essential';
  document.body.classList.remove('theme-essential','theme-plus','theme-pro');
  document.body.classList.add(`theme-${theme}`);
  document.documentElement.dataset.nexoTheme = theme;

  const badge = $('planThemeBadge');
  if (badge) {
    const labels = { essential:'ESSENCIAL', plus:'PLUS', pro:'PRO' };
    badge.textContent = labels[theme];
    badge.className = `plan-theme-badge plan-theme-${theme}`;
  }
}

const monthLabel = (month) => {
  if (!month) return '—';
  const [y,m] = month.split('-').map(Number);
  return new Date(y, m-1, 1, 12).toLocaleDateString('pt-BR', { month:'long', year:'numeric' });
};

function invoiceTotal(invoiceId) {
  return state.transactions
    .filter(t => t.invoice_id === invoiceId && t.payment_method === 'credit' && t.status !== 'cancelled')
    .reduce((s,t)=>s+Number(t.amount||0),0);
}

function invoiceOutstanding(invoice) {
  return Math.max(0, invoiceTotal(invoice.id) - Number(invoice.amount_paid || 0));
}

function invoiceComputedStatus(invoice) {
  const total = invoiceTotal(invoice.id);
  const paid = Number(invoice.amount_paid || 0);
  if (total > 0 && paid >= total - 0.009) return 'paid';
  if (paid > 0) return 'partial';
  if (invoice.due_date < isoToday()) return 'overdue';
  return 'open';
}

function invoiceStatusLabel(invoice) {
  return {paid:'Paga',partial:'Parcial',overdue:'Atrasada',open:'Em aberto'}[invoiceComputedStatus(invoice)] || 'Em aberto';
}

function invoiceForTransaction(t) {
  return t.invoice_id ? state.invoices.find(i => i.id === t.invoice_id) : null;
}

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2,'0')}-01`;
  const last = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
  return { start, end };
}

function addMonths(dateString, months) {
  const d = new Date(dateString + 'T12:00:00');
  const targetDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(targetDay, last));
  return d.toISOString().slice(0, 10);
}

function dateWithDay(year, monthIndex, day) {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  const d = new Date(year, monthIndex, Math.min(day, last), 12);
  return d.toISOString().slice(0, 10);
}

function firstCardDueDate(purchaseDate, closingDay, dueDay) {
  const d = new Date(purchaseDate + 'T12:00:00');
  let closeMonth = d.getMonth();
  let closeYear = d.getFullYear();
  if (d.getDate() >= Number(closingDay || 28)) {
    closeMonth += 1;
    if (closeMonth > 11) { closeMonth = 0; closeYear += 1; }
  }
  let dueMonth = closeMonth;
  let dueYear = closeYear;
  if (Number(dueDay || 7) <= Number(closingDay || 28)) {
    dueMonth += 1;
    if (dueMonth > 11) { dueMonth = 0; dueYear += 1; }
  }
  return dateWithDay(dueYear, dueMonth, Number(dueDay || 7));
}

function statusOf(t) {
  if (t.status === 'cancelled') return 'cancelled';
  if (t.status === 'paid') return 'paid';
  if (t.type === 'expense' && t.payment_method === 'credit') return 'invoice';
  if (t.due_date < isoToday()) return 'overdue';
  return 'pending';
}

function statusLabel(t) {
  const s = statusOf(t);
  if (s === 'invoice') {
    const inv = invoiceForTransaction(t);
    if (inv && Number(inv.amount_paid || 0) > 0) return 'Fatura parcial';
    return 'Na fatura';
  }
  return { paid:'Pago', pending:'Pendente', overdue:'Atrasado', cancelled:'Cancelado' }[s];
}

function byId(list, id) { return list.find(x => x.id === id); }

async function init() {
  if (!window.SUPABASE_URL || window.SUPABASE_URL.includes('SEU-PROJETO')) {
    alert('Configure supabase-config.js com a URL e a chave pública do Supabase.');
    return;
  }

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  state.user = session.user;

  const now = new Date();
  state.selectedMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  $('monthFilter').value = state.selectedMonth;
  $('transactionPurchaseDate').value = isoToday();
  $('transactionDueDate').value = isoToday();

  wireEvents();

  // Carrega os dados UMA vez e já libera a interface.
  await loadData();

  // Senhas temporárias geradas pelo suporte exigem troca no próximo acesso.
  if (state.profile?.force_password_change) {
    window.location.href = 'change-password.html';
    return;
  }

  const defaultsCreated = await ensureDefaults();
  if (defaultsCreated) await loadData();
  renderAll();

  // Assinatura carrega separadamente e também calcula trial/carência/acesso.
  const billingPromise = loadBillingData();

  // A sincronização das faturas roda em segundo plano.
  // Assim ela não segura a abertura do sistema.
  setTimeout(async () => {
    try {
      await billingPromise;
      if (!hasWriteAccess()) return;
      const changed = await syncCardInvoices();
      if (changed) {
        await loadData();
        renderAll();
      }
    } catch (error) {
      console.error('Erro ao sincronizar faturas em segundo plano:', error);
    }
  }, 0);
}

async function loadData() {
  const [profile, accounts, cards, categories, incomeSources, transactions, invoices, invoicePayments] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid()).maybeSingle(),
    sb.from('accounts').select('*').eq('user_id', uid()).eq('is_active', true).order('created_at'),
    sb.from('cards').select('*').eq('user_id', uid()).eq('is_active', true).order('created_at'),
    sb.from('categories').select('*').eq('user_id', uid()).eq('is_active', true).order('name'),
    sb.from('income_sources').select('*').eq('user_id', uid()).eq('is_active', true).order('name'),
    sb.from('transactions').select('*').eq('user_id', uid()).order('due_date', { ascending: false }).limit(2000),
    sb.from('card_invoices').select('*').eq('user_id', uid()).order('due_date', { ascending: false }).limit(500),
    sb.from('card_invoice_payments').select('*').eq('user_id', uid()).order('paid_at', { ascending: false }).limit(1000)
  ]);

  const errors = [profile, accounts, cards, categories, incomeSources, transactions, invoices, invoicePayments].map(r => r.error).filter(Boolean);
  if (errors.length) console.error(errors);

  state.profile = profile.data || null;
  state.accounts = accounts.data || [];
  state.cards = cards.data || [];
  state.categories = categories.data || [];
  state.incomeSources = incomeSources.data || [];
  state.transactions = transactions.data || [];
  state.invoices = invoices.data || [];
  state.invoicePayments = invoicePayments.data || [];
}


async function loadBillingData() {
  state.billingLoaded = false;
  renderSubscription();

  try {
    // Se um NEXO Apoio pago terminou, a Edge Function reativa a recorrência Asaas.
    try {
      await sb.functions.invoke('nexo-admin', { body:{ action:'sync_my_support_subscription' } });
    } catch (_) {}

    let refreshedStatus = null;
    try {
      const refreshed = await sb.rpc('refresh_my_subscription_status');
      if (!refreshed.error) refreshedStatus = refreshed.data || null;
    } catch (_) {}

    const [plansRes, subscriptionRes, checkoutRes, supportRes, entitlementsRes] = await Promise.all([
      sb.from('plans').select('*').eq('active', true).in('code',['nexo-essencial','nexo-plus','nexo-pro']).order('sort_order', { ascending:true }),
      sb.from('subscriptions').select('*').eq('user_id', uid()).maybeSingle(),
      sb.from('asaas_checkout_sessions').select('*').eq('user_id', uid()).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      sb.from('support_benefit_requests').select('*').eq('user_id', uid()).order('created_at', { ascending:false }).limit(1).maybeSingle(),
      sb.rpc('my_nexo_entitlements')
    ]);

    if (plansRes.error) console.warn('Planos ainda não disponíveis:', plansRes.error.message);
    if (subscriptionRes.error) console.warn('Assinatura ainda não disponível:', subscriptionRes.error.message);
    if (checkoutRes.error) console.warn('Checkout Asaas ainda não disponível:', checkoutRes.error.message);
    if (supportRes.error) console.warn('NEXO Apoio ainda não disponível:', supportRes.error.message);

    state.plans = plansRes.data?.length ? plansRes.data : DEFAULT_PLANS;
    state.subscription = subscriptionRes.data || null;
    state.checkoutSession = checkoutRes.data || null;
    state.supportBenefitRequest = supportRes.data || null;

    const ent = Array.isArray(entitlementsRes.data) ? entitlementsRes.data[0] : entitlementsRes.data;
    state.entitlements = ent || {
      plan_code: state.subscription?.status === 'trialing' || state.subscription?.status === 'grace' ? 'nexo-pro' : 'nexo-essencial',
      can_use_support: ['trialing','grace'].includes(state.subscription?.status),
      can_use_protection: ['trialing','grace'].includes(state.subscription?.status),
      effective_status: refreshedStatus || effectiveStatusFromSubscription(state.subscription)
    };

    const subPlan = state.plans.find(p => p.id === state.subscription?.plan_id);
    state.plan = subPlan || planByCode(state.entitlements.plan_code);
    state.accessStatus = refreshedStatus || state.entitlements?.effective_status || effectiveStatusFromSubscription(state.subscription);
  } catch (error) {
    console.warn('Não foi possível carregar a assinatura:', error);
    state.plans = DEFAULT_PLANS;
    state.plan = DEFAULT_PLAN;
    state.subscription = null;
    state.checkoutSession = null;
    state.supportBenefitRequest = null;
    state.entitlements = { plan_code:isStaff()?'nexo-pro':'nexo-essencial', can_use_support:isStaff(), can_use_protection:isStaff(), effective_status:isStaff()?'active':'suspended' };
    state.accessStatus = isStaff() ? 'active' : 'suspended';
  } finally {
    state.billingLoaded = true;
    renderAll();
    handleBillingReturn();
  }
}

function subscriptionStatusKey() {
  return state.subscription?.status || 'none';
}

function subscriptionStatusLabel(status = subscriptionStatusKey()) {
  return {
    active: 'Ativa',
    trialing: 'Período de teste',
    past_due: 'Pagamento pendente',
    grace: 'Em carência',
    support: 'NEXO Apoio',
    suspended: 'Suspensa',
    cancelled: 'Cancelada',
    none: 'Não assinante'
  }[status] || 'Não assinante';
}

function checkoutStatusLabel(status) {
  return {
    initiated: 'Preparando checkout',
    active: 'Aguardando pagamento',
    pending: 'Aguardando pagamento',
    paid: 'Pagamento concluído',
    canceled: 'Checkout cancelado',
    expired: 'Checkout expirado',
    failed: 'Falha ao criar checkout'
  }[status] || status || '—';
}

function planPrice(plan = state.plan || DEFAULT_PLAN) {
  return Number(plan?.price ?? 19.90);
}

function renderSubscription() {
  if (!$('subscriptionDetailPlan')) return;

  const subscription = state.subscription;
  const checkout = state.checkoutSession;
  const status = subscriptionStatusKey();
  const active = status === 'active';
  const current = currentPlan();
  const trialPro = ['trialing','grace'].includes(state.accessStatus || status);

  $('subscriptionDetailPlan').textContent = trialPro ? 'NEXO Pro · período de teste' : (current?.name || 'NEXO');
  $('subscriptionDetailStatus').textContent = state.billingLoaded ? subscriptionStatusLabel(status) : 'Carregando...';
  $('subscriptionDetailStarted').textContent = subscription?.started_at ? fmtDate(String(subscription.started_at).slice(0,10)) : '—';
  $('subscriptionDetailNextBilling').textContent = subscription?.next_billing_at ? fmtDate(String(subscription.next_billing_at).slice(0,10)) : '—';
  $('subscriptionDetailLastPayment').textContent = subscription?.last_payment_at ? new Date(subscription.last_payment_at).toLocaleString('pt-BR') : '—';
  $('subscriptionDetailTrialEnd').textContent = subscription?.trial_ends_at ? fmtDate(subscription.trial_ends_at) : '—';
  const accessUntil = status==='support' ? subscription?.support_extension_ends_at : (status==='trialing' ? subscription?.trial_ends_at : (status==='grace' ? subscription?.grace_ends_at : null));
  $('subscriptionDetailAccessUntil').textContent = accessUntil ? fmtDate(accessUntil) : (status==='active' ? 'Enquanto a assinatura estiver ativa' : '—');

  const badge = $('subscriptionStatusBadge');
  if (badge) {
    badge.className = `subscription-status subscription-status-${status}`;
    badge.textContent = state.billingLoaded ? subscriptionStatusLabel(status) : 'Carregando...';
  }

  const plans = (state.plans?.length ? state.plans : DEFAULT_PLANS)
    .filter(p => ['nexo-essencial','nexo-plus','nexo-pro'].includes(p.code))
    .sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0));

  const features = {
    'nexo-essencial': ['Contas, saldos e lançamentos','Cartões e faturas','Planejamento mensal','Histórico financeiro'],
    'nexo-plus': ['Tudo do Essencial','NEXO Apoio por desemprego','+30 dias gratuitos após aprovação','Identidade visual verde exclusiva'],
    'nexo-pro': ['Tudo do Plus','Proteção Financeira completa','Reserva automática para compromissos','Experiência Black + Gold premium']
  };
  const tone = { 'nexo-essencial':'essential', 'nexo-plus':'plus', 'nexo-pro':'pro' };
  const labels = { 'nexo-essencial':'ESSENCIAL', 'nexo-plus':'PLUS', 'nexo-pro':'PRO' };

  const grid = $('planOptionsGrid');
  if (grid) {
    grid.innerHTML = plans.map(plan => {
      const isCurrent = active && currentPlanCode() === plan.code;
      const isTrialPlan = trialPro && plan.code === 'nexo-pro';
      const checkoutForPlan = checkout && checkout.plan_id === plan.id && ['active','pending','initiated'].includes(checkout.status) &&
        (!checkout.expires_at || new Date(checkout.expires_at).getTime() > Date.now());
      let actionText = `Assinar ${labels[plan.code]} · ${money(planPrice(plan))}`;
      let actionType = 'checkout';
      if (isCurrent) { actionText = 'Plano atual ✓'; actionType = 'current'; }
      else if (active) { actionText = `Mudar para ${labels[plan.code]}`; actionType = 'change'; }
      else if (checkoutForPlan) actionText = 'Continuar pagamento';
      const disabled = !state.billingLoaded || isCurrent;
      return `<article class="plan-choice-card plan-choice-${tone[plan.code]} ${isCurrent?'is-current':''} ${isTrialPlan?'is-trial':''}">
        <div class="plan-choice-head">
          <div><span class="plan-choice-kicker">${labels[plan.code]}</span><h3>${escapeHtml(plan.name)}</h3></div>
          ${plan.code==='nexo-plus'?'<span class="plan-popular">MAIS POPULAR</span>':''}
          ${isTrialPlan?'<span class="plan-trial-pill">SEU TESTE</span>':''}
        </div>
        <p>${escapeHtml(plan.description || '')}</p>
        <div class="plan-choice-price"><strong>${money(planPrice(plan))}</strong><span>/mês</span></div>
        <div class="plan-choice-features">${(features[plan.code]||[]).map(f=>`<div><span>✓</span><b>${escapeHtml(f)}</b></div>`).join('')}</div>
        <button type="button" class="btn plan-choice-action" data-plan-action="${actionType}" data-plan-code="${plan.code}" ${disabled?'disabled':''}>${actionText}</button>
      </article>`;
    }).join('');
  }

  const trialCopy = $('trialPlanMessage');
  if (trialCopy) {
    if (trialPro) {
      const days = Math.max(0,(daysUntil(subscription?.trial_ends_at)??0)+1);
      trialCopy.classList.remove('hidden');
      trialCopy.innerHTML = `<strong>👑 Você está experimentando o NEXO Pro</strong><span>Todos os recursos premium estão liberados durante o teste. ${days} dia${days===1?'':'s'} restante${days===1?'':'s'}.</span>`;
    } else {
      trialCopy.classList.add('hidden');
      trialCopy.innerHTML = '';
    }
  }

  const help = $('subscriptionActionHelp');
  if (help) {
    if (!state.billingLoaded) help.textContent = 'Carregando informações da assinatura...';
    else if (active) help.textContent = 'Sua assinatura está ativa. Você pode mudar de plano; o novo valor será aplicado à recorrência do Asaas.';
    else if (status === 'trialing') help.textContent = 'Você está testando o NEXO Pro completo. Escolha qualquer plano quando quiser.';
    else if (status === 'grace') help.textContent = 'Seu teste terminou e você está nos 2 dias de carência. Escolha um plano para continuar sem interrupção.';
    else if (status === 'support') help.textContent = `NEXO Apoio ativo até ${fmtDate(subscription?.support_extension_ends_at)}.`;
    else if (status === 'past_due') help.textContent = 'A última cobrança está pendente. Regularize para manter o acesso.';
    else help.textContent = 'Escolha um plano. O checkout é hospedado pelo Asaas e a liberação acontece automaticamente após o pagamento.';
  }

  renderNexoSupportStatus();

  const checkoutBox = $('subscriptionCheckoutBox');
  if (checkoutBox) {
    if (checkout) {
      const cp = plans.find(p=>p.id===checkout.plan_id);
      checkoutBox.classList.remove('hidden');
      checkoutBox.innerHTML = `<strong>Último checkout</strong><span>${escapeHtml(cp?.name||'NEXO')} · ${escapeHtml(checkoutStatusLabel(checkout.status))}</span><small>Criado em ${new Date(checkout.created_at).toLocaleString('pt-BR')}</small>`;
    } else {
      checkoutBox.classList.add('hidden');
      checkoutBox.innerHTML = '';
    }
  }
}

async function startAsaasCheckout(planCode = 'nexo-essencial') {
  if (!state.billingLoaded) return;
  const plan = planByCode(planCode);

  const existing = state.checkoutSession;
  const existingValid = existing && existing.plan_id === plan.id && ['active','pending','initiated'].includes(existing.status) && existing.checkout_url && (!existing.expires_at || new Date(existing.expires_at).getTime() > Date.now());
  if (existingValid) {
    window.location.href = existing.checkout_url;
    return;
  }

  const btn = document.querySelector(`[data-plan-code="${planCode}"]`);
  const oldText = btn?.textContent || '';
  if (btn) { btn.disabled = true; btn.textContent = 'Abrindo checkout...'; }

  try {
    const { data, error } = await sb.functions.invoke('nexo-admin', {
      body: { action: 'create_asaas_checkout', plan_code: planCode }
    });
    if (error) {
      let message = error.message || 'Não foi possível abrir o checkout.';
      try {
        if (error.context?.json) {
          const ctx = await error.context.json();
          message = ctx?.error || message;
        }
      } catch (_) {}
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    if (data?.already_active) {
      await loadBillingData();
      return;
    }
    if (!data?.checkout_url) throw new Error('O Asaas não retornou o link do checkout.');
    window.location.href = data.checkout_url;
  } catch (error) {
    console.error(error);
    alert('Não foi possível iniciar a assinatura: ' + (error?.message || error));
    if (btn) { btn.disabled = false; btn.textContent = oldText; }
  }
}

async function changeSubscriptionPlan(planCode) {
  const target = planByCode(planCode);
  const current = currentPlan();
  if (!confirm(`Mudar de ${current.name} para ${target.name} por ${money(planPrice(target))}/mês?`)) return;

  const btn = document.querySelector(`[data-plan-code="${planCode}"]`);
  const oldText = btn?.textContent || '';
  if (btn) { btn.disabled=true; btn.textContent='Alterando...'; }

  try {
    const { data, error } = await sb.functions.invoke('nexo-admin', {
      body:{ action:'change_subscription_plan', plan_code:planCode }
    });
    if (error) {
      let message=error.message||'Não foi possível mudar o plano.';
      try { if(error.context?.json){const x=await error.context.json();message=x?.error||message;} } catch(_){}
      throw new Error(message);
    }
    if(data?.error) throw new Error(data.error);
    await loadBillingData();
    alert(`Plano alterado para ${target.name}. ✨`);
  } catch(err) {
    alert(err.message||'Não foi possível mudar o plano.');
    if(btn){btn.disabled=false;btn.textContent=oldText;}
  }
}

async function handleBillingReturn() {
  if (state.billingReturnHandled) return;
  const params = new URLSearchParams(window.location.search);
  const billing = params.get('billing');
  if (!billing) return;
  state.billingReturnHandled = true;
  switchView('subscription');

  if (billing === 'cancel') {
    alert('Pagamento cancelado. Você pode tentar novamente quando quiser.');
  } else if (billing === 'expired') {
    alert('O checkout expirou. Clique em assinar para gerar um novo link.');
  } else if (billing === 'success') {
    if (subscriptionStatusKey() === 'active') {
      alert('Pagamento confirmado! Sua assinatura NEXO está ativa. 🎉');
    } else {
      const help = $('subscriptionActionHelp');
      help.textContent = 'Pagamento concluído. Estamos aguardando a confirmação automática do Asaas...';
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts += 1;
        await loadBillingData();
        if (subscriptionStatusKey() === 'active' || attempts >= 10) {
          clearInterval(poll);
          if (subscriptionStatusKey() === 'active') alert('Pagamento confirmado! Sua assinatura NEXO está ativa. 🎉');
          else $('subscriptionActionHelp').textContent = 'O pagamento foi enviado e ainda está sendo confirmado. Atualize a página em alguns instantes.';
        }
      }, 2000);
    }
  }

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('billing');
  window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
}


function renderAccessExperience() {
  if (!state.billingLoaded) return;
  state.accessStatus = effectiveStatusFromSubscription(state.subscription);
  const status = state.accessStatus;
  const banner = $('accessStatusBanner');
  const title = $('accessStatusTitle');
  const text = $('accessStatusText');
  const action = $('accessStatusAction');
  if (!banner) return;

  banner.className = `access-status-banner access-${status}`;
  action.textContent = ['suspended','past_due','cancelled'].includes(status) ? 'Regularizar agora' : 'Ver assinatura';

  if (status === 'trialing') {
    const days = Math.max(0, (daysUntil(state.subscription?.trial_ends_at) ?? 0) + 1);
    title.textContent = `👑 Teste NEXO Pro · ${days} dia${days===1?'':'s'} restante${days===1?'':'s'}`;
    text.textContent = `Todos os recursos Pro estão liberados até ${fmtDate(state.subscription?.trial_ends_at)}.`;
    banner.classList.remove('hidden');
  } else if (status === 'grace') {
    const days = Math.max(0, (daysUntil(state.subscription?.grace_ends_at) ?? 0) + 1);
    title.textContent = `⏳ Carência · ${days} dia${days===1?'':'s'} restante${days===1?'':'s'}`;
    text.textContent = 'Seu teste terminou. Seus recursos continuam liberados durante a carência.';
    banner.classList.remove('hidden');
  } else if (status === 'support') {
    title.textContent = '🧡 NEXO Apoio ativo';
    text.textContent = `Acesso gratuito até ${fmtDate(state.subscription?.support_extension_ends_at)}.${canUseProtection()?' A Proteção Financeira Pro continua disponível durante esse período.':''}`;
    banner.classList.remove('hidden');
  } else if (status === 'active') {
    banner.classList.add('hidden');
  } else {
    title.textContent = status === 'past_due' ? '⚠️ Pagamento pendente' : '🔒 Acesso em modo somente leitura';
    text.textContent = 'Seus dados continuam disponíveis. Assine o NEXO para voltar a lançar, pagar e editar informações.';
    banner.classList.remove('hidden');
  }

  document.body.classList.toggle('nexo-read-only', !hasWriteAccess());
  ['quickAddTop','mobileQuickAdd','newTransactionBtn','newAccountBtn','newCardBtn','newCategoryBtn','newIncomeSourceBtn'].forEach(id => {
    const el=$(id); if(el) el.disabled=!hasWriteAccess();
  });
  renderTrialValuePanel();
  renderProtectionPanel();
}

function trialPeriodTransactions() {
  const start = state.subscription?.trial_started_at || addDaysIso(isoToday(), -29);
  const end = state.subscription?.trial_ends_at || isoToday();
  return state.transactions.filter(t => {
    const d=t.purchase_date || t.due_date;
    return t.status!=='cancelled' && d>=start && d<=end;
  });
}

function renderTrialValuePanel() {
  const panel=$('trialValuePanel'); if(!panel) return;
  const show=state.accessStatus==='grace';
  panel.classList.toggle('hidden',!show);
  if(!show)return;
  const items=trialPeriodTransactions();
  const income=items.filter(t=>t.type==='income').reduce((a,t)=>a+Number(t.amount||0),0);
  const expense=items.filter(t=>t.type==='expense').reduce((a,t)=>a+Number(t.amount||0),0);
  $('trialValueIncome').textContent=money(income);
  $('trialValueExpense').textContent=money(expense);
  $('trialValueResult').textContent=money(income-expense);
  $('trialValueTransactions').textContent=String(items.length);
  const byCategory=new Map();
  items.filter(t=>t.type==='expense').forEach(t=>{
    const c=byId(state.categories,t.category_id);
    const name=c?.name || 'Outros';
    byCategory.set(name,(byCategory.get(name)||0)+Number(t.amount||0));
  });
  const top=[...byCategory.entries()].sort((a,b)=>b[1]-a[1])[0];
  $('trialValueTopCategory').textContent=top ? `Categoria com maior gasto: ${top[0]} · ${money(top[1])}` : 'Você já construiu seu histórico financeiro no NEXO.';
}

function protectionSnapshot(extraExpense=0) {
  const balance=state.accounts.reduce((s,a)=>s+Number(a.balance||0),0);
  const today=isoToday();
  const thirty=addDaysIso(today,30);
  const nextIncome=state.transactions.filter(t=>t.type==='income'&&t.status!=='paid'&&t.status!=='cancelled'&&t.due_date>=today).sort((a,b)=>a.due_date.localeCompare(b.due_date))[0];
  const horizon=nextIncome && nextIncome.due_date<=thirty ? nextIncome.due_date : thirty;
  const commitments=[];
  state.transactions.filter(t=>t.type==='expense'&&t.payment_method!=='credit'&&t.status==='pending'&&t.due_date>=today&&t.due_date<=horizon).forEach(t=>{
    commitments.push({description:t.description,due_date:t.due_date,amount:Number(t.amount||0),kind:'Conta'});
  });
  state.invoices.filter(i=>invoiceOutstanding(i)>0&&i.due_date>=today&&i.due_date<=horizon).forEach(i=>{
    const card=byId(state.cards,i.card_id);
    commitments.push({description:`Fatura ${card?.name||'Cartão'}`,due_date:i.due_date,amount:invoiceOutstanding(i),kind:'Fatura'});
  });
  commitments.sort((a,b)=>a.due_date.localeCompare(b.due_date));
  const reserved=commitments.reduce((s,c)=>s+c.amount,0);
  const free=balance-reserved-Number(extraExpense||0);
  const days=Math.max(1,(daysUntil(horizon)??30)+1);
  return {balance,reserved,free,daily:Math.max(0,free/days),horizon,commitments};
}

function protectionEnabled() { return canUseProtection() && Boolean(state.profile?.protection_mode); }

function renderProtectionPanel() {
  const panel=$('protectionPanel'); if(!panel)return;
  const entitled=canUseProtection();
  const enabled=protectionEnabled();
  panel.classList.toggle('protection-locked', !entitled);
  $('protectionMetrics').classList.toggle('hidden',!enabled);
  $('protectionCommitments').classList.toggle('hidden',!enabled);

  if(!entitled){
    $('toggleProtectionBtn').textContent='Conhecer NEXO Pro';
    $('toggleProtectionBtn').className='btn btn-light protection-upgrade';
    $('protectionTitle').textContent='👑 Proteção Financeira é um recurso Pro';
    $('protectionSubtitle').textContent='No Pro, o NEXO reserva seus compromissos, calcula quanto está realmente livre e avisa o impacto antes de gastos de risco.';
    return;
  }

  $('toggleProtectionBtn').textContent=enabled?'Desativar modo proteção':'Ativar modo proteção';
  $('toggleProtectionBtn').className=enabled?'btn btn-light protection-on':'btn btn-light';
  if(!enabled){
    $('protectionTitle').textContent='Proteja o dinheiro das próximas contas';
    $('protectionSubtitle').textContent='Recurso NEXO Pro: ative para reservar compromissos e receber alertas antes de novos gastos.';
    return;
  }
  $('protectionTitle').textContent=state.profile?.protection_reason==='unemployment'?'🧡 Proteção ativa durante o NEXO Apoio':'🛡 Seu dinheiro protegido antes de novos gastos';
  $('protectionSubtitle').textContent='O NEXO compara novos gastos com os compromissos já previstos e mostra o impacto antes de salvar.';
  const snap=protectionSnapshot();
  $('protectionBalance').textContent=money(snap.balance);
  $('protectionReserved').textContent=money(snap.reserved);
  $('protectionFree').textContent=money(snap.free);
  $('protectionDaily').textContent=money(snap.daily);
  $('protectionCommitments').innerHTML=snap.commitments.length
    ? `<strong>Próximos valores que merecem ficar reservados</strong>${snap.commitments.slice(0,4).map(c=>`<div><span>Você precisa guardar <b>${money(c.amount)}</b> para ${escapeHtml(c.description)}</span><small>até ${fmtDate(c.due_date)}</small></div>`).join('')}`
    : '<strong>Nenhum compromisso pendente até o próximo horizonte de planejamento. 👍</strong>';
}

async function toggleProtectionMode() {
  if(!canUseProtection()) {
    switchView('subscription');
    return;
  }
  const enabled=!protectionEnabled();
  const {error}=await sb.from('profiles').update({protection_mode:enabled,protection_reason:enabled?(state.profile?.protection_reason||'manual'):null}).eq('id',uid());
  if(error)return alert('Não foi possível alterar o Modo Proteção: '+error.message);
  state.profile.protection_mode=enabled;
  state.profile.protection_reason=enabled?(state.profile.protection_reason||'manual'):null;
  renderProtectionPanel();
}

function confirmProtectionSpend({amount,description,category}) {
  if (!protectionEnabled()) return Promise.resolve('continue');
  const snap=protectionSnapshot(amount);
  const group=category?.group_name || 'other';
  const needsWarning=['leisure','nonessential','other'].includes(group) || snap.free < 0 || amount > Math.max(50, (snap.balance-snap.reserved)*0.12);
  if(!needsWarning)return Promise.resolve('continue');
  const next=snap.commitments[0];
  $('protectionSpendMessage').innerHTML=`
    <div class="protection-impact"><span>Gasto</span><strong>${money(amount)} · ${escapeHtml(description)}</strong></div>
    <div class="protection-impact"><span>Livre após este gasto</span><strong class="${snap.free<0?'danger-text':''}">${money(snap.free)}</strong></div>
    ${next?`<p>Você ainda precisa manter <strong>${money(next.amount)}</strong> reservado para <strong>${escapeHtml(next.description)}</strong>, com vencimento em ${fmtDate(next.due_date)}.</p>`:''}
    <p>${snap.free<0?'⚠️ Este gasto usa parte do dinheiro necessário para compromissos já previstos.':'O gasto cabe no saldo livre calculado, mas merece atenção enquanto o Modo Proteção estiver ativo.'}</p>`;
  $('protectionSpendModal').showModal();
  return new Promise(resolve=>{state.protectionSpendResolver=resolve;});
}

function resolveProtectionSpend(decision) {
  if($('protectionSpendModal')?.open)$('protectionSpendModal').close();
  const resolve=state.protectionSpendResolver; state.protectionSpendResolver=null;
  if(resolve)resolve(decision);
}

function renderNexoSupportStatus() {
  const box=$('nexoSupportRequestStatus'); const btn=$('requestNexoSupportBtn');
  if(!box||!btn)return;
  if(!canUseSupport()) {
    box.classList.remove('hidden');
    box.innerHTML='<strong>Disponível no Plus e Pro</strong><span>O NEXO Apoio pode conceder +30 dias em caso de desemprego comprovado.</span>';
    btn.disabled=false; btn.textContent='Conhecer NEXO Plus';
    return;
  }
  const req=state.supportBenefitRequest;
  if(!req){box.classList.add('hidden');btn.disabled=false;btn.textContent='Solicitar NEXO Apoio';return;}
  box.classList.remove('hidden');
  const labels={pending:'Em análise',approved:'Aprovado',rejected:'Não aprovado',cancelled:'Cancelado'};
  box.innerHTML=`<strong>${labels[req.status]||req.status}</strong><span>${req.status==='pending'?'Recebemos seu pedido. O comprovante fica disponível apenas para análise administrativa.':req.status==='approved'?`30 dias extras concedidos: ${fmtDate(req.extension_start)} a ${fmtDate(req.extension_end)}.`:req.decision_note||'Você pode falar com o suporte se precisar de ajuda.'}</span>`;
  const approvedAt=req.reviewed_at?new Date(req.reviewed_at).getTime():0;
  const approvedWithinYear=req.status==='approved' && approvedAt && (Date.now()-approvedAt)<365*86400000;
  btn.disabled=req.status==='pending' || approvedWithinYear;
  btn.textContent=req.status==='pending'?'Solicitação em análise':approvedWithinYear?'NEXO Apoio concedido ✓':'Solicitar NEXO Apoio';
}

function openNexoSupport() {
  if(!canUseSupport()) { switchView('subscription'); return; }
  if(state.subscription?.status==='past_due') return alert('Existe uma cobrança pendente. Regularize a assinatura antes de solicitar o NEXO Apoio.');
  if(state.supportBenefitRequest?.status==='pending') return alert('Sua solicitação já está em análise.');
  $('nexoSupportForm').reset(); $('nexoSupportFormMessage').textContent=''; $('unemploymentDate').value=isoToday(); $('nexoSupportModal').showModal();
}

async function submitNexoSupport(e) {
  e.preventDefault();
  const file=$('unemploymentDocument').files?.[0];
  if(!file)return;
  if(file.size>8*1024*1024)return alert('O comprovante pode ter no máximo 8 MB.');
  const allowed=['application/pdf','image/jpeg','image/png'];
  if(!allowed.includes(file.type))return alert('Envie um PDF, JPG ou PNG.');
  const btn=$('submitNexoSupportBtn'); const msg=$('nexoSupportFormMessage');
  btn.disabled=true;msg.dataset.type='info';msg.textContent='Enviando comprovante com segurança...';
  const ext=file.type==='application/pdf'?'pdf':file.type==='image/png'?'png':'jpg';
  const path=`${uid()}/${crypto.randomUUID()}.${ext}`;
  try{
    const upload=await sb.storage.from('nexo-support-documents').upload(path,file,{upsert:false,contentType:file.type});
    if(upload.error)throw upload.error;
    const {data,error}=await sb.functions.invoke('nexo-admin',{body:{action:'submit_unemployment_support',unemployment_date:$('unemploymentDate').value,document_path:path,message:$('unemploymentMessage').value.trim()}});
    if(error){let m=error.message;try{if(error.context?.json){const x=await error.context.json();m=x?.error||m;}}catch(_){}throw new Error(m);}
    if(data?.error)throw new Error(data.error);
    msg.dataset.type='success';msg.textContent=data.message||'Solicitação enviada.';
    if(canUseProtection()){state.profile.protection_mode=true;state.profile.protection_reason='unemployment';}
    setTimeout(async()=>{$('nexoSupportModal').close();await loadBillingData();renderProtectionPanel();},1200);
  }catch(err){
    await sb.storage.from('nexo-support-documents').remove([path]).catch(()=>null);
    msg.dataset.type='error';msg.textContent=err.message||'Não foi possível enviar a solicitação.';
  }finally{btn.disabled=false;}
}

async function syncCardInvoices() {
  const creditTransactions = state.transactions.filter(t =>
    t.type === 'expense' &&
    t.payment_method === 'credit' &&
    t.card_id &&
    t.status !== 'cancelled'
  );

  if (!creditTransactions.length || !state.cards.length) return false;

  let changed = false;

  // Calcula apenas as faturas realmente necessárias.
  const expectedInvoicePayloads = new Map();

  for (const t of creditTransactions) {
    const card = byId(state.cards, t.card_id);
    if (!card) continue;

    const purchaseDate = t.purchase_date || t.due_date || isoToday();
    const installmentIndex = Math.max(1, Number(t.installment_number || 1)) - 1;
    const firstDue = firstCardDueDate(purchaseDate, card.closing_day, card.due_day);
    const expectedDue = addMonths(firstDue, installmentIndex);
    const key = `${card.id}|${expectedDue}`;

    if (!expectedInvoicePayloads.has(key)) {
      expectedInvoicePayloads.set(key, {
        user_id: uid(),
        card_id: card.id,
        due_date: expectedDue,
        reference_month: `${expectedDue.slice(0,7)}-01`
      });
    }
  }

  // Não regrava faturas que já existem.
  const currentInvoiceKeys = new Set(
    state.invoices.map(i => `${i.card_id}|${i.due_date}`)
  );

  const missingInvoices = [...expectedInvoicePayloads.entries()]
    .filter(([key]) => !currentInvoiceKeys.has(key))
    .map(([, payload]) => payload);

  if (missingInvoices.length) {
    const { error } = await sb.from('card_invoices')
      .upsert(missingInvoices, { onConflict:'card_id,due_date', ignoreDuplicates:true });

    if (error) {
      console.error('Não foi possível criar as faturas necessárias:', error);
      return false;
    }

    changed = true;
  }

  // Só busca as faturas novamente se alguma precisou ser criada.
  let invoices = state.invoices;

  if (missingInvoices.length) {
    const { data, error } = await sb.from('card_invoices')
      .select('*')
      .eq('user_id', uid());

    if (error) {
      console.error('Erro ao recarregar faturas:', error);
      return changed;
    }

    invoices = data || [];
  }

  const invoiceMap = new Map(
    invoices.map(i => [`${i.card_id}|${i.due_date}`, i])
  );

  // Atualiza SOMENTE lançamentos que realmente estejam divergentes.
  const updates = [];

  for (const t of creditTransactions) {
    const card = byId(state.cards, t.card_id);
    if (!card) continue;

    const purchaseDate = t.purchase_date || t.due_date || isoToday();
    const firstDue = firstCardDueDate(purchaseDate, card.closing_day, card.due_day);
    const expectedDue = addMonths(
      firstDue,
      Math.max(1, Number(t.installment_number || 1)) - 1
    );

    const invoice = invoiceMap.get(`${card.id}|${expectedDue}`);
    if (!invoice) continue;

    const payload = {};

    if (t.invoice_id !== invoice.id) payload.invoice_id = invoice.id;
    if (t.due_date !== expectedDue) payload.due_date = expectedDue;
    if (!t.purchase_date) payload.purchase_date = purchaseDate;

    if (!Object.keys(payload).length) continue;

    updates.push(
      sb.from('transactions')
        .update(payload)
        .eq('id', t.id)
        .eq('user_id', uid())
    );
  }

  if (updates.length) {
    const results = await Promise.all(updates);
    const errors = results.map(r => r.error).filter(Boolean);

    if (errors.length) {
      console.error('Alguns lançamentos não puderam ser sincronizados:', errors);
    }

    if (errors.length < updates.length) changed = true;
  }

  return changed;
}

async function ensureDefaults() {
  let created = false;

  if (!state.categories.length) {
    const { error } = await sb.from('categories').insert([
      { user_id: uid(), name: 'Alimentação', group_name: 'essential', icon: '🍔' },
      { user_id: uid(), name: 'Transporte', group_name: 'essential', icon: '🚗' },
      { user_id: uid(), name: 'Educação', group_name: 'essential', icon: '🎓' },
      { user_id: uid(), name: 'Assinaturas', group_name: 'subscription', icon: '📱' },
      { user_id: uid(), name: 'Lazer', group_name: 'leisure', icon: '🎉' },
      { user_id: uid(), name: 'Moradia', group_name: 'essential', icon: '🏠' },
      { user_id: uid(), name: 'Saúde', group_name: 'essential', icon: '❤️' },
      { user_id: uid(), name: 'Outros', group_name: 'other', icon: '🏷️' }
    ]);
    if (!error) created = true;
    else console.error('Erro ao criar categorias padrão:', error);
  }

  if (!state.incomeSources.length) {
    const { error } = await sb.from('income_sources').insert([
      { user_id: uid(), name: 'Salário', source_type: 'recurring' },
      { user_id: uid(), name: 'Outros', source_type: 'other' }
    ]);
    if (!error) created = true;
    else console.error('Erro ao criar fontes de renda padrão:', error);
  }

  return created;
}

function renderAll() {
  applyPlanTheme();
  renderUser();
  fillSelects();
  renderDashboard();
  renderTransactions();
  renderPlanning();
  renderCards();
  renderAccounts();
  renderSubscription();
  renderSettings();
  if (state.billingLoaded) renderAccessExperience();
}

function renderUser() {
  const name = state.profile?.full_name || state.user?.user_metadata?.full_name || state.user?.email || 'Usuário';
  $('userMini').textContent = name;
  const adminBtn = $('adminPanelBtn');
  if (adminBtn) adminBtn.classList.toggle('hidden', !['owner','admin','support'].includes(state.profile?.role));
}

function fillSelects() {
  const accountOptions = `<option value="">Selecione</option>` + state.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  ['transactionAccount','incomeAccount','cardPaymentAccount','invoicePaymentAccount'].forEach(id => $(id).innerHTML = accountOptions);
  $('transactionCard').innerHTML = `<option value="">Selecione</option>` + state.cards.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  $('transactionCategory').innerHTML = `<option value="">Selecione</option>` + state.categories.map(c => `<option value="${c.id}">${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</option>`).join('');
  $('transactionIncomeSource').innerHTML = `<option value="">Selecione</option>` + state.incomeSources.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
}

function monthTransactions() {
  const { start, end } = monthRange(state.selectedMonth);
  return state.transactions.filter(t => t.due_date >= start && t.due_date <= end && t.status !== 'cancelled');
}

function purchaseMonthTransactions() {
  const { start, end } = monthRange(state.selectedMonth);
  return state.transactions.filter(t => {
    const date = t.purchase_date || t.due_date;
    return date >= start && date <= end && t.status !== 'cancelled';
  });
}

function invoicesInMonth(month = state.selectedMonth) {
  const { start, end } = monthRange(month);
  return state.invoices.filter(i => i.due_date >= start && i.due_date <= end && invoiceTotal(i.id) > 0);
}

function renderDashboard() {
  const monthTx = monthTransactions();
  const monthInvoices = invoicesInMonth();
  const balance = state.accounts.reduce((s,a) => s + Number(a.balance), 0);
  const income = monthTx.filter(t => t.type === 'income').reduce((s,t)=>s+Number(t.amount),0);
  const expense = monthTx.filter(t => t.type === 'expense').reduce((s,t)=>s+Number(t.amount),0);
  const pendingIncome = monthTx.filter(t => t.type === 'income' && t.status !== 'paid').reduce((s,t)=>s+Number(t.amount),0);

  const regularPendingExpense = monthTx
    .filter(t => t.type === 'expense' && t.payment_method !== 'credit' && t.status !== 'paid')
    .reduce((s,t)=>s+Number(t.amount),0);
  const invoicePendingExpense = monthInvoices.reduce((s,i)=>s+invoiceOutstanding(i),0);
  const pendingExpense = regularPendingExpense + invoicePendingExpense;
  const projected = balance + pendingIncome - pendingExpense;

  $('balanceTotal').textContent = money(balance);
  $('incomeMonth').textContent = money(income);
  $('expenseMonth').textContent = money(expense);
  $('projectedBalance').textContent = money(projected);

  const regularUpcoming = state.transactions
    .filter(t => t.type === 'expense' && t.payment_method !== 'credit' && t.status === 'pending')
    .map(t => ({ kind:'transaction', due_date:t.due_date, item:t }));

  const invoiceUpcoming = state.invoices
    .filter(i => invoiceTotal(i.id) > 0 && invoiceOutstanding(i) > 0)
    .map(i => ({ kind:'invoice', due_date:i.due_date, item:i }));

  const upcoming = [...regularUpcoming, ...invoiceUpcoming]
    .sort((a,b)=>a.due_date.localeCompare(b.due_date))
    .slice(0,6);

  $('upcomingList').classList.toggle('empty-state', !upcoming.length);
  $('upcomingList').innerHTML = upcoming.length ? upcoming.map(row => {
    if (row.kind === 'invoice') {
      const inv = row.item;
      const card = byId(state.cards, inv.card_id);
      return `<div class="list-item">
        <div class="list-item-main">
          <div class="list-item-title">💳 Fatura ${escapeHtml(card?.name || 'Cartão')}</div>
          <div class="list-item-sub">Vence ${fmtDate(inv.due_date)} · ${monthLabel(inv.due_date.slice(0,7))}</div>
        </div>
        <div>
          <div class="amount-expense">${money(invoiceOutstanding(inv))}</div>
          <span class="status-badge invoice-status-${invoiceComputedStatus(inv)}">${invoiceStatusLabel(inv)}</span>
        </div>
      </div>`;
    }
    const t = row.item;
    return `<div class="list-item">
      <div class="list-item-main"><div class="list-item-title">${escapeHtml(t.description)}</div><div class="list-item-sub">Vence ${fmtDate(t.due_date)} · ${paymentLabel(t)}</div></div>
      <div><div class="amount-expense">${money(t.amount)}</div><span class="status-badge status-${statusOf(t)}">${statusLabel(t)}</span></div>
    </div>`;
  }).join('') : 'Nenhuma conta pendente.';

  const cardInfo = getCardsWithUsage();
  $('dashboardCards').classList.toggle('empty-state', !cardInfo.length);
  $('dashboardCards').innerHTML = cardInfo.length ? cardInfo.map(c => {
    const pct = c.limit ? Math.min(100, (c.used / c.limit) * 100) : 0;
    const selectedInvoice = state.invoices.find(i => i.card_id === c.id && i.due_date.startsWith(state.selectedMonth) && invoiceTotal(i.id) > 0);
    return `<div class="list-item">
      <div class="list-item-main" style="width:100%">
        <div class="list-item-title">💳 ${escapeHtml(c.name)}</div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="list-item-sub">Usado ${money(c.used)} · Disponível ${money(c.available)}${selectedInvoice ? ` · Fatura ${money(invoiceOutstanding(selectedInvoice))}`:''}</div>
      </div>
    </div>`;
  }).join('') : 'Nenhum cartão cadastrado.';

  const recent = [...state.transactions].sort((a,b)=> (b.created_at || '').localeCompare(a.created_at || '')).slice(0,7);
  $('recentTransactions').innerHTML = tableTransactions(recent, false);
}

function paymentLabel(t) {
  if (t.type === 'income') return byId(state.accounts, t.account_id)?.name || 'Receita';
  if (t.payment_method === 'credit') {
    const card = byId(state.cards, t.card_id);
    const inv = invoiceForTransaction(t);
    return `${card?.name || 'Crédito'}${inv ? ` · Fatura ${inv.due_date.slice(0,7).split('-').reverse().join('/')}` : ''}`;
  }
  return byId(state.accounts, t.account_id)?.name || ({pix:'PIX',debit:'Débito',cash:'Dinheiro',boleto:'Boleto',other:'Outro'}[t.payment_method] || '—');
}

function tableTransactions(items, actions=true) {
  if (!hasWriteAccess()) actions=false;
  if (!items.length) return `<div class="empty-state">Nenhum lançamento encontrado.</div>`;
  return `<table class="data-table"><thead><tr><th>Descrição</th><th>Compra / lançamento</th><th>Vencimento</th><th>Categoria / origem</th><th>Pagamento</th><th>Status</th><th>Valor</th>${actions?'<th></th>':''}</tr></thead><tbody>` + items.map(t => {
    const cat = t.type === 'expense' ? byId(state.categories, t.category_id) : byId(state.incomeSources, t.income_source_id);
    const purchaseDate = t.purchase_date || t.due_date;
    return `<tr>
      <td><strong>${escapeHtml(t.description)}</strong>${t.installment_total > 1 ? `<div class="list-item-sub">Parcela ${t.installment_number}/${t.installment_total}</div>` : ''}</td>
      <td>${fmtDate(purchaseDate)}</td>
      <td>${fmtDate(t.due_date)}</td>
      <td>${escapeHtml(cat?.icon || '')} ${escapeHtml(cat?.name || '—')}</td>
      <td>${escapeHtml(paymentLabel(t))}</td>
      <td><span class="status-badge status-${statusOf(t)}">${statusLabel(t)}</span></td>
      <td class="${t.type==='expense'?'amount-expense':'amount-income'}">${t.type==='expense'?'−':'+'} ${money(t.amount)}</td>
      ${actions ? `<td><div class="table-actions">${
        t.status==='pending'
          ? (t.payment_method==='credit'
              ? `<button class="mini-btn" data-open-invoice="${t.invoice_id || ''}">Ver fatura</button><button class="mini-btn danger" data-cancel="${t.id}">Cancelar</button>`
              : `<button class="mini-btn success" data-pay="${t.id}">${t.type==='expense'?'Marcar pago':'Recebido'}</button><button class="mini-btn danger" data-cancel="${t.id}">Cancelar</button>`)
          : ''
      }</div></td>`:''}
    </tr>`;
  }).join('') + '</tbody></table>';
}

function renderTransactions() {
  const typeFilter = $('transactionTypeFilter').value || 'all';
  const statusFilter = $('transactionStatusFilter').value || 'all';
  let items = purchaseMonthTransactions();
  if (typeFilter !== 'all') items = items.filter(t => t.type === typeFilter);
  if (statusFilter !== 'all') items = items.filter(t => statusOf(t) === statusFilter);
  items.sort((a,b)=>b.due_date.localeCompare(a.due_date));
  $('transactionsTable').innerHTML = tableTransactions(items, true);
}

function renderPlanning() {
  const items = monthTransactions();
  const monthInvoices = invoicesInMonth();
  const income = items.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount),0);
  const expenses = items.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount),0);

  const receivedIncome = items.filter(t=>t.type==='income' && t.status==='paid').reduce((s,t)=>s+Number(t.amount),0);
  const paidRegularExpenses = items
    .filter(t=>t.type==='expense' && t.payment_method!=='credit' && t.status==='paid')
    .reduce((s,t)=>s+Number(t.amount),0);
  const paidInvoices = monthInvoices.reduce((s,i)=>s+Math.min(Number(i.amount_paid||0),invoiceTotal(i.id)),0);
  const realized = receivedIncome - paidRegularExpenses - paidInvoices;

  $('planningIncome').textContent = money(income);
  $('planningExpenses').textContent = money(expenses);
  $('planningPaid').textContent = money(realized);
  $('planningResult').textContent = money(income-expenses);
  $('planningTable').innerHTML = tableTransactions(items.sort((a,b)=>a.due_date.localeCompare(b.due_date)), false);
}

function getCardsWithUsage() {
  return state.cards.map(c => {
    const pendingTx = state.transactions.filter(t =>
      t.type==='expense' &&
      t.payment_method==='credit' &&
      t.card_id===c.id &&
      t.status==='pending'
    );
    const pendingTotal = pendingTx.reduce((s,t)=>s+Number(t.amount),0);
    const partialReleased = state.invoices
      .filter(i => i.card_id===c.id && invoiceComputedStatus(i)==='partial')
      .reduce((s,i)=>s+Number(i.amount_paid||0),0);
    const used = Math.max(0, pendingTotal - partialReleased);
    const limit = Number(c.credit_limit || 0);
    return { ...c, limit, used, available: Math.max(0, limit-used) };
  });
}

function renderCards() {
  const info = getCardsWithUsage();
  $('cardsGrid').innerHTML = info.length ? info.map(c => {
    const pct = c.limit ? Math.min(100,(c.used/c.limit)*100) : 0;
    const account = byId(state.accounts, c.payment_account_id);
    const selectedInvoice = state.invoices.find(i => i.card_id===c.id && i.due_date.startsWith(state.selectedMonth) && invoiceTotal(i.id) > 0);
    const futureInvoices = state.invoices
      .filter(i => i.card_id===c.id && i.due_date > monthRange(state.selectedMonth).end && invoiceTotal(i.id) > 0)
      .sort((a,b)=>a.due_date.localeCompare(b.due_date));
    const nextInvoice = futureInvoices[0] || null;

    const invoiceBlock = selectedInvoice ? `
      <div class="invoice-box">
        <div class="invoice-box-head">
          <div>
            <span class="invoice-kicker">FATURA ${state.selectedMonth.split('-').reverse().join('/')}</span>
            <strong>${money(invoiceTotal(selectedInvoice.id))}</strong>
            <small>Vence ${fmtDate(selectedInvoice.due_date)}</small>
          </div>
          <span class="status-badge invoice-status-${invoiceComputedStatus(selectedInvoice)}">${invoiceStatusLabel(selectedInvoice)}</span>
        </div>
        <div class="invoice-progress-row"><span>Pago</span><strong>${money(selectedInvoice.amount_paid||0)}</strong></div>
        <div class="invoice-progress-row"><span>Restante</span><strong>${money(invoiceOutstanding(selectedInvoice))}</strong></div>
        <div class="invoice-actions">
          <button class="mini-btn" data-open-invoice="${selectedInvoice.id}">Ver fatura</button>
          ${invoiceOutstanding(selectedInvoice)>0 ? `<button class="mini-btn success" data-pay-invoice="${selectedInvoice.id}">Pagar fatura</button>` : ''}
        </div>
      </div>` : `
      <div class="invoice-box muted-invoice">
        <div><span class="invoice-kicker">FATURA ${state.selectedMonth.split('-').reverse().join('/')}</span><strong>Nenhuma compra</strong><small>Sem fatura com vencimento neste mês.</small></div>
      </div>`;

    return `<article class="entity-card card-entity">
      <div class="entity-card-head"><div><h3>💳 ${escapeHtml(c.name)}</h3><small>${escapeHtml(c.issuer || 'Cartão de crédito')}</small></div><button class="mini-btn" data-edit-card="${c.id}">Editar</button></div>
      <div class="metric-line"><span>Limite total</span><strong>${money(c.limit)}</strong></div>
      <div class="metric-line"><span>Limite usado</span><strong>${money(c.used)}</strong></div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="metric-line"><span>Disponível</span><strong>${money(c.available)}</strong></div>
      <div class="metric-line"><span>Fecha / vence</span><span>Dia ${c.closing_day} / ${c.due_day}</span></div>
      <div class="metric-line"><span>Conta de pagamento</span><span>${escapeHtml(account?.name || 'Não definida')}</span></div>
      ${invoiceBlock}
      ${nextInvoice ? `<div class="next-invoice-line"><span>Próxima fatura · ${fmtDate(nextInvoice.due_date)}</span><strong>${money(invoiceTotal(nextInvoice.id))}</strong></div>`:''}
    </article>`;
  }).join('') : '<div class="empty-state">Nenhum cartão cadastrado. Crie o primeiro para acompanhar limite e fatura.</div>';
}

function openInvoice(id) {
  const invoice = state.invoices.find(i=>i.id===id);
  if (!invoice) return alert('Fatura não encontrada.');
  const card = byId(state.cards, invoice.card_id);
  const txs = state.transactions
    .filter(t=>t.invoice_id===invoice.id && t.status!=='cancelled')
    .sort((a,b)=>(a.purchase_date||a.due_date).localeCompare(b.purchase_date||b.due_date));

  $('invoiceDetailTitle').textContent = `Fatura ${card?.name || 'Cartão'}`;
  $('invoiceDetailSubtitle').textContent = `${monthLabel(invoice.due_date.slice(0,7))} · vence ${fmtDate(invoice.due_date)}`;
  $('invoiceDetailTotal').textContent = money(invoiceTotal(invoice.id));
  $('invoiceDetailPaid').textContent = money(invoice.amount_paid||0);
  $('invoiceDetailOutstanding').textContent = money(invoiceOutstanding(invoice));
  $('invoiceDetailStatus').className = `status-badge invoice-status-${invoiceComputedStatus(invoice)}`;
  $('invoiceDetailStatus').textContent = invoiceStatusLabel(invoice);
  $('invoiceDetailRows').innerHTML = txs.length ? txs.map(t=>`
    <div class="invoice-purchase-row">
      <div>
        <strong>${escapeHtml(t.description)}</strong>
        <small>${fmtDate(t.purchase_date||t.due_date)}${t.installment_total>1?` · Parcela ${t.installment_number}/${t.installment_total}`:''}</small>
      </div>
      <strong>${money(t.amount)}</strong>
    </div>`).join('') : '<div class="empty-state">Nenhuma compra nesta fatura.</div>';

  $('invoiceDetailPayBtn').dataset.invoiceId = invoice.id;
  $('invoiceDetailPayBtn').classList.toggle('hidden', invoiceOutstanding(invoice)<=0);
  $('invoiceDetailModal').showModal();
}

function openInvoicePayment(id) {
  if(!requireWriteAccess()) return;
  const invoice = state.invoices.find(i=>i.id===id);
  if (!invoice) return alert('Fatura não encontrada.');
  const card = byId(state.cards, invoice.card_id);
  const outstanding = invoiceOutstanding(invoice);
  if (outstanding <= 0) return alert('Esta fatura já está paga.');

  $('invoicePaymentForm').reset();
  $('invoicePaymentId').value = invoice.id;
  $('invoicePaymentCard').textContent = card?.name || 'Cartão';
  $('invoicePaymentDue').textContent = fmtDate(invoice.due_date);
  $('invoicePaymentOutstanding').textContent = money(outstanding);
  $('invoicePaymentAmount').value = outstanding.toFixed(2).replace('.',',');
  $('invoicePaymentDate').value = isoToday();

  fillSelects();
  const preferred = card?.payment_account_id || state.accounts[0]?.id || '';
  $('invoicePaymentAccount').value = preferred;
  $('invoicePaymentModal').showModal();
}

async function payInvoice(e) {
  e.preventDefault();
  if(!requireWriteAccess()) return;
  const invoice = state.invoices.find(i=>i.id===$('invoicePaymentId').value);
  if (!invoice) return alert('Fatura não encontrada.');

  const amount = parseMoney($('invoicePaymentAmount').value);
  const outstanding = invoiceOutstanding(invoice);
  const accountId = $('invoicePaymentAccount').value;
  const paidAt = $('invoicePaymentDate').value || isoToday();

  if (amount <= 0) return alert('Informe um valor de pagamento maior que zero.');
  if (amount > outstanding + 0.009) return alert(`O pagamento não pode ser maior que o restante da fatura (${money(outstanding)}).`);
  if (!accountId) return alert('Selecione a conta usada para pagar.');

  const { error } = await sb.rpc('pay_card_invoice', {
    p_invoice_id: invoice.id,
    p_account_id: accountId,
    p_amount: amount,
    p_paid_at: paidAt
  });

  if (error) return alert('Não foi possível pagar a fatura: ' + error.message);

  $('invoicePaymentModal').close();
  if ($('invoiceDetailModal').open) $('invoiceDetailModal').close();
  await refresh();
}


function renderAccounts() {
  $('accountsGrid').innerHTML = state.accounts.length ? state.accounts.map(a => `<article class="entity-card">
    <div class="entity-card-head"><div><h3>🏦 ${escapeHtml(a.name)}</h3><small>${accountTypeLabel(a.type)}</small></div><button class="mini-btn" data-edit-account="${a.id}">Editar</button></div>
    <div class="metric-line"><span>Saldo atual</span><strong>${money(a.balance)}</strong></div>
  </article>`).join('') : '<div class="empty-state">Nenhuma conta cadastrada. Cadastre uma conta, carteira digital ou dinheiro.</div>';
}

function accountTypeLabel(type) {
  return {checking:'Conta corrente',wallet:'Carteira digital',cash:'Dinheiro',savings:'Poupança',investment:'Investimento'}[type] || 'Conta';
}

function renderSettings() {
  $('categoriesList').innerHTML = state.categories.length ? state.categories.map(c => `<div class="simple-row"><div class="simple-row-main"><div class="emoji-dot">${escapeHtml(c.icon || '🏷️')}</div><div><strong>${escapeHtml(c.name)}</strong><div class="list-item-sub">${escapeHtml(groupLabel(c.group_name))}</div></div></div><button class="mini-btn" data-edit-category="${c.id}">Editar</button></div>`).join('') : '<div class="empty-state">Nenhuma categoria.</div>';
  $('incomeSourcesList').innerHTML = state.incomeSources.length ? state.incomeSources.map(s => `<div class="simple-row"><div class="simple-row-main"><div class="emoji-dot">💵</div><div><strong>${escapeHtml(s.name)}</strong><div class="list-item-sub">${escapeHtml(sourceTypeLabel(s.source_type))}${s.default_amount ? ' · '+money(s.default_amount):''}</div></div></div><button class="mini-btn" data-edit-income="${s.id}">Editar</button></div>`).join('') : '<div class="empty-state">Nenhuma fonte de renda.</div>';
}

function groupLabel(v){return {essential:'Essencial',nonessential:'Não essencial',leisure:'Lazer',debt:'Dívida',investment:'Investimento',subscription:'Assinatura',other:'Outro'}[v]||v}
function sourceTypeLabel(v){return {recurring:'Recorrente',variable:'Variável',sale:'Venda',refund:'Reembolso',other:'Outro'}[v]||v}

function wireEvents() {
  $('logoutBtn').addEventListener('click', async()=>{ await sb.auth.signOut(); window.location.href='index.html'; });
  $('accessStatusAction')?.addEventListener('click',()=>switchView('subscription'));
  $('toggleProtectionBtn')?.addEventListener('click',toggleProtectionMode);
  $('requestNexoSupportBtn')?.addEventListener('click',openNexoSupport);
  $('nexoSupportForm')?.addEventListener('submit',submitNexoSupport);
  $('protectionSpendCancel')?.addEventListener('click',()=>resolveProtectionSpend('cancel'));
  $('protectionSpendClose')?.addEventListener('click',()=>resolveProtectionSpend('cancel'));
  $('protectionSpendContinue')?.addEventListener('click',()=>resolveProtectionSpend('continue'));
  $('protectionSpendEssential')?.addEventListener('click',()=>resolveProtectionSpend('essential'));
  $('monthFilter').addEventListener('change', e=>{ state.selectedMonth=e.target.value; renderAll(); });

  document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', ()=>switchView(btn.dataset.view)));
  document.querySelectorAll('[data-jump]').forEach(btn => btn.addEventListener('click', ()=>switchView(btn.dataset.jump)));

  ['quickAddTop','mobileQuickAdd','newTransactionBtn'].forEach(id => $(id).addEventListener('click', ()=>openTransaction()));
  $('newAccountBtn').addEventListener('click', ()=>openAccount());
  $('newCardBtn').addEventListener('click', ()=>openCard());
  $('newCategoryBtn').addEventListener('click', ()=>openCategory());
  $('newIncomeSourceBtn').addEventListener('click', ()=>openIncomeSource());

  document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', ()=>$(btn.dataset.close).close()));
  document.querySelectorAll('.type-option').forEach(btn=>btn.addEventListener('click',()=>setTransactionType(btn.dataset.type)));
  $('paymentMethod').addEventListener('change', paymentMethodChanged);
  $('transactionCard').addEventListener('change', updateCreditDueDate);
  $('transactionPurchaseDate').addEventListener('change', ()=>{
    if($('paymentMethod').value==='credit') updateCreditDueDate();
    else if(['pix','debit','cash'].includes($('paymentMethod').value)) $('transactionDueDate').value=$('transactionPurchaseDate').value;
  });
  $('moreOptionsToggle').addEventListener('click', ()=> $('moreOptions').classList.toggle('hidden'));
  $('transactionStatus').addEventListener('change', ()=>{
    if ($('transactionStatus').value==='paid' && !$('transactionPaidAt').value) $('transactionPaidAt').value=isoToday();
  });

  $('transactionForm').addEventListener('submit', saveTransaction);
  $('accountForm').addEventListener('submit', saveAccount);
  $('cardForm').addEventListener('submit', saveCard);
  $('categoryForm').addEventListener('submit', saveCategory);
  $('incomeSourceForm').addEventListener('submit', saveIncomeSource);
  $('invoicePaymentForm').addEventListener('submit', payInvoice);
  $('invoiceDetailPayBtn').addEventListener('click', ()=>{ const id=$('invoiceDetailPayBtn').dataset.invoiceId; $('invoiceDetailModal').close(); openInvoicePayment(id); });

  $('transactionTypeFilter').addEventListener('change', renderTransactions);
  $('transactionStatusFilter').addEventListener('change', renderTransactions);

  document.body.addEventListener('click', async (e)=>{
    const planAction = e.target.closest('[data-plan-action]');
    if(planAction) {
      const action=planAction.dataset.planAction; const code=planAction.dataset.planCode;
      if(action==='checkout') return startAsaasCheckout(code);
      if(action==='change') return changeSubscriptionPlan(code);
      return;
    }
    const payInvoiceBtn = e.target.closest('[data-pay-invoice]'); if(payInvoiceBtn) return openInvoicePayment(payInvoiceBtn.dataset.payInvoice);
    const openInvoiceBtn = e.target.closest('[data-open-invoice]'); if(openInvoiceBtn && openInvoiceBtn.dataset.openInvoice) return openInvoice(openInvoiceBtn.dataset.openInvoice);
    const pay = e.target.closest('[data-pay]'); if(pay) return markPaid(pay.dataset.pay);
    const cancel = e.target.closest('[data-cancel]'); if(cancel) return cancelTransaction(cancel.dataset.cancel);
    const ec = e.target.closest('[data-edit-card]'); if(ec) return openCard(ec.dataset.editCard);
    const ea = e.target.closest('[data-edit-account]'); if(ea) return openAccount(ea.dataset.editAccount);
    const ecat = e.target.closest('[data-edit-category]'); if(ecat) return openCategory(ecat.dataset.editCategory);
    const ei = e.target.closest('[data-edit-income]'); if(ei) return openIncomeSource(ei.dataset.editIncome);
  });
}

function switchView(view) {
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.view===view));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $(view+'View').classList.add('active');
  const titles={dashboard:'Visão geral',transactions:'Lançamentos',planning:'Planejamento',cards:'Cartões',accounts:'Contas',subscription:'Assinatura',settings:'Cadastros financeiros'};
  $('viewTitle').textContent=titles[view]||'NEXO Financeiro';
  const billingView = view === 'subscription';
  $('monthFilter').classList.toggle('hidden', billingView);
  $('quickAddTop').classList.toggle('hidden', billingView);
}

function setTransactionType(type) {
  state.transactionType = type;
  document.querySelectorAll('.type-option').forEach(b=>b.classList.toggle('active',b.dataset.type===type));
  $('transactionModalTitle').textContent = type==='expense' ? 'Nova despesa' : 'Nova receita';
  $('expenseFields').classList.toggle('hidden',type!=='expense');
  $('incomeFields').classList.toggle('hidden',type!=='income');
  $('installmentsField').classList.toggle('hidden',type!=='expense' || $('paymentMethod').value!=='credit');
  if(type==='income'){
    $('transactionStatus').value='paid';
    $('transactionPaidAt').value=isoToday();
  } else paymentMethodChanged();
}

function openTransaction() {
  if(!requireWriteAccess()) return;
  $('transactionForm').reset();
  $('transactionId').value='';
  $('transactionAmount').value='';
  $('transactionPurchaseDate').value=isoToday();
  $('transactionDueDate').value=isoToday();
  $('transactionInstallments').value=1;
  $('moreOptions').classList.add('hidden');
  setTransactionType('expense');
  $('paymentMethod').value='pix';
  paymentMethodChanged();
  if(state.accounts.length) $('transactionAccount').value=state.accounts[0].id;
  if(state.categories.length) $('transactionCategory').value=state.categories[0].id;
  $('transactionModal').showModal();
  setTimeout(()=>$('transactionAmount').focus(),80);
}

function paymentMethodChanged() {
  const method=$('paymentMethod').value;
  const credit=method==='credit';
  $('accountField').classList.toggle('hidden',credit);
  $('cardField').classList.toggle('hidden',!credit);
  $('installmentsField').classList.toggle('hidden',!credit);
  if(credit){
    $('transactionStatus').value='pending'; $('transactionPaidAt').value='';
    if(state.cards.length && !$('transactionCard').value) $('transactionCard').value=state.cards[0].id;
    updateCreditDueDate();
  } else if(['pix','debit','cash'].includes(method)) {
    $('transactionStatus').value='paid'; $('transactionPaidAt').value=isoToday(); $('transactionDueDate').value=$('transactionPurchaseDate').value || isoToday();
  } else {
    $('transactionStatus').value='pending'; $('transactionPaidAt').value='';
  }
}

function updateCreditDueDate(){
  if($('paymentMethod').value!=='credit') return;
  const card=byId(state.cards,$('transactionCard').value); if(!card)return;
  const purchaseDate=$('transactionPurchaseDate').value || isoToday();
  $('transactionDueDate').value=firstCardDueDate(purchaseDate,card.closing_day,card.due_day);
}

async function saveTransaction(e) {
  e.preventDefault();
  if(!requireWriteAccess()) return;
  const totalAmount=parseMoney($('transactionAmount').value);
  if(totalAmount<=0) return alert('Informe um valor maior que zero.');
  const type=state.transactionType;
  const description=$('transactionDescription').value.trim();
  if(!description) return;

  let status=$('transactionStatus').value;
  let paidAt=$('transactionPaidAt').value || null;
  const method= type==='expense' ? $('paymentMethod').value : 'income';
  const purchaseDate = $('transactionPurchaseDate').value || isoToday();
  if(type==='expense' && method==='credit'){ status='pending'; paidAt=null; }

  let essentialOverride=false;
  if(type==='expense' && protectionEnabled()){
    const category=byId(state.categories,$('transactionCategory').value);
    const decision=await confirmProtectionSpend({amount:totalAmount,description,category});
    if(decision==='cancel') return;
    essentialOverride=decision==='essential';
  }

  const installments = type==='expense' && method==='credit' ? Math.max(1, Number($('transactionInstallments').value||1)) : 1;
  const group = installments > 1 ? crypto.randomUUID() : null;
  const installmentAmount = Math.round((totalAmount/installments)*100)/100;
  let remaining = totalAmount;
  const rows=[];

  for(let i=1;i<=installments;i++){
    const amount = i===installments ? Math.round(remaining*100)/100 : installmentAmount;
    remaining = Math.round((remaining-amount)*100)/100;
    let dueDate=$('transactionDueDate').value || purchaseDate;
    if(type==='expense' && method==='credit'){
      const card=byId(state.cards,$('transactionCard').value);
      if(!card) return alert('Selecione o cartão.');
      const firstDue=firstCardDueDate(purchaseDate,card.closing_day,card.due_day);
      dueDate=addMonths(firstDue,i-1);
    } else if(installments>1) {
      dueDate=addMonths(dueDate,i-1);
    }
    rows.push({
      user_id:uid(), type, description, amount, purchase_date:purchaseDate, due_date:dueDate, paid_at:installments>1?null:paidAt,
      status:installments>1?'pending':status, payment_method: method,
      account_id: type==='income' ? ($('incomeAccount').value||null) : (method==='credit'?null:($('transactionAccount').value||null)),
      card_id: type==='expense' && method==='credit' ? ($('transactionCard').value||null) : null,
      category_id: type==='expense' ? ($('transactionCategory').value||null) : null,
      income_source_id: type==='income' ? ($('transactionIncomeSource').value||null) : null,
      notes:$('transactionNotes').value.trim()||null,
      is_essential_override:essentialOverride,
      installment_group:group, installment_number:installments>1?i:null, installment_total:installments>1?installments:null
    });
  }

  const {data,error}=await sb.from('transactions').insert(rows).select();
  if(error) return alert('Erro ao salvar: '+error.message);

  // Movimenta saldo somente em lançamento efetivamente pago/recebido e não-crédito.
  if(installments===1 && status==='paid') {
    const t=data?.[0];
    if(t) await applyBalanceForTransaction(t, 1);
  }

  $('transactionModal').close();

  // Atualiza a tela sem repetir várias leituras desnecessárias.
  await loadData();

  if (method === 'credit') {
    const changed = await syncCardInvoices();
    if (changed) await loadData();
  }

  renderAll();
}

async function applyBalanceForTransaction(t, direction=1) {
  let accountId=t.account_id;
  if(t.type==='expense' && t.payment_method==='credit') accountId=byId(state.cards,t.card_id)?.payment_account_id || null;
  if(!accountId) return;
  const account=byId(state.accounts,accountId);
  if(!account) return;
  const delta=(t.type==='income'?Number(t.amount):-Number(t.amount))*direction;
  const newBalance=Number(account.balance)+delta;
  const {error}=await sb.from('accounts').update({balance:newBalance}).eq('id',accountId).eq('user_id',uid());
  if(error) console.error('Erro ao atualizar saldo',error);
}

async function markPaid(id) {
  if(!requireWriteAccess()) return;
  const t=state.transactions.find(x=>x.id===id); if(!t||t.status!=='pending')return;
  if (t.payment_method === 'credit') {
    const invoice = invoiceForTransaction(t);
    return invoice ? openInvoicePayment(invoice.id) : alert('Esta compra deve ser paga pela fatura do cartão.');
  }
  const label=t.type==='expense'?'marcar esta conta como paga':'marcar esta receita como recebida';
  if(!confirm(`Deseja ${label}?`))return;
  await applyBalanceForTransaction(t,1);
  const {error}=await sb.from('transactions').update({status:'paid',paid_at:isoToday()}).eq('id',id).eq('user_id',uid());
  if(error) return alert('Erro: '+error.message);
  await refresh();
}

async function cancelTransaction(id) {
  if(!requireWriteAccess()) return;
  const t=state.transactions.find(x=>x.id===id); if(!t||t.status!=='pending')return;
  if (t.payment_method === 'credit') {
    const invoice = invoiceForTransaction(t);
    if (invoice && Number(invoice.amount_paid || 0) > 0) {
      return alert('Não é possível cancelar uma compra depois que o pagamento da fatura já começou.');
    }
  }
  if(!confirm(`Cancelar "${t.description}"?`))return;
  const {error}=await sb.from('transactions').update({status:'cancelled'}).eq('id',id).eq('user_id',uid());
  if(error) return alert('Erro: '+error.message);
  await refresh();
}

function openAccount(id='') {
  if(!requireWriteAccess()) return;
  $('accountForm').reset(); $('accountId').value=id;
  if(id){const a=byId(state.accounts,id); $('accountName').value=a.name; $('accountType').value=a.type; $('accountBalance').value=Number(a.balance).toFixed(2).replace('.',',');}
  $('accountModal').showModal();
}
async function saveAccount(e){e.preventDefault();if(!requireWriteAccess())return;const id=$('accountId').value;const payload={user_id:uid(),name:$('accountName').value.trim(),type:$('accountType').value,balance:parseMoney($('accountBalance').value)};const q=id?sb.from('accounts').update(payload).eq('id',id).eq('user_id',uid()):sb.from('accounts').insert(payload);const{error}=await q;if(error)return alert(error.message);$('accountModal').close();await refresh();}

function openCard(id='') {
  if(!requireWriteAccess()) return;
  $('cardForm').reset(); $('cardId').value=id; fillSelects();
  if(id){const c=byId(state.cards,id);$('cardName').value=c.name;$('cardIssuer').value=c.issuer||'';$('cardLimit').value=Number(c.credit_limit).toFixed(2).replace('.',',');$('cardClosingDay').value=c.closing_day;$('cardDueDay').value=c.due_day;$('cardPaymentAccount').value=c.payment_account_id||'';}
  $('cardModal').showModal();
}
async function saveCard(e){
  e.preventDefault();
  if(!requireWriteAccess()) return;
  const id=$('cardId').value;
  const payload={
    user_id:uid(),
    name:$('cardName').value.trim(),
    issuer:$('cardIssuer').value.trim()||null,
    credit_limit:parseMoney($('cardLimit').value),
    closing_day:Number($('cardClosingDay').value),
    due_day:Number($('cardDueDay').value),
    payment_account_id:$('cardPaymentAccount').value||null
  };

  const q=id
    ? sb.from('cards').update(payload).eq('id',id).eq('user_id',uid())
    : sb.from('cards').insert(payload);

  const {error}=await q;
  if(error)return alert(error.message);

  $('cardModal').close();

  // Alteração de fechamento/vencimento pode exigir recalcular faturas.
  await loadData();
  const changed = await syncCardInvoices();
  if (changed) await loadData();
  renderAll();
}

function openCategory(id=''){ if(!requireWriteAccess())return; $('categoryForm').reset();$('categoryId').value=id;if(id){const c=byId(state.categories,id);$('categoryName').value=c.name;$('categoryGroup').value=c.group_name;$('categoryIcon').value=c.icon||'';}$('categoryModal').showModal();}
async function saveCategory(e){e.preventDefault();if(!requireWriteAccess())return;const id=$('categoryId').value;const payload={user_id:uid(),name:$('categoryName').value.trim(),group_name:$('categoryGroup').value,icon:$('categoryIcon').value.trim()||null};const q=id?sb.from('categories').update(payload).eq('id',id).eq('user_id',uid()):sb.from('categories').insert(payload);const{error}=await q;if(error)return alert(error.message);$('categoryModal').close();await refresh();}

function openIncomeSource(id=''){ if(!requireWriteAccess())return; $('incomeSourceForm').reset();$('incomeSourceId').value=id;if(id){const s=byId(state.incomeSources,id);$('incomeSourceName').value=s.name;$('incomeSourceType').value=s.source_type;$('incomeSourceDefaultAmount').value=s.default_amount?Number(s.default_amount).toFixed(2).replace('.',','):'';$('incomeSourceDay').value=s.expected_day||'';}$('incomeSourceModal').showModal();}
async function saveIncomeSource(e){e.preventDefault();if(!requireWriteAccess())return;const id=$('incomeSourceId').value;const amt=parseMoney($('incomeSourceDefaultAmount').value);const payload={user_id:uid(),name:$('incomeSourceName').value.trim(),source_type:$('incomeSourceType').value,default_amount:amt||null,expected_day:$('incomeSourceDay').value?Number($('incomeSourceDay').value):null};const q=id?sb.from('income_sources').update(payload).eq('id',id).eq('user_id',uid()):sb.from('income_sources').insert(payload);const{error}=await q;if(error)return alert(error.message);$('incomeSourceModal').close();await refresh();}

async function refresh(){
  await loadData();
  renderAll();
}

init();
