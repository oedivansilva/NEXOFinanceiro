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
  plan: null,
  subscription: null,
  checkoutSession: null,
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

const DEFAULT_PLAN = {
  code: 'nexo-pessoal',
  name: 'NEXO Financeiro Pessoal',
  description: 'Controle de contas, cartões, faturas e planejamento financeiro em um único lugar.',
  price: 19.90,
  billing_cycle: 'monthly',
  provider: 'asaas'
};

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

  // Assinatura carrega separadamente para não deixar a abertura do financeiro mais lenta.
  loadBillingData();

  // A sincronização das faturas roda em segundo plano.
  // Assim ela não segura a abertura do sistema.
  setTimeout(async () => {
    try {
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
    const [planRes, subscriptionRes, checkoutRes] = await Promise.all([
      sb.from('plans').select('*').eq('code', 'nexo-pessoal').eq('active', true).maybeSingle(),
      sb.from('subscriptions').select('*').eq('user_id', uid()).maybeSingle(),
      sb.from('asaas_checkout_sessions').select('*').eq('user_id', uid()).order('created_at', { ascending: false }).limit(1).maybeSingle()
    ]);

    if (planRes.error) console.warn('Planos ainda não disponíveis:', planRes.error.message);
    if (subscriptionRes.error) console.warn('Assinatura ainda não disponível:', subscriptionRes.error.message);
    if (checkoutRes.error) console.warn('Checkout Asaas ainda não disponível:', checkoutRes.error.message);

    state.plan = planRes.data || DEFAULT_PLAN;
    state.subscription = subscriptionRes.data || null;
    state.checkoutSession = checkoutRes.data || null;
  } catch (error) {
    console.warn('Não foi possível carregar a assinatura:', error);
    state.plan = DEFAULT_PLAN;
    state.subscription = null;
    state.checkoutSession = null;
  } finally {
    state.billingLoaded = true;
    renderSubscription();
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
  if (!$('subscriptionPlanName')) return;

  const plan = state.plan || DEFAULT_PLAN;
  const subscription = state.subscription;
  const checkout = state.checkoutSession;
  const status = subscriptionStatusKey();
  const active = ['active','trialing','grace'].includes(status);
  const checkoutStillValid = checkout && ['active','pending','initiated'].includes(checkout.status) && (!checkout.expires_at || new Date(checkout.expires_at).getTime() > Date.now());

  $('subscriptionPlanName').textContent = plan.name || DEFAULT_PLAN.name;
  $('subscriptionPlanDescription').textContent = plan.description || DEFAULT_PLAN.description;
  $('subscriptionDetailPlan').textContent = plan.name || DEFAULT_PLAN.name;
  $('subscriptionPrice').textContent = money(planPrice(plan));

  const badge = $('subscriptionStatusBadge');
  badge.className = `subscription-status subscription-status-${status}`;
  badge.textContent = state.billingLoaded ? subscriptionStatusLabel(status) : 'Carregando...';

  $('subscriptionDetailStatus').textContent = state.billingLoaded ? subscriptionStatusLabel(status) : 'Carregando...';
  $('subscriptionDetailStarted').textContent = subscription?.started_at ? fmtDate(String(subscription.started_at).slice(0,10)) : '—';
  $('subscriptionDetailNextBilling').textContent = subscription?.next_billing_at ? fmtDate(String(subscription.next_billing_at).slice(0,10)) : '—';
  $('subscriptionDetailLastPayment').textContent = subscription?.last_payment_at ? new Date(subscription.last_payment_at).toLocaleString('pt-BR') : '—';

  const subscribeBtn = $('subscribePlanBtn');
  subscribeBtn.disabled = !state.billingLoaded || active;
  if (active) {
    subscribeBtn.textContent = 'Assinatura ativa ✓';
  } else if (checkoutStillValid && checkout.checkout_url) {
    subscribeBtn.textContent = 'Continuar pagamento';
  } else {
    subscribeBtn.textContent = `Assinar por ${money(planPrice(plan))}/mês`;
  }

  const help = $('subscriptionActionHelp');
  if (!state.billingLoaded) {
    help.textContent = 'Carregando informações da assinatura...';
  } else if (active) {
    help.textContent = 'Sua assinatura está liberada. As próximas cobranças são acompanhadas automaticamente pelo Asaas.';
  } else if (status === 'past_due') {
    help.textContent = 'A última cobrança está pendente. Regularize o pagamento para manter o acesso.';
  } else if (status === 'suspended') {
    help.textContent = 'A assinatura está suspensa. Entre em contato com o suporte ou realize uma nova assinatura.';
  } else if (checkoutStillValid) {
    help.textContent = 'Seu checkout ainda está ativo. Continue o pagamento; a liberação acontece automaticamente após a confirmação.';
  } else {
    help.textContent = 'Você será levado ao checkout seguro do Asaas. Depois do pagamento, não é necessário avisar o suporte.';
  }

  const checkoutBox = $('subscriptionCheckoutBox');
  if (checkout) {
    checkoutBox.classList.remove('hidden');
    checkoutBox.innerHTML = `<strong>Último checkout</strong><span>${escapeHtml(checkoutStatusLabel(checkout.status))}</span><small>Criado em ${new Date(checkout.created_at).toLocaleString('pt-BR')}</small>`;
  } else {
    checkoutBox.classList.add('hidden');
    checkoutBox.innerHTML = '';
  }
}

async function startAsaasCheckout() {
  if (!state.billingLoaded) return;
  if (['active','trialing','grace'].includes(subscriptionStatusKey())) return alert('Sua assinatura já está ativa.');

  const existing = state.checkoutSession;
  const existingValid = existing && ['active','pending','initiated'].includes(existing.status) && existing.checkout_url && (!existing.expires_at || new Date(existing.expires_at).getTime() > Date.now());
  if (existingValid) {
    window.location.href = existing.checkout_url;
    return;
  }

  const btn = $('subscribePlanBtn');
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Abrindo checkout...';

  try {
    const { data, error } = await sb.functions.invoke('nexo-admin', {
      body: { action: 'create_asaas_checkout' }
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
    btn.disabled = false;
    btn.textContent = oldText;
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
  renderUser();
  fillSelects();
  renderDashboard();
  renderTransactions();
  renderPlanning();
  renderCards();
  renderAccounts();
  renderSubscription();
  renderSettings();
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
  $('monthFilter').addEventListener('change', e=>{ state.selectedMonth=e.target.value; renderAll(); });

  document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', ()=>switchView(btn.dataset.view)));
  document.querySelectorAll('[data-jump]').forEach(btn => btn.addEventListener('click', ()=>switchView(btn.dataset.jump)));

  ['quickAddTop','mobileQuickAdd','newTransactionBtn'].forEach(id => $(id).addEventListener('click', ()=>openTransaction()));
  $('newAccountBtn').addEventListener('click', ()=>openAccount());
  $('newCardBtn').addEventListener('click', ()=>openCard());
  $('newCategoryBtn').addEventListener('click', ()=>openCategory());
  $('newIncomeSourceBtn').addEventListener('click', ()=>openIncomeSource());
  $('subscribePlanBtn').addEventListener('click', startAsaasCheckout);

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
  $('accountForm').reset(); $('accountId').value=id;
  if(id){const a=byId(state.accounts,id); $('accountName').value=a.name; $('accountType').value=a.type; $('accountBalance').value=Number(a.balance).toFixed(2).replace('.',',');}
  $('accountModal').showModal();
}
async function saveAccount(e){e.preventDefault();const id=$('accountId').value;const payload={user_id:uid(),name:$('accountName').value.trim(),type:$('accountType').value,balance:parseMoney($('accountBalance').value)};const q=id?sb.from('accounts').update(payload).eq('id',id).eq('user_id',uid()):sb.from('accounts').insert(payload);const{error}=await q;if(error)return alert(error.message);$('accountModal').close();await refresh();}

function openCard(id='') {
  $('cardForm').reset(); $('cardId').value=id; fillSelects();
  if(id){const c=byId(state.cards,id);$('cardName').value=c.name;$('cardIssuer').value=c.issuer||'';$('cardLimit').value=Number(c.credit_limit).toFixed(2).replace('.',',');$('cardClosingDay').value=c.closing_day;$('cardDueDay').value=c.due_day;$('cardPaymentAccount').value=c.payment_account_id||'';}
  $('cardModal').showModal();
}
async function saveCard(e){
  e.preventDefault();
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

function openCategory(id=''){ $('categoryForm').reset();$('categoryId').value=id;if(id){const c=byId(state.categories,id);$('categoryName').value=c.name;$('categoryGroup').value=c.group_name;$('categoryIcon').value=c.icon||'';}$('categoryModal').showModal();}
async function saveCategory(e){e.preventDefault();const id=$('categoryId').value;const payload={user_id:uid(),name:$('categoryName').value.trim(),group_name:$('categoryGroup').value,icon:$('categoryIcon').value.trim()||null};const q=id?sb.from('categories').update(payload).eq('id',id).eq('user_id',uid()):sb.from('categories').insert(payload);const{error}=await q;if(error)return alert(error.message);$('categoryModal').close();await refresh();}

function openIncomeSource(id=''){ $('incomeSourceForm').reset();$('incomeSourceId').value=id;if(id){const s=byId(state.incomeSources,id);$('incomeSourceName').value=s.name;$('incomeSourceType').value=s.source_type;$('incomeSourceDefaultAmount').value=s.default_amount?Number(s.default_amount).toFixed(2).replace('.',','):'';$('incomeSourceDay').value=s.expected_day||'';}$('incomeSourceModal').showModal();}
async function saveIncomeSource(e){e.preventDefault();const id=$('incomeSourceId').value;const amt=parseMoney($('incomeSourceDefaultAmount').value);const payload={user_id:uid(),name:$('incomeSourceName').value.trim(),source_type:$('incomeSourceType').value,default_amount:amt||null,expected_day:$('incomeSourceDay').value?Number($('incomeSourceDay').value):null};const q=id?sb.from('income_sources').update(payload).eq('id',id).eq('user_id',uid()):sb.from('income_sources').insert(payload);const{error}=await q;if(error)return alert(error.message);$('incomeSourceModal').close();await refresh();}

async function refresh(){
  await loadData();
  renderAll();
}

init();
