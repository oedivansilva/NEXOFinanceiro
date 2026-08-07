const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const state = {
  user: null,
  profile: null,
  accounts: [],
  cards: [],
  categories: [],
  incomeSources: [],
  transactions: [],
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
  if (t.due_date < isoToday()) return 'overdue';
  return 'pending';
}

function statusLabel(t) {
  const s = statusOf(t);
  return { paid:'Pago', pending:'Pendente', overdue:'Atrasado', cancelled:'Cancelado' }[s];
}

function byId(list, id) { return list.find(x => x.id === id); }

async function init() {
  if (!window.SUPABASE_URL || window.SUPABASE_URL.includes('SEU-PROJETO')) {
    alert('Configure js/supabase-config.js com a URL e a chave pública do Supabase.');
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
  await loadData();
  await ensureDefaults();
  await loadData();
  renderAll();
}

async function loadData() {
  const [profile, accounts, cards, categories, incomeSources, transactions] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid()).maybeSingle(),
    sb.from('accounts').select('*').eq('user_id', uid()).eq('is_active', true).order('created_at'),
    sb.from('cards').select('*').eq('user_id', uid()).eq('is_active', true).order('created_at'),
    sb.from('categories').select('*').eq('user_id', uid()).eq('is_active', true).order('name'),
    sb.from('income_sources').select('*').eq('user_id', uid()).eq('is_active', true).order('name'),
    sb.from('transactions').select('*').eq('user_id', uid()).order('due_date', { ascending: false }).limit(1000)
  ]);

  const errors = [profile, accounts, cards, categories, incomeSources, transactions].map(r => r.error).filter(Boolean);
  if (errors.length) console.error(errors);

  state.profile = profile.data || null;
  state.accounts = accounts.data || [];
  state.cards = cards.data || [];
  state.categories = categories.data || [];
  state.incomeSources = incomeSources.data || [];
  state.transactions = transactions.data || [];
}

async function ensureDefaults() {
  if (!state.categories.length) {
    await sb.from('categories').insert([
      { user_id: uid(), name: 'Alimentação', group_name: 'essential', icon: '🍔' },
      { user_id: uid(), name: 'Transporte', group_name: 'essential', icon: '🚗' },
      { user_id: uid(), name: 'Educação', group_name: 'essential', icon: '🎓' },
      { user_id: uid(), name: 'Assinaturas', group_name: 'subscription', icon: '📱' },
      { user_id: uid(), name: 'Lazer', group_name: 'leisure', icon: '🎉' },
      { user_id: uid(), name: 'Moradia', group_name: 'essential', icon: '🏠' },
      { user_id: uid(), name: 'Saúde', group_name: 'essential', icon: '❤️' },
      { user_id: uid(), name: 'Outros', group_name: 'other', icon: '🏷️' }
    ]);
  }
  if (!state.incomeSources.length) {
    await sb.from('income_sources').insert([
      { user_id: uid(), name: 'Salário', source_type: 'recurring' },
      { user_id: uid(), name: 'Outros', source_type: 'other' }
    ]);
  }
}

function renderAll() {
  renderUser();
  fillSelects();
  renderDashboard();
  renderTransactions();
  renderPlanning();
  renderCards();
  renderAccounts();
  renderSettings();
}

function renderUser() {
  const name = state.profile?.full_name || state.user?.user_metadata?.full_name || state.user?.email || 'Usuário';
  $('userMini').textContent = name;
}

function fillSelects() {
  const accountOptions = `<option value="">Selecione</option>` + state.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  ['transactionAccount','incomeAccount','cardPaymentAccount'].forEach(id => $(id).innerHTML = accountOptions);
  $('transactionCard').innerHTML = `<option value="">Selecione</option>` + state.cards.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  $('transactionCategory').innerHTML = `<option value="">Selecione</option>` + state.categories.map(c => `<option value="${c.id}">${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</option>`).join('');
  $('transactionIncomeSource').innerHTML = `<option value="">Selecione</option>` + state.incomeSources.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
}

function monthTransactions() {
  const { start, end } = monthRange(state.selectedMonth);
  return state.transactions.filter(t => t.due_date >= start && t.due_date <= end && t.status !== 'cancelled');
}

function renderDashboard() {
  const monthTx = monthTransactions();
  const balance = state.accounts.reduce((s,a) => s + Number(a.balance), 0);
  const income = monthTx.filter(t => t.type === 'income').reduce((s,t)=>s+Number(t.amount),0);
  const expense = monthTx.filter(t => t.type === 'expense').reduce((s,t)=>s+Number(t.amount),0);
  const pendingIncome = monthTx.filter(t => t.type === 'income' && t.status !== 'paid').reduce((s,t)=>s+Number(t.amount),0);
  const pendingExpense = monthTx.filter(t => t.type === 'expense' && t.status !== 'paid').reduce((s,t)=>s+Number(t.amount),0);
  const projected = balance + pendingIncome - pendingExpense;

  $('balanceTotal').textContent = money(balance);
  $('incomeMonth').textContent = money(income);
  $('expenseMonth').textContent = money(expense);
  $('projectedBalance').textContent = money(projected);

  const upcoming = state.transactions
    .filter(t => t.type === 'expense' && t.status === 'pending' && t.status !== 'cancelled')
    .sort((a,b)=>a.due_date.localeCompare(b.due_date)).slice(0,6);
  $('upcomingList').classList.toggle('empty-state', !upcoming.length);
  $('upcomingList').innerHTML = upcoming.length ? upcoming.map(t => `
    <div class="list-item">
      <div class="list-item-main"><div class="list-item-title">${escapeHtml(t.description)}</div><div class="list-item-sub">Vence ${fmtDate(t.due_date)} · ${paymentLabel(t)}</div></div>
      <div><div class="amount-expense">${money(t.amount)}</div><span class="status-badge status-${statusOf(t)}">${statusLabel(t)}</span></div>
    </div>`).join('') : 'Nenhuma conta pendente.';

  const cardInfo = getCardsWithUsage();
  $('dashboardCards').classList.toggle('empty-state', !cardInfo.length);
  $('dashboardCards').innerHTML = cardInfo.length ? cardInfo.map(c => {
    const pct = c.limit ? Math.min(100, (c.used / c.limit) * 100) : 0;
    return `<div class="list-item"><div class="list-item-main" style="width:100%"><div class="list-item-title">💳 ${escapeHtml(c.name)}</div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><div class="list-item-sub">Usado ${money(c.used)} · Disponível ${money(c.available)}</div></div></div>`;
  }).join('') : 'Nenhum cartão cadastrado.';

  const recent = [...state.transactions].sort((a,b)=> (b.created_at || '').localeCompare(a.created_at || '')).slice(0,7);
  $('recentTransactions').innerHTML = tableTransactions(recent, false);
}

function paymentLabel(t) {
  if (t.type === 'income') return byId(state.accounts, t.account_id)?.name || 'Receita';
  if (t.payment_method === 'credit') return byId(state.cards, t.card_id)?.name || 'Crédito';
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
      ${actions ? `<td><div class="table-actions">${t.status==='pending'?`<button class="mini-btn success" data-pay="${t.id}">${t.type==='expense'?'Marcar pago':'Recebido'}</button><button class="mini-btn danger" data-cancel="${t.id}">Cancelar</button>`:''}</div></td>`:''}
    </tr>`;
  }).join('') + '</tbody></table>';
}

function renderTransactions() {
  const typeFilter = $('transactionTypeFilter').value || 'all';
  const statusFilter = $('transactionStatusFilter').value || 'all';
  let items = monthTransactions();
  if (typeFilter !== 'all') items = items.filter(t => t.type === typeFilter);
  if (statusFilter !== 'all') items = items.filter(t => statusOf(t) === statusFilter);
  items.sort((a,b)=>b.due_date.localeCompare(a.due_date));
  $('transactionsTable').innerHTML = tableTransactions(items, true);
}

function renderPlanning() {
  const items = monthTransactions();
  const income = items.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount),0);
  const expenses = items.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount),0);
  const realized = items.filter(t=>t.status==='paid').reduce((s,t)=>s + (t.type==='income'?Number(t.amount):-Number(t.amount)),0);
  $('planningIncome').textContent = money(income);
  $('planningExpenses').textContent = money(expenses);
  $('planningPaid').textContent = money(realized);
  $('planningResult').textContent = money(income-expenses);
  $('planningTable').innerHTML = tableTransactions(items.sort((a,b)=>a.due_date.localeCompare(b.due_date)), false);
}

function getCardsWithUsage() {
  return state.cards.map(c => {
    const used = state.transactions
      .filter(t => t.type==='expense' && t.payment_method==='credit' && t.card_id===c.id && t.status==='pending')
      .reduce((s,t)=>s+Number(t.amount),0);
    const limit = Number(c.credit_limit || 0);
    return { ...c, limit, used, available: Math.max(0, limit-used) };
  });
}

function renderCards() {
  const info = getCardsWithUsage();
  $('cardsGrid').innerHTML = info.length ? info.map(c => {
    const pct = c.limit ? Math.min(100,(c.used/c.limit)*100) : 0;
    const account = byId(state.accounts, c.payment_account_id);
    return `<article class="entity-card">
      <div class="entity-card-head"><div><h3>💳 ${escapeHtml(c.name)}</h3><small>${escapeHtml(c.issuer || 'Cartão de crédito')}</small></div><button class="mini-btn" data-edit-card="${c.id}">Editar</button></div>
      <div class="metric-line"><span>Limite total</span><strong>${money(c.limit)}</strong></div>
      <div class="metric-line"><span>Limite usado</span><strong>${money(c.used)}</strong></div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="metric-line"><span>Disponível</span><strong>${money(c.available)}</strong></div>
      <div class="metric-line"><span>Fecha / vence</span><span>Dia ${c.closing_day} / ${c.due_day}</span></div>
      <div class="metric-line"><span>Conta de pagamento</span><span>${escapeHtml(account?.name || 'Não definida')}</span></div>
    </article>`;
  }).join('') : '<div class="empty-state">Nenhum cartão cadastrado. Crie o primeiro para acompanhar limite e fatura.</div>';
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

  $('transactionTypeFilter').addEventListener('change', renderTransactions);
  $('transactionStatusFilter').addEventListener('change', renderTransactions);

  document.body.addEventListener('click', async (e)=>{
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
  const titles={dashboard:'Visão geral',transactions:'Lançamentos',planning:'Planejamento',cards:'Cartões',accounts:'Contas',settings:'Cadastros financeiros'};
  $('viewTitle').textContent=titles[view]||'NEXO Financeiro';
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
  await refresh();
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
  const label=t.type==='expense'?'marcar esta conta como paga':'marcar esta receita como recebida';
  if(!confirm(`Deseja ${label}?`))return;
  await applyBalanceForTransaction(t,1);
  const {error}=await sb.from('transactions').update({status:'paid',paid_at:isoToday()}).eq('id',id).eq('user_id',uid());
  if(error) return alert('Erro: '+error.message);
  await refresh();
}

async function cancelTransaction(id) {
  const t=state.transactions.find(x=>x.id===id); if(!t||t.status!=='pending')return;
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
async function saveCard(e){e.preventDefault();const id=$('cardId').value;const payload={user_id:uid(),name:$('cardName').value.trim(),issuer:$('cardIssuer').value.trim()||null,credit_limit:parseMoney($('cardLimit').value),closing_day:Number($('cardClosingDay').value),due_day:Number($('cardDueDay').value),payment_account_id:$('cardPaymentAccount').value||null};const q=id?sb.from('cards').update(payload).eq('id',id).eq('user_id',uid()):sb.from('cards').insert(payload);const{error}=await q;if(error)return alert(error.message);$('cardModal').close();await refresh();}

function openCategory(id=''){ $('categoryForm').reset();$('categoryId').value=id;if(id){const c=byId(state.categories,id);$('categoryName').value=c.name;$('categoryGroup').value=c.group_name;$('categoryIcon').value=c.icon||'';}$('categoryModal').showModal();}
async function saveCategory(e){e.preventDefault();const id=$('categoryId').value;const payload={user_id:uid(),name:$('categoryName').value.trim(),group_name:$('categoryGroup').value,icon:$('categoryIcon').value.trim()||null};const q=id?sb.from('categories').update(payload).eq('id',id).eq('user_id',uid()):sb.from('categories').insert(payload);const{error}=await q;if(error)return alert(error.message);$('categoryModal').close();await refresh();}

function openIncomeSource(id=''){ $('incomeSourceForm').reset();$('incomeSourceId').value=id;if(id){const s=byId(state.incomeSources,id);$('incomeSourceName').value=s.name;$('incomeSourceType').value=s.source_type;$('incomeSourceDefaultAmount').value=s.default_amount?Number(s.default_amount).toFixed(2).replace('.',','):'';$('incomeSourceDay').value=s.expected_day||'';}$('incomeSourceModal').showModal();}
async function saveIncomeSource(e){e.preventDefault();const id=$('incomeSourceId').value;const amt=parseMoney($('incomeSourceDefaultAmount').value);const payload={user_id:uid(),name:$('incomeSourceName').value.trim(),source_type:$('incomeSourceType').value,default_amount:amt||null,expected_day:$('incomeSourceDay').value?Number($('incomeSourceDay').value):null};const q=id?sb.from('income_sources').update(payload).eq('id',id).eq('user_id',uid()):sb.from('income_sources').insert(payload);const{error}=await q;if(error)return alert(error.message);$('incomeSourceModal').close();await refresh();}

async function refresh(){await loadData();renderAll();}

init();
