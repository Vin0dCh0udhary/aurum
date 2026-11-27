const $ = (s) => document.querySelector(s);
const $m = (s) => document.querySelector('#modal ' + s);
const app = $('#app'), modal = $('#modal'), bNav = $('#bottom-nav'), dNav = $('#desktop-nav');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const g4 = (n) => Number(n).toFixed(4) + ' g';
const when = (ms) => {
  if (!ms) return '–';
  const n = typeof ms === 'number' ? ms : (typeof ms === 'string' && /^\d+$/.test(ms) ? Number(ms) : ms);
  const d = new Date(n);
  return isNaN(d.getTime()) ? '–' : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

let cfg, session = JSON.parse(localStorage.getItem('session') || 'null'), timer;
let activeTab = 'home'; // customer: home | schemes | rates | ledger | profile; jeweller: today | customers | ledger | staff | setup

async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(session ? { authorization: 'Bearer ' + session.token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && session) { logout(); throw new Error(j.error); }
  if (!r.ok) throw new Error(j.error || 'Something went wrong');
  return j;
}

function toast(m, type = 'info') {
  let tc = $('#toast-container');
  if (!tc) {
    tc = document.createElement('div');
    tc.id = 'toast-container';
    tc.className = 'toast-container';
    document.body.appendChild(tc);
  }
  const el = document.createElement('div');
  el.className = `toast-msg ${type}`;
  const icon = type === 'success' 
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--emerald)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    : type === 'error'
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--rose)" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  el.innerHTML = `${icon}<span>${esc(m)}</span>`;
  tc.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(() => el.remove(), 250);
  }, 4000);
}

const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 'error'); } };

function logout() {
  session = null;
  localStorage.removeItem('session');
  clearInterval(timer);
  bNav.classList.add('hidden');
  dNav.style.display = 'none';
  $('#hdr-showroom-badge').style.display = 'none';
  landing();
}

const closeModal = () => {
  modal.classList.add('hidden');
  modal.innerHTML = '';
};

const openModal = (html, widthClass = '') => {
  modal.innerHTML = `
    <div class="modal-card ${widthClass}">
      <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
        <button class="icon-action-btn" id="modal-close-x" style="width:30px;height:30px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      ${html}
    </div>`;
  modal.classList.remove('hidden');
  const card = modal.querySelector('.modal-card');
  if (card) card.scrollTop = 0;
  modal.scrollTop = 0;
  $m('#modal-close-x').onclick = closeModal;
};

modal.onclick = (e) => {
  if (e.target === modal) closeModal();
};

const autoRefresh = (fn) => {
  clearInterval(timer);
  timer = setInterval(() => {
    if (modal.classList.contains('hidden') && !document.activeElement?.matches('input,select')) fn();
  }, 20000);
};

// Update top continuous TradingView commodity ticker
function updateLiveTicker(rates) {
  const tc = $('#ticker-content');
  if (!tc || !rates?.rates) return;
  const r = rates.rates;
  const g24 = r.G24 ? inr(r.G24.perGram) : '₹12,660';
  const g22 = r.G22 ? inr(r.G22.perGram) : '₹11,597';
  const g18 = r.G18 ? inr(r.G18.perGram) : '₹9,495';
  const s999 = r.S999 ? inr(r.S999.perGram) : '₹146.50';

  const stripe = `
    <span class="ticker-item"><span class="ticker-dot gold"></span> 24K GOLD: ${g24}/g</span>
    <span class="ticker-item"><span class="ticker-dot gold"></span> 22K GOLD: ${g22}/g</span>
    <span class="ticker-item"><span class="ticker-dot gold"></span> 18K GOLD: ${g18}/g</span>
    <span class="ticker-item"><span class="ticker-dot silver"></span> 999 SILVER: ${s999}/g</span>
    <span class="ticker-item"><span class="ticker-badge">LIVE MCX</span> SPOT PARITY + DUTY + GST</span>
  `;
  tc.innerHTML = stripe + stripe;
}

// Statutory Compliance modal
async function showLegal(type) {
  const doc = await (await fetch(`/api/legal/${type}`)).json();
  const html = `
    <h3 style="font-size:20px;margin-bottom:6px;color:var(--ink-deep)">${esc(doc.title)}</h3>
    <div class="mute" style="font-size:12px;margin-bottom:16px">Version ${esc(doc.version)} · Statutory DPDP & Companies Act Notice</div>
    <div style="max-height:380px;overflow-y:auto;padding-right:6px">
      ${doc.sections.map(s => `
        <div style="margin-bottom:16px">
          <div style="font-weight:700;font-size:14px;color:var(--gold);margin-bottom:4px">${esc(s.heading)}</div>
          <div class="mute" style="font-size:12px;line-height:1.6">${esc(s.content)}</div>
        </div>
      `).join('')}
    </div>
    <button id="legal-close-btn" style="width:100%;margin-top:18px">Close Notice</button>`;
  openModal(html);
  $m('#legal-close-btn').onclick = closeModal;
}

// ---------------- Landing & Role Gate ----------------
function landing() {
  $('#btn-logout').style.display = 'none';
  bNav.classList.add('hidden');
  dNav.style.display = 'none';
  $('#hdr-showroom-badge').style.display = 'none';
  clearInterval(timer);

  app.innerHTML = `
  <div style="padding:28px 0 32px;text-align:center">
    <div class="pill ok" style="margin-bottom:14px">Digital Tech Partner for Retail Jewellers</div>
    <h1 style="font-size:38px;font-weight:800;letter-spacing:-0.03em;margin:0 0 10px;color:var(--ink-deep);line-height:1.15">
      Jewellery Savings Plan
    </h1>
    <p class="mute" style="font-size:15px;max-width:620px;margin:0 auto 28px;line-height:1.6">
      Save monthly with your retail jeweller. Accumulate 24K, 22K, 18K Gold and 999 Silver at live daily rates, and redeem for physical jewellery at Month 11.
    </p>

    <div class="row" style="justify-content:center;gap:16px;margin-bottom:36px">
      <button class="btn-save-advance" id="landing-customer-btn" style="padding:15px 30px;font-size:15px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
        Customer Login
      </button>
      <button class="btn-redeem-goods" id="landing-jeweller-btn" style="padding:15px 30px;font-size:15px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
        Jeweller Login
      </button>
    </div>
  </div>

  <!-- Live Market Board Preview on Landing -->
  <div class="card" style="margin-bottom:24px">
    <div class="board-header">
      <div class="board-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2.2"><line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
        Live Bullion Rates (₹ / Gram)
      </div>
      <span class="pill ok" id="live-rate-status-tag">Live · Refreshes every 10s</span>
    </div>
    <div id="landing-rates-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px"></div>
  </div>

  <div style="text-align:center;font-size:12px;color:var(--ink-secondary)">
    <div class="row" style="justify-content:center;gap:14px;margin-bottom:8px">
      <a href="#" id="l-terms" style="color:var(--gold);text-decoration:none;font-weight:700">Scheme Terms</a> ·
      <a href="#" id="l-priv" style="color:var(--gold);text-decoration:none;font-weight:700">Privacy (DPDP Act)</a> ·
      <a href="#" id="l-ref" style="color:var(--gold);text-decoration:none;font-weight:700">Day 364 Refund Guarantee</a>
    </div>
    ${esc(cfg?.disclaimer || '')}
  </div>`;

  $('#landing-customer-btn').onclick = () => login('customer');
  $('#landing-jeweller-btn').onclick = () => login('jeweller');
  $('#l-terms').onclick = (e) => { e.preventDefault(); showLegal('scheme-terms'); };
  $('#l-priv').onclick = (e) => { e.preventDefault(); showLegal('privacy-policy'); };
  $('#l-ref').onclick = (e) => { e.preventDefault(); showLegal('refund-policy'); };

  // Fetch live rates
  fetch('/api/rates').then(r => r.json()).then(rt => {
    if (rt && rt.rates) {
      updateLiveTicker(rt);
      renderLandingRatesGrid(rt);
    }
  }).catch(() => {});
}

function renderLandingRatesGrid(rates) {
  const el = $('#landing-rates-grid');
  if (!el || !rates?.rates) return;
  const prods = cfg?.products ? Object.entries(cfg.products) : [
    ['G24', { label: 'Gold 24K (999)', metal: 'GOLD', purity: 1 }],
    ['G22', { label: 'Gold 22K (916)', metal: 'GOLD', purity: 0.916 }],
    ['G18', { label: 'Gold 18K (750)', metal: 'GOLD', purity: 0.75 }],
    ['S999', { label: 'Silver 999', metal: 'SILVER', purity: 1 }],
  ];

  el.innerHTML = prods.map(([k, p]) => {
    const rObj = rates.rates[k];
    const isSilver = k.startsWith('S') || p.metal === 'SILVER';
    return `
      <div class="rate-card-item">
        <div class="rate-item-left">
          <div class="metal-badge-sq ${isSilver ? 'silver' : ''}">${isSilver ? 'AG' : 'AU'}</div>
          <div>
            <div class="rate-item-title">${esc(p.label)}</div>
            <div class="rate-item-sub">${p.metal} (${(p.purity * 100).toFixed(1)}%)</div>
          </div>
        </div>
        <div class="rate-item-price">${rObj ? inr(rObj.perGram) : '–'}<span style="font-size:10px;color:var(--ink-secondary)">/g</span></div>
      </div>
    `;
  }).join('');
}

// ---------------- Mobile Verification (OTP) ----------------
function login(role) {
  $('#btn-logout').style.display = 'none';
  bNav.classList.add('hidden');
  dNav.style.display = 'none';
  $('#hdr-showroom-badge').style.display = 'none';

  app.innerHTML = `
  <div style="max-width:440px;margin:30px auto">
    <div class="card" style="padding:32px 28px">
      <div style="text-align:center;margin-bottom:24px">
        <div class="brand-icon" style="width:50px;height:50px;margin:0 auto 14px">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
        </div>
        <h2 style="font-size:22px;font-weight:800;color:var(--ink-deep);margin:0 0 6px">${role === 'customer' ? 'Customer' : 'Jeweller'} Login</h2>
        <p class="mute" style="font-size:13px;margin:0">Enter your mobile number or email to receive a verification code</p>
      </div>

      <div id="step-phone">
        <label>Mobile Number or Email</label>
        <div class="row" style="margin-bottom:18px">
          <input id="ph" type="text" placeholder="9876543210 or email" style="flex:1;font-family:var(--font-mono);font-size:16px">
        </div>
        <button id="send-otp" style="width:100%;padding:15px">Get Verification Code</button>
      </div>

      <div id="step-otp" class="hidden" style="margin-top:16px">
        <div class="row between" style="margin-bottom:6px">
          <label style="margin:0">Verification Code</label>
          <button type="button" id="btn-prefill-otp" class="chip" style="cursor:pointer;font-size:11px;background:var(--emerald-bg);border-color:var(--emerald-border);color:var(--emerald)">Fill 123456</button>
        </div>
        <input id="otp" type="tel" maxlength="6" placeholder="123456" style="font-family:var(--font-mono);font-size:24px;letter-spacing:6px;text-align:center;margin-bottom:16px">
        
        <div id="step-totp" class="hidden" style="margin-bottom:16px">
          <label>2FA Authenticator Code</label>
          <input id="totp" type="tel" maxlength="6" placeholder="000000" style="font-family:var(--font-mono);font-size:18px;letter-spacing:4px;text-align:center">
        </div>

        <button id="verify-otp" style="width:100%;padding:15px">Verify & Proceed</button>
      </div>

      <div style="margin-top:20px;text-align:center">
        <button class="ghost small" id="back-landing">Back to Home</button>
      </div>
    </div>
  </div>`;

  $('#back-landing').onclick = landing;

  $('#send-otp').onclick = guard(async () => {
    const phone = $('#ph').value.trim();
    if (!phone) return toast('Please enter a mobile number or email.');
    const r = await api('POST', '/api/auth/otp/send', { phone, role });
    $('#step-phone').classList.add('hidden');
    $('#step-otp').classList.remove('hidden');
    $('#otp').value = r.demo_otp || '123456';
    $('#btn-prefill-otp').onclick = () => { $('#otp').value = '123456'; };
  });

  $('#verify-otp').onclick = guard(async () => {
    const phone = $('#ph').value.trim();
    const otp = $('#otp').value.trim() || '123456';
    const totp = $('#totp')?.value.trim();
    const r = await api('POST', '/api/auth/otp/verify', { phone, otp, role, totp });
    if (r.require_2fa || r.needs2fa) {
      $('#step-totp').classList.remove('hidden');
      return toast('Please enter your 6-digit Authenticator code.');
    }
    session = { token: r.token, role: role, phone };
    localStorage.setItem('session', JSON.stringify(session));
    start();
  });
}

// ---------------- Customer App ----------------
async function customer() {
  $('#btn-logout').style.display = 'flex';
  $('#btn-logout').onclick = logout;
  $('#btn-brand-home').onclick = () => { activeTab = 'home'; customer(); };

  if (activeTab === 'passbook') activeTab = 'ledger';
  if (activeTab === 'plans') activeTab = 'schemes';
  if (!['home', 'schemes', 'rates', 'ledger', 'profile'].includes(activeTab)) {
    activeTab = 'home';
  }

  const me = await api('GET', '/api/customer/me');
  if (me.rates) updateLiveTicker(me.rates);

  // 1. Mandatory Identity Onboarding (Name, DOB 18+, Personal PAN)
  const isProfileComplete = !!(me.profile_complete || me.profileDone || (me.name && me.pan_masked));
  if (!isProfileComplete) return profileForm();

  // 2. Jeweller Code Gate (Permanent 6-char Shop Code / Single-Use Counter Invite Code)
  if (!me.jeweller) return joinForm();

  // 3. Optional Counter Approval Gate
  if (me.link_status === 'PENDING') {
    dNav.style.display = 'none';
    bNav.classList.add('hidden');
    if (me.jeweller?.shop_name) {
      $('#hdr-showroom-badge').style.display = 'flex';
      $('#hdr-showroom-name').textContent = me.jeweller.shop_name;
    } else {
      $('#hdr-showroom-badge').style.display = 'none';
    }
    app.innerHTML = `
      <div class="card" style="max-width:540px;margin:40px auto;text-align:center;padding:36px">
        <div class="brand-icon" style="width:56px;height:56px;margin:0 auto 16px">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </div>
        <h2 style="font-size:22px;color:var(--ink-deep);margin:0 0 8px">Membership Approval Pending</h2>
        <p class="mute" style="font-size:14px;line-height:1.6">You have linked with <b>${esc(me.jeweller.shop_name)}</b>. Showroom staff will approve your counter enrolment shortly.</p>
      </div>`;
    autoRefresh(customer);
    return;
  }

  if (me.jeweller?.shop_name) {
    $('#hdr-showroom-badge').style.display = 'flex';
    $('#hdr-showroom-name').textContent = me.jeweller.shop_name;
  } else {
    $('#hdr-showroom-badge').style.display = 'none';
  }
  renderNavigations();
  renderCustomerView(me);

  autoRefresh(async () => {
    const updated = await api('GET', '/api/customer/me');
    if (updated.rates) updateLiveTicker(updated.rates);
    renderCustomerView(updated);
  });
}

function renderNavigations() {
  // Desktop Nav Links
  dNav.style.display = 'flex';
  dNav.innerHTML = `
    <button class="nav-link ${activeTab === 'home' ? 'active' : ''}" data-tab="home">Dashboard</button>
    <button class="nav-link ${activeTab === 'schemes' ? 'active' : ''}" data-tab="schemes">Plans</button>
    <button class="nav-link ${activeTab === 'rates' ? 'active' : ''}" data-tab="rates">Live Rates</button>
    <button class="nav-link ${activeTab === 'ledger' ? 'active' : ''}" data-tab="ledger">Passbook</button>
    <button class="nav-link ${activeTab === 'profile' ? 'active' : ''}" data-tab="profile">Profile</button>
  `;
  dNav.querySelectorAll('[data-tab]').forEach(b => {
    b.onclick = () => { activeTab = b.dataset.tab; customer(); };
  });

  // Mobile Bottom Nav
  bNav.classList.remove('hidden');
  const tabs = [
    { id: 'home', label: 'Overview', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>` },
    { id: 'schemes', label: 'Schemes', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>` },
    { id: 'rates', label: 'Rates', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>` },
    { id: 'ledger', label: 'Passbook', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>` },
    { id: 'profile', label: 'Profile', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>` },
  ];

  bNav.innerHTML = tabs.map(t => `
    <button class="nav-tab-item ${activeTab === t.id ? 'active' : ''}" data-nav="${t.id}">
      ${t.icon}
      <span class="nav-tab-label">${t.label}</span>
    </button>
  `).join('');

  bNav.querySelectorAll('[data-nav]').forEach(b => {
    b.onclick = () => { activeTab = b.dataset.nav; customer(); };
  });
}

function renderCustomerView(me) {
  if (activeTab === 'home') renderCustomerOverview(me);
  else if (activeTab === 'schemes') renderCustomerSchemes(me);
  else if (activeTab === 'rates') renderCustomerRates(me);
  else if (activeTab === 'ledger') renderCustomerLedger(me);
  else if (activeTab === 'profile') renderCustomerProfile(me);
}

// ---------------- 1. Customer Overview Dashboard (High-Contrast Hero + Live Grid) ----------------
function renderCustomerOverview(me) {
  const p = me.portfolio || {};
  const enrs = me.enrolments || [];
  const pays = me.payments || [];
  const totalValue = p.totalValue != null ? p.totalValue : enrs.reduce((acc, e) => acc + (e.valueNow || 0), 0);
  const totalPaid = p.totalPaid != null ? p.totalPaid : enrs.reduce((acc, e) => acc + (e.totalPaid || 0), 0);
  const goldGrams = p.goldGrams != null ? p.goldGrams : enrs.filter(e => e.metal !== 'SILVER').reduce((acc, e) => acc + (e.grams || 0), 0);
  const silverGrams = p.silverGrams != null ? p.silverGrams : enrs.filter(e => e.metal === 'SILVER').reduce((acc, e) => acc + (e.grams || 0), 0);
  const totalGrams = p.totalGrams != null ? p.totalGrams : (goldGrams + silverGrams);
  const goldValue = p.goldValue != null ? p.goldValue : enrs.filter(e => e.metal !== 'SILVER').reduce((acc, e) => acc + (e.valueNow || 0), 0);
  const silverValue = p.silverValue != null ? p.silverValue : enrs.filter(e => e.metal === 'SILVER').reduce((acc, e) => acc + (e.valueNow || 0), 0);

  const primaryEnrol = enrs[0];
  const maxM = primaryEnrol ? Math.min(11, primaryEnrol.dueSoFar || 1) : 0;
  const pct = primaryEnrol ? Math.min(100, Math.round(((primaryEnrol.dueSoFar || 1) / (primaryEnrol.totalInstalments || 11)) * 100)) : 0;

  // Build individual asset holdings map
  const prods = cfg?.products ? Object.entries(cfg.products) : [];
  const assetCardsHtml = prods.map(([k, prod]) => {
    const isSilv = k.startsWith('S') || prod.metal === 'SILVER';
    const matchingEnrs = enrs.filter(e => e.product === k);
    const grams = matchingEnrs.reduce((a, b) => a + (b.grams || 0), 0);
    const paid = matchingEnrs.reduce((a, b) => a + (b.totalPaid || 0), 0);
    const val = matchingEnrs.reduce((a, b) => a + (b.valueNow || 0), 0);
    const liveRate = me.rates?.rates?.[k]?.perGram || 0;

    return `
      <div class="card ${isSilv ? 'silver-bullion-card' : 'gold-bullion-card'}" style="padding:22px;border-radius:var(--radius-md);display:flex;flex-direction:column;gap:14px">
        <div class="row between" style="width:100%">
          <div class="row" style="gap:12px">
            <div class="metal-badge-sq ${isSilv ? 'silver' : ''}" style="width:44px;height:44px;font-size:14px">${isSilv ? 'AG' : 'AU'}</div>
            <div>
              <b style="font-size:16px;color:var(--ink-deep);display:block;margin-bottom:2px">${esc(prod.label)}</b>
              <div class="mute" style="font-size:12px">${prod.metal} · Live Rate: <b style="color:${isSilv ? '#0f172a' : '#8a5d05'}">${liveRate ? inr(liveRate) + '/g' : '–'}</b></div>
            </div>
          </div>
          <span class="pill ${grams > 0 ? 'ok' : ''}" style="font-size:10px">${grams > 0 ? 'Holding Active' : 'Available'}</span>
        </div>
        <div class="row between" style="width:100%;border-top:1px solid ${isSilv ? 'rgba(148,163,184,0.3)' : 'rgba(212,160,23,0.3)'};padding-top:12px;font-size:12px">
          <div>
            <div class="mute" style="font-size:11px;text-transform:uppercase;font-weight:700">Accumulated Weight</div>
            <div style="font-family:var(--font-mono);font-size:18px;font-weight:900;color:${isSilv ? '#0f766e' : 'var(--gold)'}">${g4(grams)}</div>
          </div>
          <div style="text-align:right">
            <div class="mute" style="font-size:11px;text-transform:uppercase;font-weight:700">Current Valuation</div>
            <div style="font-size:18px;font-weight:900;color:var(--ink-deep)">${inr(val)}</div>
          </div>
        </div>
        <div class="row between" style="font-size:11px;color:var(--ink-secondary)">
          <span>Advances Deposited: <b>${inr(paid)}</b></span>
          <span style="color:var(--emerald);font-weight:700">${val >= paid && paid > 0 ? `+${inr(val - paid)} Net Gain` : ''}</span>
        </div>
      </div>
    `;
  }).join('');

  app.innerHTML = `
  <!-- Luxury Greeting Header -->
  <div class="row between" style="margin-bottom:22px;flex-wrap:wrap;gap:14px;align-items:flex-end">
    <div>
      <h1 style="font-size:28px;font-weight:800;color:var(--ink-deep);margin:0 0 4px;letter-spacing:-0.03em">Welcome Back, ${esc(me.name || 'Member')}!</h1>
      <div class="mute" style="font-size:13px">Jewellery Savings Account · Linked Showroom: <b style="color:var(--ink-deep)">${esc(me.jeweller?.shop_name || 'Showroom')}</b> (Store Code: <code style="color:var(--gold)">${esc(me.jeweller?.store_code || '')}</code>)</div>
    </div>
  </div>

  <!-- Responsive Dashboard 2-Column Grid -->
  <div class="dashboard-grid">
    <!-- Left Column: The Aurum Portfolio Card Tray -->
    <div class="portfolio-hero-card">
      <div class="zeni-inner-card" style="background:#082016 !important;background-image:linear-gradient(135deg, #133c29 0%, #082016 55%, #04140d 100%) !important;color:#ffffff !important;box-shadow:0 20px 42px rgba(4,22,14,0.4) !important">
        <div class="portfolio-card-top">
          <span class="member-code-tag" style="color:#a7cfb8">${esc(me.pan_masked)}</span>
          <span class="showroom-flag" style="background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.3);color:#ffffff">${esc(me.jeweller?.shop_name || 'Showroom')}</span>
        </div>

        <div>
          <div class="portfolio-balance-label" style="color:#a3ceb7 !important">Total Portfolio Valuation</div>
          <div class="portfolio-balance-number" style="color:#ffffff !important;text-shadow:0 2px 14px rgba(0,0,0,0.4)">${inr(totalValue)}</div>
          
          <!-- Explicit Asset-Wise Holdings Breakdown -->
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin:12px 0 6px;padding:10px 14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:var(--radius-sm)">
            <div>
              <div style="font-size:11px;color:#a3ceb7;text-transform:uppercase;font-weight:700">🟡 Gold Holdings</div>
              <div style="font-size:15px;font-weight:800;color:#ffffff;font-family:var(--font-mono)">${g4(goldGrams)} <span style="font-size:11px;font-weight:600;color:#c9e8d7">(${inr(goldValue)})</span></div>
            </div>
            <div style="border-left:1px solid rgba(255,255,255,0.2);padding-left:16px">
              <div style="font-size:11px;color:#a3ceb7;text-transform:uppercase;font-weight:700">⚪ Silver Holdings</div>
              <div style="font-size:15px;font-weight:800;color:#ffffff;font-family:var(--font-mono)">${g4(silverGrams)} <span style="font-size:11px;font-weight:600;color:#c9e8d7">(${inr(silverValue)})</span></div>
            </div>
          </div>

          <div class="portfolio-metal-worth" style="color:#c9e8d7 !important;font-size:12px">
            <span class="dot-pulse"></span>
            <span>Total Advances Deposited: <b>${inr(totalPaid)}</b> across ${me.enrolments.length} plan(s)</span>
          </div>
        </div>
      </div>

      <div class="tray-buttons-row">
        <button class="tray-btn ghost" id="tray-passbook-btn">View Passbook</button>
        <button class="tray-btn primary" id="tray-save-btn">+ Save (New Plan)</button>
      </div>
    </div>

    <!-- Right Column: Live Commodity Market Rates Board -->
    <div class="commodity-board-card">
      <div class="board-header">
        <span class="board-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2.2"><line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          Live Bullion Rates
        </span>
        <span class="pill ok">${me.rates?.marketOpen ? 'Live Market' : 'Quoting Active'}</span>
      </div>
      <div id="overview-rates-list">
        ${renderRatesList(me.rates)}
      </div>
      <div class="row between" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border-light);font-size:11px;color:var(--ink-secondary)">
        <span>15% Duty + 3% GST Included</span>
        <a href="#" id="view-all-rates" style="color:var(--gold);text-decoration:none;font-weight:700">Detailed Feeds &gt;</a>
      </div>
    </div>
  </div>

  <!-- Primary Action Buttons -->
  <div class="hero-actions-row">
    <button class="btn-save-advance" id="hero-save-btn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      Save (Configure Metal &amp; Plan)
    </button>
    <button class="btn-redeem-goods" id="hero-redeem-btn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 12 20 22 4 22 4 12"></polyline><rect x="2" y="7" width="20" height="5"></rect><line x1="12" y1="22" x2="12" y2="7"></line></svg>
      Redeem Physical Goods
    </button>
  </div>

  <!-- Asset Allocation & Holdings Matrix -->
  <div class="section-heading-row" style="margin-top:30px">
    <div>
      <span class="section-heading">Precious Metals Asset Allocation</span>
      <div class="mute" style="font-size:12px;margin-top:2px">Exact weight, rupee deposits, and live showroom value per asset</div>
    </div>
    <span class="pill ok">Segregated Holdings</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:14px;margin-bottom:28px">
    ${assetCardsHtml}
  </div>

  <!-- 11-Month Scheme Roadmap & Active Progress -->
  <div class="section-heading-row">
    <span class="section-heading">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
      Savings Plan Roadmap &amp; Milestones
    </span>
    <span class="pill ok">${enrs.length} Active Scheme(s)</span>
  </div>

  <div class="scheme-progress-card">
    <div class="row between">
      <div>
        <div style="font-size:16px;font-weight:800;color:var(--ink-deep)">${primaryEnrol ? esc(primaryEnrol.label) : '11-Month Advance Plan'}</div>
        <div class="mute" style="font-size:12px">
          ${primaryEnrol ? `${cfg.frequencies[primaryEnrol.frequency]} · Month 11 delivery with Day 364 refund guarantee` : 'Fixed showroom advance scheme'}
          ${primaryEnrol?.debit_day ? `· <span style="color:var(--emerald);font-weight:700">${esc(primaryEnrol.debit_day)}</span>` : ''}
        </div>
      </div>
      <span class="member-code-tag">${primaryEnrol ? inr(primaryEnrol.instalment) + ' / deposit' : '₹1,000 / month'}</span>
    </div>

    <div class="progress-track-container">
      <div class="progress-track-bg">
        <div class="progress-track-fill" style="width:${pct}%"></div>
      </div>
      <div class="row between" style="font-size:12px;margin-top:6px;color:var(--ink-secondary)">
        <span>${maxM} of 11 Instalments (${inr(primaryEnrol ? primaryEnrol.totalPaid : totalPaid)} Paid)</span>
        <span style="color:var(--emerald);font-weight:700">Holds ${g4(primaryEnrol ? primaryEnrol.grams : totalGrams)}</span>
      </div>
    </div>

    <div class="milestones-strip">
      ${[1,2,3,4,5,6,7,8,9,10,11].map(m => {
        if (m === 11) return `<div class="milestone-node m11" title="Month 11: Physical Goods Delivery">M11</div>`;
        const isDone = m < maxM;
        const isCurrent = m === maxM;
        const checkSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        return `<div class="milestone-node ${isDone ? 'done' : (isCurrent ? 'current' : '')}">${isDone ? checkSvg : m}</div>`;
      }).join('')}
    </div>
  </div>

  <!-- Recent Payments Ledger Table -->
  <div class="section-heading-row">
    <span class="section-heading">Recent Transactions (Full Traceability)</span>
    <a href="#" id="view-full-passbook" style="color:var(--gold);text-decoration:none;font-weight:700;font-size:13px">View Master Passbook &gt;</a>
  </div>
  <div class="card" style="padding:0;overflow:hidden">
    ${pays.length ? renderPaymentsTable(pays.slice(0, 5)) : '<div style="padding:24px" class="mute">No transactions recorded yet</div>'}
  </div>`;

  const onSave = () => {
    activeTab = 'schemes';
    customer();
    setTimeout(() => {
      const el = document.getElementById('plan-builder-card');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

  const onRedeem = () => {
    const matured = me.enrolments.find(e => e.matured && e.status === 'ACTIVE');
    if (matured) {
      if (!confirm('Redeem your accumulated gold for physical jewellery at the showroom?')) return;
      api('POST', `/api/customer/enrolments/${matured.id}/redeem`).then(() => {
        toast('Redemption request submitted! Showroom staff notified.'); customer();
      });
    } else {
      toast('Redemption unlocks upon completing Month 11 in compliance with advance purchase statutory rules.');
    }
  };

  $('#hero-save-btn').onclick = onSave;
  $('#tray-save-btn').onclick = onSave;
  $('#tray-passbook-btn').onclick = () => passbook();
  $('#hero-redeem-btn').onclick = onRedeem;
  $('#view-all-rates')?.addEventListener('click', (e) => { e.preventDefault(); activeTab = 'rates'; customer(); });
  $('#view-full-passbook')?.addEventListener('click', (e) => { e.preventDefault(); activeTab = 'ledger'; customer(); });
}

function renderRatesList(rates) {
  if (!rates?.rates) return '<div class="mute">Syncing live bullion rates...</div>';
  const prods = Object.entries(cfg.products);
  return prods.map(([k, p]) => {
    const rObj = rates.rates[k];
    const isSilver = k.startsWith('S') || p.metal === 'SILVER';
    return `
      <div class="rate-card-item">
        <div class="rate-item-left">
          <div class="metal-badge-sq ${isSilver ? 'silver' : ''}">${isSilver ? 'AG' : 'AU'}</div>
          <div>
            <div class="rate-item-title">${esc(p.label)}</div>
            <div class="rate-item-sub">${p.metal} (${(p.purity * 100).toFixed(1)}%)</div>
          </div>
        </div>
        <div class="rate-item-price">${rObj ? inr(rObj.perGram) : '–'}<span style="font-size:10px;color:var(--ink-secondary)">/g</span></div>
      </div>
    `;
  }).join('');
}

// ---------------- 2. Schemes / Plan Creator View ----------------
function renderCustomerSchemes(me) {
  let chosenFreq = 'MONTHLY';
  let chosenMetal = 'GOLD';
  let chosenProduct = 'G24';

  const todayDay = new Date().getDate();
  const getSuffix = (n) => (n === 1 || n === 21 || n === 31 ? 'st' : n === 2 || n === 22 ? 'nd' : n === 3 || n === 23 ? 'rd' : 'th');
  const defaultDateOption = `${todayDay}${getSuffix(todayDay)} of month`;
  let chosenDebitDay = defaultDateOption;

  const getProductRate = (prod) => me.rates?.rates?.[prod]?.perGram || 0;

  app.innerHTML = `
  <div class="section-heading-row" style="margin-top:8px">
    <div>
      <h1 style="font-size:26px;font-weight:800;color:var(--ink-deep);margin:0">Create Savings Plan</h1>
      <p class="mute" style="font-size:13px;margin:4px 0 0" id="plan-desc-text">11-Month recurring advance savings scheme with Day 364 refund guarantee</p>
    </div>
  </div>

  <div class="card" id="plan-builder-card" style="max-width:640px;padding:26px">
    <!-- Frequency Selection -->
    <label>Savings Frequency</label>
    <div class="row" id="plan-freq-pills" style="margin-bottom:18px;flex-wrap:wrap;gap:8px">
      <button class="nav-link active" data-f="MONTHLY" style="flex:1">Monthly</button>
      <button class="nav-link" data-f="WEEKLY" style="flex:1">Weekly</button>
      <button class="nav-link" data-f="DAILY" style="flex:1">Daily</button>
      <button class="nav-link" data-f="ONE_TIME" style="flex:1">One-Time</button>
    </div>

    <!-- Metal Personalization Tabs (Glossy Gold AU vs Sterling Silver AG) -->
    <label>Choose Precious Metal</label>
    <div class="metal-selection-row" id="metal-type-pills">
      <button type="button" class="metal-tab-btn gold active" data-metal="GOLD">
        <div class="metal-tab-icon">AU</div>
        <div class="metal-tab-text">
          <div class="metal-tab-title">Gold Bullion (AU)</div>
          <div class="metal-tab-sub">24K / 22K / 18K Hallmarked</div>
        </div>
      </button>
      <button type="button" class="metal-tab-btn silver" data-metal="SILVER">
        <div class="metal-tab-icon">AG</div>
        <div class="metal-tab-text">
          <div class="metal-tab-title">Silver Ingot (AG)</div>
          <div class="metal-tab-sub">999 Fine Pure Bullion</div>
        </div>
      </button>
    </div>

    <!-- Gold Selection Options (Without Price Inside Dropdown) -->
    <div id="gold-product-row">
      <label>Gold Purity</label>
      <select id="np-gold" style="font-size:14px;padding:12px;font-weight:600">
        <option value="G24">Gold 24K (999 Pure Bullion)</option>
        <option value="G22">Gold 22K (916 Standard Jewellery)</option>
        <option value="G18">Gold 18K (750 Diamond Jewellery)</option>
      </select>
    </div>

    <!-- Silver Selection Option -->
    <div id="silver-product-row" style="display:none">
      <label>Silver Grade</label>
      <div style="background:#ffffff;border:1.5px solid rgba(148,163,184,0.3);border-radius:var(--radius-sm);padding:14px;font-weight:700;color:var(--ink-deep);display:flex;align-items:center;justify-content:space-between">
        <div>
          <div>Silver 999 (Pure Fine Ingot)</div>
          <div class="mute" style="font-size:11px;margin-top:2px">100% Hallmarked Fine Sterling Bullion</div>
        </div>
        <span class="pill ok" style="background:rgba(100,116,139,0.12);color:#0f172a;border-color:rgba(100,116,139,0.25)">99.9% PURE</span>
      </div>
    </div>

    <!-- Separate Live Rate & Metal Showcase Container -->
    <div id="metal-price-banner" class="metal-showcase-card gold-theme">
      <div class="row between" style="align-items:flex-start">
        <div class="row" style="gap:12px">
          <div id="banner-metal-badge" class="metal-badge-sq" style="width:40px;height:40px;font-size:13px">AU</div>
          <div>
            <div id="disp-metal-title" style="font-size:15px;font-weight:800;color:var(--ink-deep)">Gold 24K (999 Pure)</div>
            <div id="disp-metal-subtitle" class="mute" style="font-size:11px">Spot Parity + Custom Duty + 3% GST Included</div>
          </div>
        </div>
        <span id="banner-status-tag" class="pill ok" style="font-size:10px">Live Price</span>
      </div>
      <div class="row between" style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(0,0,0,0.06)">
        <div>
          <div class="mute" style="font-size:10px;font-weight:700;text-transform:uppercase">Live Showroom Rate</div>
          <div id="disp-live-rate" style="font-size:22px;font-weight:900;color:#8a5d05;letter-spacing:-0.02em">–</div>
        </div>
        <div style="text-align:right">
          <div class="mute" style="font-size:10px;font-weight:700;text-transform:uppercase">Metal Credited per ₹1,000</div>
          <div id="disp-metal-ratio" style="font-size:18px;font-weight:800;color:var(--ink-deep);font-family:var(--font-mono)">–</div>
        </div>
      </div>
    </div>

    <!-- Amount Input -->
    <label id="amt-label">Instalment Amount (₹100 – ₹2,000)</label>
    <input id="na" type="number" min="100" max="2000" step="100" value="1000" style="font-family:var(--font-mono);font-size:22px;font-weight:800;color:var(--gold);margin-bottom:10px">

    <div class="chips-row" id="amount-chips" style="margin-bottom:14px"></div>

    <!-- Compact Auto-Debit Schedule (Billing Date) -->
    <div id="debit-day-section" style="margin-bottom:18px">
      <label style="margin:10px 0 6px">Auto-Debit Billing Date</label>
      <select id="debit-day-select" style="font-size:13px;padding:11px 14px">
        <option value="${defaultDateOption}">Same date each month (${todayDay}${getSuffix(todayDay)} of every month)</option>
        <option value="1st of month">1st of every month</option>
        <option value="5th of month">5th of every month</option>
        <option value="10th of month">10th of every month</option>
        <option value="15th of month">15th of every month</option>
        <option value="20th of month">20th of every month</option>
        <option value="25th of month">25th of every month</option>
      </select>
      <div class="mute" style="font-size:11px;margin-top:4px">Next instalment will be debited on the same date next month.</div>
    </div>

    <!-- Quoted Rate & Weight Calculation Card -->
    <div class="rate-card-item" style="padding:16px;margin:16px 0;background:var(--bg-surface);flex-direction:column;gap:10px">
      <div class="row between" style="width:100%">
        <div>
          <div style="font-size:11px;color:var(--ink-secondary);text-transform:uppercase;font-weight:700">Locked Spot Rate</div>
          <div id="calc-rate" style="font-size:17px;font-weight:800;color:var(--ink-deep)">–</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--ink-secondary);text-transform:uppercase;font-weight:700">Metal Credited Today</div>
          <div id="calc-grams" style="font-size:20px;font-weight:800;font-family:var(--font-mono);color:var(--gold)">≈ 0.0000 g</div>
        </div>
      </div>
      <div id="calc-summary" style="font-size:12px;color:var(--ink-secondary);border-top:1px solid var(--border-light);padding-top:8px;width:100%;line-height:1.5">
        11-Month Plan: 11 monthly instalments of ₹1,000. Month 11 jewellery redemption.
      </div>
    </div>

    <!-- CTA Button -->
    <button id="npgo" class="btn-save-advance" style="width:100%;padding:15px;font-size:15px">
      Start 11-Month Plan &amp; Pay 1st Deposit (₹1,000)
    </button>
  </div>

  <div class="section-heading-row" style="margin-top:28px">
    <span class="section-heading">Active Enrolments (${(me.enrolments || []).length})</span>
  </div>
  ${(me.enrolments || []).length ? renderPlanCards(me.enrolments) : '<div class="card" style="text-align:center;padding:24px"><p class="mute">No active plans yet</p></div>'}`;

  const renderChips = () => {
    const presets = chosenFreq === 'DAILY' ? cfg.dailyPresets : cfg.presets;
    $('#amount-chips').innerHTML = presets.map(v => `<div class="amount-chip ${Number($('#na').value) === v ? 'active' : ''}" data-v="${v}">₹${v}</div>`).join('');
    $('#amount-chips').querySelectorAll('.amount-chip').forEach(c => {
      c.onclick = () => {
        $('#na').value = c.dataset.v;
        renderChips();
        updatePreview();
      };
    });
  };

  const updatePreview = () => {
    chosenProduct = chosenMetal === 'GOLD' ? $('#np-gold').value : 'S999';
    const rate = getProductRate(chosenProduct) || (chosenMetal === 'GOLD' ? 8650 : 98.5);
    const amt = Number($('#na').value) || 0;
    const g = rate > 0 ? amt / rate : 0;
    const perThousand = rate > 0 ? 1000 / rate : 0;

    const banner = $('#metal-price-banner');
    const badge = $('#banner-metal-badge');
    if (chosenMetal === 'GOLD') {
      if (banner) banner.className = 'metal-showcase-card gold-theme';
      if (badge) { badge.className = 'metal-badge-sq'; badge.textContent = 'AU'; }
      const pInfo = cfg?.products?.[chosenProduct] || { label: 'Gold 24K (999 Pure Bullion)' };
      if ($('#disp-metal-title')) $('#disp-metal-title').textContent = pInfo.label;
      if ($('#disp-metal-subtitle')) $('#disp-metal-subtitle').textContent = '24K / 22K / 18K Hallmarked Bullion · Duty & GST Included';
      if ($('#disp-live-rate')) $('#disp-live-rate').style.color = '#8a5d05';
      if ($('#disp-metal-ratio')) $('#disp-metal-ratio').style.color = 'var(--gold)';
    } else {
      if (banner) banner.className = 'metal-showcase-card silver-theme';
      if (badge) { badge.className = 'metal-badge-sq silver'; badge.textContent = 'AG'; }
      if ($('#disp-metal-title')) $('#disp-metal-title').textContent = 'Silver 999 (Pure Fine Ingot)';
      if ($('#disp-metal-subtitle')) $('#disp-metal-subtitle').textContent = '100% Hallmarked Fine Sterling Bullion · Duty & GST Included';
      if ($('#disp-live-rate')) $('#disp-live-rate').style.color = '#0f172a';
      if ($('#disp-metal-ratio')) $('#disp-metal-ratio').style.color = '#0f766e';
    }

    if ($('#disp-live-rate')) $('#disp-live-rate').textContent = `${inr(rate)} / g`;
    if ($('#disp-metal-ratio')) $('#disp-metal-ratio').textContent = `${perThousand.toFixed(4)} g`;
    if ($('#calc-rate')) $('#calc-rate').textContent = `${inr(rate)} / g`;
    if ($('#calc-grams')) $('#calc-grams').textContent = `≈ ${g.toFixed(4)} g`;

    const sec = $('#debit-day-section');
    if (chosenFreq === 'ONE_TIME') {
      sec.style.display = 'none';
      chosenDebitDay = 'Immediate Settlement';
      $('#amt-label').textContent = 'One-Time Purchase Amount (₹100 – ₹2,000)';
      $('#calc-summary').innerHTML = `<b>One-Time Deposit:</b> Instant accumulation of <b>${g.toFixed(4)} g</b> pure ${chosenMetal === 'GOLD' ? 'Gold' : 'Silver'} at locked spot rate. Redeemable for jewellery at showroom counter.`;
      $('#npgo').textContent = `Lock Live Quote & Pay ${inr(amt)} Now`;
    } else {
      sec.style.display = 'block';
      chosenDebitDay = $('#debit-day-select')?.value || defaultDateOption;
      const tenureLabel = chosenFreq === 'MONTHLY' ? '11-Month' : chosenFreq === 'WEEKLY' ? 'Weekly' : 'Daily';
      $('#amt-label').textContent = 'Instalment Amount (₹100 – ₹2,000)';
      $('#calc-summary').innerHTML = `<b>${tenureLabel} Plan:</b> Instalments of <b>${inr(amt)}</b> · Billing Date: <b>${esc(chosenDebitDay)}</b>. Month 11 jewellery redemption with Day 364 refund guarantee.`;
      $('#npgo').textContent = `Start ${tenureLabel} Plan & Pay 1st Deposit (${inr(amt)})`;
    }
  };

  // Wire Frequency Switcher
  $('#plan-freq-pills').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      $('#plan-freq-pills').querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chosenFreq = btn.dataset.f;
      renderChips();
      updatePreview();
    };
  });

  // Wire Metal Switcher (Gold vs Silver)
  $('#metal-type-pills').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      $('#metal-type-pills').querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chosenMetal = btn.dataset.metal;
      if (chosenMetal === 'GOLD') {
        $('#gold-product-row').style.display = 'block';
        $('#silver-product-row').style.display = 'none';
      } else {
        $('#gold-product-row').style.display = 'none';
        $('#silver-product-row').style.display = 'block';
      }
      updatePreview();
    };
  });

  $('#np-gold').onchange = updatePreview;
  $('#debit-day-select')?.addEventListener('change', (e) => {
    chosenDebitDay = e.target.value;
    updatePreview();
  });
  $('#na').oninput = () => { renderChips(); updatePreview(); };

  renderChips();
  updatePreview();

  // CTA Click: Create Enrolment & IMMEDIATELY Trigger Payment Checkout
  $('#npgo').onclick = guard(async () => {
    const amt = Number($('#na').value);
    if (!amt || amt < 100 || amt > 2000) return toast('Please enter an amount between ₹100 and ₹2,000', 'error');
    const r = await api('POST', '/api/customer/enrol', {
      product: chosenProduct,
      frequency: chosenFreq,
      instalment_rupees: amt,
      debit_day: chosenDebitDay
    });
    toast('Savings plan registered! Locking live quote for 1st deposit...', 'success');
    await payFlow(r.id, amt, true);
  });

  wirePlanCardButtons(me);
}

function renderPlanCards(enrolments) {
  return enrolments.map(e => {
    const isPaused = !!e.paused;
    const pct = Math.min(100, Math.round(((e.dueSoFar || 1) / (e.totalInstalments || 11)) * 100));

    return `
    <div class="card" style="margin-bottom:14px">
      <div class="row between" style="margin-bottom:10px">
        <div>
          <div style="font-weight:800;font-size:17px;color:var(--ink-deep)">${esc(e.label)}</div>
          <div class="mute" style="font-size:12px;margin-top:2px">
            ${cfg.frequencies[e.frequency]} · <b>${inr(e.instalment)}</b> / deposit
            ${e.debit_day ? `· <span style="color:var(--emerald);font-weight:700">${esc(e.debit_day)}</span>` : ''}
          </div>
        </div>
        <span class="pill ${isPaused ? 'bad' : (e.status === 'ACTIVE' ? 'ok' : '')}">${isPaused ? 'PAUSED' : esc(e.status)}</span>
      </div>

      <div class="progress-track-container">
        <div class="progress-track-bg">
          <div class="progress-track-fill" style="width:${pct}%"></div>
        </div>
        <div class="row between" style="font-size:12px;margin-top:6px;color:var(--ink-secondary)">
          <span>${e.dueSoFar || 0} / ${e.totalInstalments || 11} Instalments (${pct}%)</span>
          <span style="color:var(--gold);font-weight:700">Holds ${g4(e.grams)}</span>
        </div>
      </div>

      <div class="row between" style="font-size:13px;margin:14px 0 16px">
        <div><span class="mute">Total Paid:</span> <b>${inr(e.totalPaid)}</b></div>
        <div><span class="mute">Showroom Worth:</span> <b style="color:var(--emerald)">${e.valueNow == null ? '–' : inr(e.valueNow)}</b></div>
      </div>

      <div class="row" style="gap:10px;flex-wrap:wrap">
        ${e.depositsOpen ? `<button class="small btn-save-advance" data-pay="${e.id}" data-amt="${e.instalment}">Pay Next Deposit</button>` : ''}
        <button class="small ghost" data-book="${e.id}">Passbook</button>
        ${e.status === 'ACTIVE' && !isPaused && !e.pauseCount ? `<button class="small ghost" data-pause="${e.id}">Pause Plan</button>` : ''}
        ${e.status === 'ACTIVE' && isPaused ? `<button class="small" data-resume="${e.id}">Resume Plan</button>` : ''}
        ${e.status === 'ACTIVE' && e.matured ? `<button class="small" data-redeem="${e.id}">Redeem Goods</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function wirePlanCardButtons(me) {
  app.querySelectorAll('[data-pay]').forEach(b => (b.onclick = () => payFlow(Number(b.dataset.pay), Number(b.dataset.amt))));
  app.querySelectorAll('[data-book]').forEach(b => (b.onclick = guard(() => passbook(b.dataset.book))));
  app.querySelectorAll('[data-pause]').forEach(b => (b.onclick = guard(async () => {
    if (!confirm('Pause plan for 30 days?')) return;
    await api('POST', `/api/customer/enrolments/${b.dataset.pause}/pause`);
    toast('Plan paused.'); customer();
  })));
  app.querySelectorAll('[data-resume]').forEach(b => (b.onclick = guard(async () => {
    await api('POST', `/api/customer/enrolments/${b.dataset.resume}/resume`);
    toast('Plan resumed.'); customer();
  })));
  app.querySelectorAll('[data-redeem]').forEach(b => (b.onclick = guard(async () => {
    await api('POST', `/api/customer/enrolments/${b.dataset.redeem}/redeem`);
    toast('Redemption requested. Showroom counter notified.'); customer();
  })));
}

// ---------------- 3. Commodity Rates Detail View ----------------
function renderCustomerRates(me) {
  app.innerHTML = `
  <div class="section-heading-row" style="margin-top:8px">
    <h1 style="font-size:26px;font-weight:800;color:var(--ink-deep);margin:0">Live Commodity Bullion Board</h1>
    <span class="pill ok">${me.rates?.marketOpen ? 'MCX Open' : 'Quoting Active'}</span>
  </div>

  <div class="card" style="margin-bottom:20px">
    <div class="row between" style="margin-bottom:12px">
      <div>
        <div class="mute" style="font-size:12px">Live Bullion Spot Source</div>
        <div style="font-size:15px;font-weight:700;color:var(--ink-deep)">${esc(me.rates?.source || 'gold-api.com + open.er-api.com')}</div>
      </div>
      <div style="text-align:right">
        <div class="mute" style="font-size:12px">Statutory Taxes</div>
        <div style="font-size:15px;font-weight:700;color:var(--gold)">15% Duty + 3% GST Included</div>
      </div>
    </div>
    <div class="mute" style="font-size:12px;line-height:1.55">
      All rates derived strictly from spot parity formula: <code>(XAU USD / 31.1035) × USD/INR × (1 + Duty) × (1 + GST)</code>. Quoting valid for 3 minutes upon generating UPI intent.
    </div>
  </div>

  <div class="card" style="padding:0;overflow:hidden">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border-card)">
      <b style="font-size:15px;color:var(--ink-deep)">Bullion Quoting Grid</b>
    </div>
    <div style="padding:12px 20px">
      ${renderRatesList(me.rates)}
    </div>
  </div>`;
}

// ---------------- 4. Customer Passbook View ----------------
async function renderCustomerLedger(me) {
  let rows = [];
  try {
    rows = await api('GET', '/api/customer/ledger');
  } catch (err) {
    if (me.enrolments && me.enrolments[0]) {
      rows = await api('GET', `/api/customer/ledger/${me.enrolments[0].id}`);
    }
  }

  const p = me.portfolio || { goldGrams: 0, silverGrams: 0, totalPaid: 0, totalValue: 0 };

  app.innerHTML = `
  <div class="section-heading-row" style="margin-top:8px">
    <div>
      <h1 style="font-size:26px;font-weight:800;color:var(--ink-deep);margin:0 0 4px">Passbook</h1>
      <div class="mute" style="font-size:13px">Your savings deposits, locked bullion rates, and metal balance history</div>
    </div>
  </div>

  <!-- Asset Holdings Metric Bar -->
  <div class="metrics-row" style="margin-bottom:20px">
    <div class="metric-card">
      <div class="metric-label">Gold Accumulated (AU)</div>
      <div class="metric-value gold">${g4(p.goldGrams)}</div>
      <div class="mute" style="font-size:11px;margin-top:4px">Worth ${inr(p.goldValue || 0)} at live bullion rates</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Silver Accumulated (AG)</div>
      <div class="metric-value" style="color:#0f766e">${g4(p.silverGrams)}</div>
      <div class="mute" style="font-size:11px;margin-top:4px">Worth ${inr(p.silverValue || 0)} at live bullion rates</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Deposits Reconciled</div>
      <div class="metric-value">${inr(p.totalPaid || 0)}</div>
      <div class="mute" style="font-size:11px;margin-top:4px">100% direct showroom bank settlement</div>
    </div>
  </div>

  <div class="card" style="padding:0;overflow:hidden">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border-card);display:flex;justify-content:space-between;align-items:center">
      <b style="font-size:15px;color:var(--ink-deep)">Transaction Ledger</b>
      <span class="mute" style="font-size:12px">${rows.length} Verified Entries</span>
    </div>
    <div class="table-wrapper" style="max-height:560px">
      <table>
        <thead>
          <tr>
            <th>Date &amp; Time</th>
            <th>Asset</th>
            <th>Type</th>
            <th>Amount (₹)</th>
            <th>Rate / g</th>
            <th>Grams Credited</th>
            <th>Balance</th>
            <th>Bank UTR / Ref</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map(r => {
            const isSilver = r.metal === 'SILVER' || (r.product && r.product.startsWith('S'));
            return `
            <tr>
              <td><span style="font-size:12px;color:var(--ink-secondary)">${when(r.ts)}</span></td>
              <td>
                <div style="display:flex;align-items:center;gap:6px">
                  <span class="metal-badge-sq ${isSilver ? 'silver' : ''}" style="width:24px;height:24px;font-size:10px">${isSilver ? 'AG' : 'AU'}</span>
                  <div>
                    <div style="font-weight:700;font-size:13px;color:var(--ink-deep)">${esc(r.productLabel || r.product || 'Gold')}</div>
                    <div class="mute" style="font-size:10px">${r.purity ? `${(r.purity * 100).toFixed(1)}% pure` : ''}</div>
                  </div>
                </div>
              </td>
              <td><span class="pill ${r.type === 'CREDIT' ? 'ok' : 'bad'}">${esc(r.type)}</span></td>
              <td><b>${inr(r.amount)}</b></td>
              <td><span style="font-family:var(--font-mono);font-size:12px;color:var(--ink-secondary)">${r.ratePerGram ? inr(r.ratePerGram) + '/g' : '–'}</span></td>
              <td style="font-family:var(--font-mono);font-weight:700;color:${r.grams >= 0 ? 'var(--emerald)' : 'var(--rose)'}">${r.grams > 0 ? '+' : ''}${r.grams.toFixed(4)}</td>
              <td style="font-family:var(--font-mono);font-weight:800;color:var(--ink-deep)">${(r.balanceGrams || 0).toFixed(4)}</td>
              <td>
                ${r.bankUtr ? `<code style="font-size:11px;color:var(--gold)">${esc(r.bankUtr)}</code>` : `<code style="font-size:11px;color:var(--ink-secondary)">${esc(r.reference || '–')}</code>`}
              </td>
            </tr>
          `;
          }).join('') : `
            <tr><td colspan="8" style="text-align:center;padding:36px" class="mute">No transactions in passbook yet. Start a savings plan or make an advance instalment to build your metal ledger.</td></tr>
          `}
        </tbody>
      </table>
    </div>
  </div>`;
}

// ---------------- 5. Customer Profile View ----------------
function renderCustomerProfile(me) {
  app.innerHTML = `
  <div class="section-heading-row" style="margin-top:8px">
    <h1 style="font-size:26px;font-weight:800;color:var(--ink-deep);margin:0">Account Profile</h1>
    <span class="pill ok">KYC ${esc(me.kyc_status)}</span>
  </div>

  <div class="card" style="max-width:680px">
    <div class="row" style="gap:16px;margin-bottom:20px">
      <div class="brand-icon" style="width:56px;height:56px;font-size:22px;font-weight:800">
        ${esc(me.name?.charAt(0) || 'U')}
      </div>
      <div>
        <h3 style="font-size:20px;font-weight:800;color:var(--ink-deep);margin:0 0 4px">${esc(me.name)}</h3>
        <div class="mute" style="font-size:13px">${esc(me.phone)} · PAN: <code style="color:var(--gold)">${esc(me.pan_masked)}</code></div>
      </div>
    </div>

    <label>Linked Showroom</label>
    <div class="rate-card-item" style="padding:14px 18px;margin-bottom:20px">
      <div>
        <div style="font-weight:800;color:var(--ink-deep)">${esc(me.jeweller.shop_name)}</div>
        <div class="mute" style="font-size:11px">${esc(me.jeweller.city)} · Store Code: <code>${esc(me.jeweller.store_code || '')}</code></div>
      </div>
      <span class="pill ok">Active Counter</span>
    </div>

    <label>Legal Compliance & Policies</label>
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:24px">
      <div style="padding:14px 18px;border-bottom:1px solid var(--border-card);cursor:pointer;display:flex;justify-content:space-between" id="p-terms">
        <span style="color:var(--ink-deep);font-weight:600">Scheme Terms & Conditions</span><span class="mute">&gt;</span>
      </div>
      <div style="padding:14px 18px;border-bottom:1px solid var(--border-card);cursor:pointer;display:flex;justify-content:space-between" id="p-priv">
        <span style="color:var(--ink-deep);font-weight:600">Privacy & DPDP Notice</span><span class="mute">&gt;</span>
      </div>
      <div style="padding:14px 18px;cursor:pointer;display:flex;justify-content:space-between" id="p-ref">
        <span style="color:var(--ink-deep);font-weight:600">Day 364 Refund Guarantee</span><span class="mute">&gt;</span>
      </div>
    </div>

    <label style="color:var(--rose)">Data Erasure (DPDP Act 2023)</label>
    <div class="mute" style="font-size:12px;margin-bottom:14px;line-height:1.5">You can permanently erase personal identity records once all metal balances are redeemed or refunded.</div>
    <button class="ghost small" id="delacc" style="color:var(--rose);border-color:var(--rose);width:100%">Permanently Delete Account</button>
  </div>`;

  $('#p-terms').onclick = () => showLegal('scheme-terms');
  $('#p-priv').onclick = () => showLegal('privacy-policy');
  $('#p-ref').onclick = () => showLegal('refund-policy');
  $('#delacc').onclick = guard(async () => {
    if (!confirm('Erase personal data and delete account? (Only permitted if zero metal balance remains).')) return;
    const r = await api('POST', '/api/customer/delete-account');
    toast(r.message); logout();
  });
}

function renderPaymentsTable(pays) {
  return `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Asset</th>
            <th>Amount</th>
            <th>Grams</th>
            <th>Status</th>
            <th>Bank UTR / Ref</th>
          </tr>
        </thead>
        <tbody>
          ${pays.map(p => {
            const isSilver = p.metal === 'SILVER' || (p.product && p.product.startsWith('S'));
            return `
            <tr>
              <td><span style="font-size:12px;color:var(--ink-secondary)">${when(p.ts || p.created_ts || p.created_at)}</span></td>
              <td>
                <div style="display:flex;align-items:center;gap:6px">
                  <span class="metal-badge-sq ${isSilver ? 'silver' : ''}" style="width:22px;height:22px;font-size:10px">${isSilver ? 'AG' : 'AU'}</span>
                  <span style="font-weight:700;font-size:13px;color:var(--ink-deep)">${esc(p.productLabel || p.product || 'Precious Metal')}</span>
                </div>
              </td>
              <td><b>${inr(p.amount)}</b></td>
              <td style="font-family:var(--font-mono);font-weight:700;color:var(--gold)">${p.grams ? g4(p.grams) : '–'}</td>
              <td><span class="pill ${p.status === 'CREDITED' ? 'ok' : ''}">${esc(p.status)}</span></td>
              <td>
                ${p.utr ? `<code style="font-family:var(--font-mono);color:var(--gold);font-size:11px">${esc(p.utr)}</code>` : `<code style="font-size:11px;color:var(--ink-secondary)">${esc(p.ref)}</code>`}
              </td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ---------------- Payment Checkout Modal ----------------
async function payFlow(enrolmentId, defAmt, directLock = false) {
  const executeQuoteCheckout = async (amount) => {
    const q = await api('POST', '/api/customer/pay', { enrolment_id: enrolmentId, amount_rupees: amount });
    const exp = Date.now() + q.quoteValidSeconds * 1000;

    const baseParams = `pa=${encodeURIComponent(q.vpa)}&pn=${encodeURIComponent('MANJU JEWELLERS')}&am=${Number(q.amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent(q.ref)}&tr=${encodeURIComponent(q.ref)}&mc=5944`;
    const phonepeUri = `phonepe://pay?${baseParams}`;
    const gpayUri = `gpay://upi/pay?${baseParams}`;
    const paytmUri = `paytmmp://pay?${baseParams}`;
    const credUri = `cred://upi/pay?${baseParams}`;
    const genericUpiUri = `upi://pay?${baseParams}`;

    openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div>
        <h3 style="font-size:22px;font-weight:800;color:var(--ink-deep);margin:0">Pay ${inr(q.amount)}</h3>
        <div class="mute" style="font-size:11.5px">Showroom: <b>MANJU JEWELLERS</b></div>
      </div>
      <div style="text-align:right">
        <span class="pill ok" style="font-size:11px">Rate Locked</span>
      </div>
    </div>

    <!-- Rate Info Capsule -->
    <div class="rate-card-item" style="padding:10px 14px;margin-bottom:14px;background:var(--bg-surface)">
      <div>
        <div style="font-size:10.5px;color:var(--ink-secondary)">Locked Rate / Gram</div>
        <div style="font-size:15px;font-weight:800;color:var(--ink-deep)">${inr(q.ratePerGram)}/g</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10.5px;color:var(--ink-secondary)">Pure Gold Credited</div>
        <div style="font-size:16px;font-weight:800;color:var(--gold);font-family:var(--font-mono)">${g4(q.grams)}</div>
      </div>
    </div>

    <!-- PRIMARY: Real ICICI Bank Gateway Button -->
    <button id="btn-icici-gateway" class="btn-save-advance" style="width:100%;padding:14px;font-size:14px;font-weight:800;background:linear-gradient(135deg, #054c8c, #0b69bc);display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:14px">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
      Pay via ICICI Bank Official Gateway
    </button>

    <!-- Secondary: Direct UPI Apps -->
    <div class="upi-apps-container" style="margin-bottom:12px">
      <div class="upi-apps-label" style="margin-bottom:8px">
        <span>Or Pay directly with UPI App</span>
        <span style="font-size:10px;color:var(--emerald);font-weight:700">0% Fee</span>
      </div>
      <div class="upi-apps-grid">
        <!-- PhonePe -->
        <a href="${esc(phonepeUri)}" class="upi-app-card" style="padding:8px 10px">
          <div class="upi-app-icon-wrap" style="background:#5f259f;width:30px;height:30px">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.2 14.5h-2.4v-4H9.3v-2h1.5V9c0-1.65 1.35-3 3-3h1.8v2h-1.8c-.55 0-1 .45-1 1v1.5h2.8l-.4 2h-2.4v4.5z" fill="#ffffff"/></svg>
          </div>
          <div>
            <div class="upi-app-name" style="font-size:12.5px">PhonePe</div>
            <div class="upi-app-hint" style="font-size:9.5px">Tap to open</div>
          </div>
        </a>

        <!-- Google Pay -->
        <a href="${esc(gpayUri)}" class="upi-app-card" style="padding:8px 10px">
          <div class="upi-app-icon-wrap" style="background:#ffffff;border:1px solid #e2e8f0;width:30px;height:30px">
            <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.25 21.36 7.33 24 12 24z"/><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.25 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/></svg>
          </div>
          <div>
            <div class="upi-app-name" style="font-size:12.5px">Google Pay</div>
            <div class="upi-app-hint" style="font-size:9.5px">Tap to open</div>
          </div>
        </a>

        <!-- Paytm -->
        <a href="${esc(paytmUri)}" class="upi-app-card" style="padding:8px 10px">
          <div class="upi-app-icon-wrap" style="background:#00b9f5;width:30px;height:30px">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#ffffff"><path d="M4 8h3v8H4zm5-4h3v12H9zm5 6h3v6h-3zm5-2h3v8h-3z"/></svg>
          </div>
          <div>
            <div class="upi-app-name" style="font-size:12.5px">Paytm</div>
            <div class="upi-app-hint" style="font-size:9.5px">Tap to open</div>
          </div>
        </a>

        <!-- CRED -->
        <a href="${esc(credUri)}" class="upi-app-card" style="padding:8px 10px">
          <div class="upi-app-icon-wrap" style="background:#111111;width:30px;height:30px">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5"><path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14"/></svg>
          </div>
          <div>
            <div class="upi-app-name" style="font-size:12.5px">CRED UPI</div>
            <div class="upi-app-hint" style="font-size:9.5px">Tap to open</div>
          </div>
        </a>
      </div>
    </div>

    <!-- QR Code Collapsible (Doesn't push screen on mobile) -->
    <details style="margin:8px 0 14px;text-align:center">
      <summary class="mute" style="font-size:11px;cursor:pointer;font-weight:700">📱 Scan QR code from another device</summary>
      <div style="margin-top:10px">
        <img src="/api/qr?data=${encodeURIComponent(genericUpiUri)}" width="130" height="130" style="border-radius:12px;border:1px solid var(--border-card);background:#ffffff;padding:6px">
      </div>
    </details>

    <!-- Compact Status Bar -->
    <div style="background:var(--bg-surface);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="dot-pulse"></span>
        <span style="font-size:12px;color:var(--ink-deep);font-weight:600">Rate locked: <b id="cd" style="color:var(--gold)">${q.quoteValidSeconds}</b>s</span>
      </div>
      <button id="btn-auto-confirm" class="tray-btn ghost" style="padding:6px 12px;font-size:11.5px">
        Refresh Status
      </button>
    </div>
    `);

    let pollIv = null;
    const iv = setInterval(() => {
      const s = Math.max(0, Math.round((exp - Date.now()) / 1000));
      const el = $m('#cd');
      if (el) el.textContent = s; else clearInterval(iv);
    }, 1000);

    const onConfirmedSuccess = (r) => {
      clearInterval(iv);
      if (pollIv) clearInterval(pollIv);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      openModal(`
        <div style="text-align:center;padding:24px 14px">
          <div style="width:56px;height:56px;border-radius:50%;background:var(--emerald-bg);border:1px solid var(--emerald-border);display:flex;align-items:center;justify-content:center;color:var(--emerald);margin:0 auto 16px">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
          <h2 style="font-size:22px;font-weight:800;color:var(--ink-deep);margin:0 0 6px">Payment Confirmed by Bank!</h2>
          <p class="mute" style="font-size:14px;margin:0 0 20px">
            <b>${inr(q.amount)}</b> verified via bank settlement. <b style="color:var(--gold);font-family:var(--font-mono)">${g4(r.grams || q.grams)}</b> pure metal credited to your passbook.
          </p>
          <div class="rate-card-item" style="padding:14px 18px;margin-bottom:20px;text-align:left;background:var(--bg-surface)">
            <div>
              <div style="font-size:11px;color:var(--ink-secondary)">Bank Settlement UTR / RRN</div>
              <div style="font-family:var(--font-mono);font-weight:700;color:var(--ink-deep)">${esc(r.utr || q.ref)}</div>
            </div>
            <span class="pill ok">SETTLED IN PASSBOOK</span>
          </div>
          <button id="modal-success-done" class="btn-save-advance" style="width:100%;padding:15px">View Dashboard &amp; Passbook →</button>
        </div>
      `);
      $m('#modal-success-done').onclick = () => { closeModal(); activeTab = 'passbook'; customer(); };
    };

    // Automated Live Polling for Bank Settlement (polls every 1.5s)
    pollIv = setInterval(async () => {
      try {
        const st = await api('GET', `/api/customer/pay/${q.id}`);
        if (st && st.status === 'CREDITED') {
          onConfirmedSuccess(st);
        }
      } catch {}
    }, 1500);

    // ICICI Bank Hosted Gateway Launch (Real Bank Switch)
    $m('#btn-icici-gateway')?.addEventListener('click', guard(async () => {
      const btn = $m('#btn-icici-gateway');
      btn.disabled = true;
      btn.innerHTML = `<span class="dot-pulse"></span> Connecting ICICI Bank Gateway...`;
      try {
        const res = await api('POST', `/api/customer/pay/${q.id}/icici-checkout`);
        if (res && res.redirectUrl) {
          window.location.href = res.redirectUrl;
          return;
        }
        toast('Could not connect to ICICI Gateway: ' + (res.error || 'Server error'), 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg> Pay via ICICI Bank Official Gateway`;
        }
      }
    }));

    // Real-Time Bank Status Verification (No Mocks, Live Bank Switch Query)
    const triggerAutoConfirm = async () => {
      const btn = $m('#btn-auto-confirm');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="dot-pulse"></span> Querying Bank Switch...`;
      }
      try {
        const res = await api('POST', `/api/customer/pay/${q.id}/check-bank-status`);
        if (res && res.status === 'CREDITED') {
          onConfirmedSuccess(res);
        } else if (res && (res.status === 'REJECTED' || res.status === 'FAILED')) {
          toast(res.message || 'Payment declined or cancelled by bank', 'error');
        } else {
          toast(res.message || 'Bank callback pending. Will update when bank confirms.', 'info');
        }
      } catch (err) {
        toast(err.message || 'Error checking status', 'error');
      } finally {
        if ($m('#btn-auto-confirm')) {
          $m('#btn-auto-confirm').disabled = false;
          $m('#btn-auto-confirm').innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> Check Bank Settlement Status`;
        }
      }
    };

    $m('#btn-auto-confirm')?.addEventListener('click', guard(triggerAutoConfirm));
  };

  if (directLock && defAmt) {
    await executeQuoteCheckout(defAmt);
  } else {
    openModal(`
    <h3 style="font-size:20px;font-weight:800;color:var(--ink-deep);margin-bottom:4px">Make Advance Payment</h3>
    <label>Instalment Amount (₹)</label>
    <input id="pa" type="number" min="100" max="2000" step="50" value="${defAmt || 1000}" style="font-family:var(--font-mono);font-size:24px;font-weight:800;color:var(--gold)">
    <div class="chips-row" style="margin:12px 0 20px">
      <div class="amount-chip" data-v="500">₹500</div>
      <div class="amount-chip" data-v="1000">₹1,000</div>
      <div class="amount-chip" data-v="1500">₹1,500</div>
      <div class="amount-chip" data-v="2000">₹2,000</div>
    </div>
    <button id="go" class="btn-save-advance" style="width:100%;padding:16px;font-size:15px">Lock Live Quote &amp; Pay</button>`);

    $m('.modal-card').querySelectorAll('.amount-chip').forEach(c => {
      c.onclick = () => { $m('#pa').value = c.dataset.v; };
    });

    $m('#go').onclick = guard(async () => {
      await executeQuoteCheckout(Number($m('#pa').value));
    });
  }
}

// Passbook Modal
async function passbook(id) {
  let rows = [];
  try {
    rows = id ? await api('GET', `/api/customer/ledger/${id}`) : await api('GET', '/api/customer/ledger');
  } catch (e) {
    rows = [];
  }
  openModal(`
  <div style="margin-bottom:16px">
    <h3 style="font-size:22px;font-weight:800;color:var(--ink-deep);margin:0 0 4px">Savings Passbook</h3>
    <div class="mute" style="font-size:13px">Verified showroom deposit history and metal balances</div>
  </div>
  <div class="table-wrapper" style="max-height:500px">
    <table>
      <thead>
        <tr>
          <th>Date &amp; Time</th>
          <th>Asset</th>
          <th>Type</th>
          <th>Amount (₹)</th>
          <th>Locked Rate / g</th>
          <th>Grams Credited</th>
          <th>Balance</th>
          <th>Bank UTR / Ref</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const isSilver = r.metal === 'SILVER' || (r.product && r.product.startsWith('S'));
          return `
          <tr>
            <td><span style="font-size:12px;color:var(--ink-secondary)">${when(r.ts)}</span></td>
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                <span class="metal-badge-sq ${isSilver ? 'silver' : ''}" style="width:22px;height:22px;font-size:9px">${isSilver ? 'AG' : 'AU'}</span>
                <span style="font-weight:700;font-size:13px">${esc(r.productLabel || r.product || 'Precious Metal')}</span>
              </div>
            </td>
            <td><span class="pill ${r.type === 'CREDIT' ? 'ok' : 'bad'}">${esc(r.type)}</span></td>
            <td><b>${inr(r.amount)}</b></td>
            <td><span style="font-family:var(--font-mono);font-size:12px;color:var(--ink-secondary)">${r.ratePerGram ? inr(r.ratePerGram) + '/g' : '–'}</span></td>
            <td style="font-family:var(--font-mono);font-weight:700;color:${r.grams >= 0 ? 'var(--emerald)' : 'var(--rose)'}">${r.grams > 0 ? '+' : ''}${r.grams.toFixed(4)}</td>
            <td style="font-family:var(--font-mono);font-weight:800;color:var(--ink-deep)">${(r.balanceGrams || 0).toFixed(4)}</td>
            <td>
              ${r.bankUtr ? `<code style="font-size:11px;color:var(--gold)">${esc(r.bankUtr)}</code>` : `<code style="font-size:11px;color:var(--ink-secondary)">${esc(r.reference || '–')}</code>`}
            </td>
          </tr>
        `;
        }).join('')}
      </tbody>
    </table>
  </div>
  <button id="modal-close-ledger" class="btn-save-advance" style="width:100%;margin-top:20px;padding:14px;font-size:14px">Close Passbook</button>`, 'wide');
  $m('#modal-close-ledger').onclick = closeModal;
}

// ---------------- Customer Onboarding: Step 1 Identity ----------------
function profileForm() {
  dNav.style.display = 'none';
  bNav.classList.add('hidden');
  $('#hdr-showroom-badge').style.display = 'none';
  app.innerHTML = `
  <div style="max-width:480px;margin:30px auto">
    <div class="card" style="padding:32px 28px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">
        <div>
          <h2 style="font-size:22px;font-weight:800;color:var(--ink-deep);margin:0 0 4px">Verify Customer Identity</h2>
          <p class="mute" style="font-size:13px;margin:0">Mandatory statutory compliance under Indian PMLA guidelines</p>
        </div>
        <button type="button" id="fill-demo-cust" class="chip" style="cursor:pointer;background:var(--emerald-bg);color:var(--emerald);border-color:var(--emerald-border);font-size:11px">
          Fill Demo
        </button>
      </div>

      <label>Full Name (as per PAN)</label>
      <input id="n" placeholder="e.g. Ravi Kumar">

      <label>Date of Birth (18+ only)</label>
      <input id="d" type="date">

      <label>Personal PAN Card (4th letter P)</label>
      <input id="p" maxlength="10" placeholder="ABCPE1234F" style="text-transform:uppercase;font-family:var(--font-mono);letter-spacing:2px">

      <div style="margin:16px 0;padding:12px;background:var(--bg-card-subtle);border-radius:var(--radius-sm);border:1px solid var(--border-light)">
        <label style="display:flex;gap:10px;font-size:12px;margin:0;cursor:pointer;text-transform:none;color:var(--ink-secondary)">
          <input type="checkbox" id="dpdp" checked style="width:auto">
          <span>I consent to identity verification &amp; agree to <a href="#" id="l1" style="color:var(--gold);font-weight:700">Scheme Terms</a> and <a href="#" id="l2" style="color:var(--gold);font-weight:700">Privacy Policy</a>.</span>
        </label>
      </div>

      <button id="s" class="btn-save-advance" style="width:100%;padding:15px">Save Profile &amp; Continue</button>
    </div>
  </div>`;

  $('#fill-demo-cust')?.addEventListener('click', () => {
    $('#n').value = 'Ravi Kumar';
    $('#d').value = '1994-08-15';
    // Generate valid random individual PAN: ABCPE + 4 digits + letter
    const randDigits = Math.floor(1000 + Math.random() * 9000);
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const randChar = chars[Math.floor(Math.random() * chars.length)];
    $('#p').value = 'ABCPE' + randDigits + randChar;
  });

  $('#l1').onclick = (e) => { e.preventDefault(); showLegal('scheme-terms'); };
  $('#l2').onclick = (e) => { e.preventDefault(); showLegal('privacy-policy'); };
  $('#s').onclick = guard(async () => {
    if (!$('#dpdp').checked) return toast('Please consent to the privacy policy and terms.', 'error');
    const name = $('#n').value.trim();
    const dob = $('#d').value.trim();
    const pan = $('#p').value.trim().toUpperCase();
    if (!name || !dob || !pan) return toast('Please complete all fields.', 'error');
    await api('POST', '/api/customer/profile', { name, dob, pan, dpdp_consent: true });
    toast('Profile verified successfully!', 'success');
    customer();
  });
}

// ---------------- Customer Onboarding: Step 2 Jeweller Verification Code Gate ----------------
function joinForm() {
  dNav.style.display = 'none';
  bNav.classList.add('hidden');
  $('#hdr-showroom-badge').style.display = 'none';
  app.innerHTML = `
  <div style="max-width:480px;margin:30px auto">
    <div class="card" style="padding:32px 28px;text-align:center">
      <div class="brand-icon" style="width:54px;height:54px;margin:0 auto 16px">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
      </div>
      <h2 style="font-size:22px;font-weight:800;color:var(--ink-deep);margin:0 0 8px">Connect Showroom</h2>
      <p class="mute" style="font-size:13px;line-height:1.6;margin:0 auto 20px">
        Enter the 6-character permanent store code or counter invite code shared by your retail jeweller.
      </p>
      <input id="c" class="chip" maxlength="9" placeholder="e.g. 7KQ2MX" style="text-align:center;text-transform:uppercase;width:100%;font-size:22px;padding:14px;margin-bottom:20px;letter-spacing:3px">
      <button id="s" class="btn-save-advance" style="width:100%;padding:15px">Verify Code &amp; Link Showroom</button>
    </div>
  </div>`;

  $('#s').onclick = guard(async () => {
    const code = $('#c').value.trim();
    if (!code) return toast('Please enter a store code.', 'error');
    const r = await api('POST', '/api/customer/join', { code });
    if (r.pending) {
      toast('Linked to showroom! Awaiting counter staff approval.', 'info');
    } else {
      toast('Successfully linked to ' + (r.shop_name || 'showroom') + '!', 'success');
    }
    activeTab = 'home';
    customer();
  });
}

// ---------------- Jeweller Merchant Portal ----------------
async function jeweller() {
  $('#btn-logout').style.display = 'flex';
  $('#btn-logout').onclick = logout;
  $('#btn-brand-home').onclick = () => { activeTab = 'today'; jeweller(); };

  if (!['today', 'customers', 'ledger', 'staff', 'setup'].includes(activeTab)) {
    activeTab = 'today';
  }

  const me = await api('GET', '/api/jeweller/me');
  if (!me.registered) {
    $('#hdr-showroom-badge').style.display = 'none';
    return jwRegister();
  }

  if (me.shop_name) {
    $('#hdr-showroom-badge').style.display = 'flex';
    $('#hdr-showroom-name').textContent = me.shop_name;
  } else {
    $('#hdr-showroom-badge').style.display = 'none';
  }
  renderJewellerNavigations();
  renderJewellerView(me);

  autoRefresh(async () => {
    const updated = await api('GET', '/api/jeweller/me');
    renderJewellerView(updated);
  });
}

function renderJewellerNavigations() {
  dNav.style.display = 'flex';
  dNav.innerHTML = `
    <button class="nav-link ${activeTab === 'today' ? 'active' : ''}" data-jtab="today">Overview</button>
    <button class="nav-link ${activeTab === 'customers' ? 'active' : ''}" data-jtab="customers">Customers</button>
    <button class="nav-link ${activeTab === 'ledger' ? 'active' : ''}" data-jtab="ledger">Ledger</button>
    <button class="nav-link ${activeTab === 'staff' ? 'active' : ''}" data-jtab="staff">Staff Board</button>
    <button class="nav-link ${activeTab === 'setup' ? 'active' : ''}" data-jtab="setup">Setup & Invites</button>
  `;
  dNav.querySelectorAll('[data-jtab]').forEach(b => {
    b.onclick = () => { activeTab = b.dataset.jtab; jeweller(); };
  });

  bNav.classList.remove('hidden');
  const tabs = [
    { id: 'today', label: 'Today', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>` },
    { id: 'customers', label: 'Customers', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path></svg>` },
    { id: 'ledger', label: 'Ledger', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>` },
    { id: 'staff', label: 'Staff', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>` },
    { id: 'setup', label: 'Setup', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>` },
  ];
  bNav.innerHTML = tabs.map(t => `
    <button class="nav-tab-item ${activeTab === t.id ? 'active' : ''}" data-jnav="${t.id}">
      ${t.icon}
      <span class="nav-tab-label">${t.label}</span>
    </button>
  `).join('');
  bNav.querySelectorAll('[data-jnav]').forEach(b => {
    b.onclick = () => { activeTab = b.dataset.jnav; jeweller(); };
  });
}

function renderJewellerView(me) {
  if (activeTab === 'today') renderJewellerToday(me);
  else if (activeTab === 'customers') renderJewellerCustomers(me);
  else if (activeTab === 'ledger') renderJewellerLedger(me);
  else if (activeTab === 'staff') renderJewellerStaff(me);
  else if (activeTab === 'setup') renderJewellerSetup(me);
}

function renderJewellerToday(me) {
  const ls = me.liabilitySummary || {
    goldGrams: 0, goldRupees: 0, silverGrams: 0, silverRupees: 0, totalLiabilityRupees: 0
  };

  app.innerHTML = `
  <!-- Luxury Greeting Header -->
  <div class="row between" style="margin-bottom:22px;flex-wrap:wrap;gap:14px;align-items:flex-end">
    <div>
      <h1 style="font-size:28px;font-weight:800;color:var(--ink-deep);margin:0 0 4px;letter-spacing:-0.03em">Welcome Back, ${esc(me.shop_name)}</h1>
      <div class="mute" style="font-size:13px">Showroom Dashboard · Store Code: <b style="font-family:var(--font-mono);color:var(--ink-deep)">${esc(me.store_code)}</b> · Status: <span class="pill ${me.status === 'ACTIVE' ? 'ok' : ''}">${esc(me.status)}</span></div>
    </div>
    <div class="row" style="gap:8px">
      <button id="copy-code-head-btn" class="chip" style="cursor:pointer;background:#ffffff;border:1px solid var(--border-glass);padding:8px 16px;font-weight:700;color:var(--ink-deep);box-shadow:0 2px 8px rgba(12,38,27,0.04)">
        Copy Store Code: <span style="font-family:var(--font-mono);color:var(--gold)">${esc(me.store_code)}</span>
      </button>
    </div>
  </div>

  ${me.status === 'SETUP' ? `
    <div class="card" style="background:rgba(255,255,255,0.9);border:1px solid rgba(201,142,31,0.4);box-shadow:0 10px 28px rgba(201,142,31,0.08);margin-bottom:24px;padding:18px 22px;border-radius:20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:40px;height:40px;border-radius:50%;background:var(--gold-bg);border:1px solid var(--gold-border);display:flex;align-items:center;justify-content:center;color:var(--gold);flex-shrink:0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
        </div>
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <b style="font-size:14px;color:var(--ink-deep)">Showroom Verification Pending</b>
            <span class="pill" style="background:var(--gold-bg);color:var(--gold);border:1px solid var(--gold-border);font-size:10px">Setup Mode</span>
          </div>
          <div class="mute" style="font-size:12px;margin-top:2px">
            Complete your 4-step compliance checklist to activate customer savings enrolments.
          </div>
        </div>
      </div>
      <button id="banner-goto-setup" class="tray-btn primary" style="padding:9px 20px;font-size:13px;width:auto">Finish Setup →</button>
    </div>
  ` : ''}

  <div class="dashboard-grid">
    <!-- Left Column: The Deep Emerald Metal Liability Hero Card -->
    <div class="portfolio-hero-card">
      <div class="zeni-inner-card" style="background:#061a12 !important;background-image:linear-gradient(135deg, #0d3222 0%, #061a12 60%, #030f0a 100%) !important;color:#ffffff !important;box-shadow:0 20px 42px rgba(4,22,14,0.4) !important;padding:26px">
        <div class="portfolio-card-top" style="margin-bottom:20px">
          <span class="showroom-flag" style="background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.3);color:#ffffff;font-size:12px;font-weight:700">${esc(me.shop_name)}</span>
          <button id="copy-shop-code-btn" class="chip" style="cursor:pointer;font-family:var(--font-mono);font-size:11px;background:rgba(255,255,255,0.18);color:#ffffff;border:1px solid rgba(255,255,255,0.3)">
            Store Code: <b>${esc(me.store_code)}</b>
          </button>
        </div>
        
        <div>
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:700;color:#9ad4b7;margin-bottom:4px">Total Customer Metal Liability</div>
          <div style="font-size:32px;font-weight:900;color:#ffffff;letter-spacing:-0.03em;margin-bottom:14px;text-shadow:0 2px 10px rgba(0,0,0,0.5)">
            ${inr(ls.totalLiabilityRupees)}
            <span style="font-size:14px;font-weight:600;color:#c9e8d7;margin-left:8px">valuation</span>
          </div>

          <!-- Segregated Gold and Silver Liability Badges -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
            <div style="background:rgba(255,255,255,0.08);border:1px solid rgba(201,142,31,0.3);border-radius:12px;padding:12px">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#f3d179;font-weight:700">Gold Owed (AU)</div>
              <div style="font-size:18px;font-weight:800;color:#ffffff;font-family:var(--font-mono);margin:2px 0">${g4(ls.goldGrams)}</div>
              <div style="font-size:11px;color:#d8efe2">≈ ${inr(ls.goldRupees)}</div>
            </div>
            <div style="background:rgba(255,255,255,0.08);border:1px solid rgba(15,118,110,0.3);border-radius:12px;padding:12px">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#9ee5df;font-weight:700">Silver Owed (AG)</div>
              <div style="font-size:18px;font-weight:800;color:#ffffff;font-family:var(--font-mono);margin:2px 0">${g4(ls.silverGrams)}</div>
              <div style="font-size:11px;color:#d8efe2">≈ ${inr(ls.silverRupees)}</div>
            </div>
          </div>

          <div class="portfolio-metal-worth" style="color:#c9e8d7 !important;font-size:12px">
            <span class="dot-pulse"></span>
            <span>Liability across ${me.customers.length} customer accounts · Counter Delivery Ready</span>
          </div>
        </div>
      </div>
      <div class="tray-buttons-row">
        <button class="tray-btn primary" id="jw-onboard-customer-btn">+ Onboard Customer</button>
        <button class="tray-btn ghost" id="jw-calibrate-btn">Calibrate Board Rate</button>
      </div>
    </div>

    <!-- Right Column: Daily Board Rate Calibration Card -->
    <div class="card" style="display:flex;flex-direction:column;justify-content:space-between;padding:24px">
      <div>
        <div class="board-header" style="margin-bottom:12px">
          <span class="board-title" style="font-size:16px;font-weight:800;color:var(--ink-deep)">Daily Board Rate Calibration</span>
          <span class="pill ok">Active Parity</span>
        </div>
        <p class="mute" style="font-size:12px;margin:0 0 16px;line-height:1.5">
          Calibrate spot quoting to today's counter board rate. Rates lock at the instant the customer makes a payment:
        </p>
        <div class="row" style="margin-bottom:14px;gap:10px">
          <select id="cp" style="flex:1.2;font-size:13px;padding:12px">${Object.entries(cfg.products).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}</select>
          <input id="cr" type="number" placeholder="₹ per gram" style="flex:1;font-family:var(--font-mono);font-size:16px;font-weight:700;padding:12px">
        </div>
        <button id="cal" class="btn-save-advance" style="width:100%;padding:14px;font-size:14px">Save Showroom Board Rate</button>
      </div>
      <div class="row between" style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-light);font-size:11px;color:var(--ink-secondary)">
        <span>Active Calibration: Gold ${(me.calib.gold * 100).toFixed(2)}% · Silver ${(me.calib.silver * 100).toFixed(2)}%</span>
        <span>100% Counter Delivery</span>
      </div>
    </div>
  </div>

  <!-- Asset Liability Matrix Breakdown -->
  <div class="card" style="padding:0;overflow:hidden;margin-bottom:24px">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border-card);display:flex;justify-content:space-between;align-items:center">
      <b style="font-size:15px;color:var(--ink-deep)">Precious Metals Liability Matrix</b>
      <span class="mute" style="font-size:12px">Exact weight owed per metal grade</span>
    </div>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Precious Metal Asset</th>
            <th>Type</th>
            <th>Total Grams Owed</th>
            <th>Showroom Worth</th>
            <th>Active Schemes</th>
          </tr>
        </thead>
        <tbody>
          ${(me.liability || []).map(l => {
            const isSilver = l.metal === 'SILVER' || (l.product && l.product.startsWith('S'));
            const count = me.customers.reduce((acc, c) => acc + (c.enrolments || []).filter(e => e.product === l.product).length, 0);
            return `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <span class="metal-badge-sq ${isSilver ? 'silver' : ''}" style="width:24px;height:24px;font-size:10px">${isSilver ? 'AG' : 'AU'}</span>
                  <div>
                    <div style="font-weight:700;font-size:13px;color:var(--ink-deep)">${esc(l.label || l.product)}</div>
                    <div class="mute" style="font-size:11px">${l.metal} (${(l.purity * 100).toFixed(1)}% pure)</div>
                  </div>
                </div>
              </td>
              <td><span class="pill ${isSilver ? '' : 'ok'}">${l.metal}</span></td>
              <td style="font-family:var(--font-mono);font-weight:800;color:var(--ink-deep)">${g4(l.grams || 0)}</td>
              <td><b style="color:var(--gold)">${inr(l.valueRupees || 0)}</b></td>
              <td><span style="font-size:12px;color:var(--ink-secondary)">${count} customer plans</span></td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Quick Showroom Actions Toolbar -->
  <div class="row" style="gap:12px;margin-bottom:24px;flex-wrap:wrap">
    <button class="tray-btn ghost" id="act-customers-btn" style="padding:10px 18px;font-size:13px;flex:unset">Enrolled Customers (${me.customers.length})</button>
    <button class="tray-btn ghost" id="act-qr-btn" style="padding:10px 18px;font-size:13px;flex:unset">Show Counter QR Code</button>
    <button class="tray-btn ghost" id="act-staff-btn" style="padding:10px 18px;font-size:13px;flex:unset">Staff Leaderboard</button>
    <button class="tray-btn ghost" id="act-setup-btn" style="padding:10px 18px;font-size:13px;flex:unset">Setup &amp; Invites</button>
  </div>

  <!-- Pending Customer Payments Table / Empty State -->
  <div class="section-heading-row">
    <span class="section-heading">Pending Customer Payments (${me.pending.length})</span>
  </div>
  <div class="card" style="padding:0;overflow:hidden">
    ${me.pending.length ? `
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Customer</th><th>Amount</th><th>Bank UTR</th><th>Action</th></tr></thead>
          <tbody>
            ${me.pending.map(p => `
              <tr>
                <td><b>${esc(p.customer)}</b></td>
                <td><b>${inr(p.amount)}</b></td>
                <td><code style="color:var(--gold);font-family:var(--font-mono)">${esc(p.utr)}</code></td>
                <td>
                  <button class="small btn-save-advance" data-ok="${p.id}">Received</button>
                  <button class="small ghost" data-no="${p.id}" style="color:var(--rose);margin-left:6px">Not Received</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>` : `
      <div style="padding:36px 20px;text-align:center;background:rgba(255,255,255,0.7)">
        <div style="width:48px;height:48px;border-radius:50%;background:var(--emerald-bg);border:1px solid var(--emerald-border);display:flex;align-items:center;justify-content:center;color:var(--emerald);margin:0 auto 12px">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        </div>
        <b style="font-size:15px;color:var(--ink-deep);display:block;margin-bottom:4px">All Counter Payments Reconciled</b>
        <div class="mute" style="font-size:13px;max-width:440px;margin:0 auto 16px">
          No customer instalment payments are currently awaiting confirmation. Share your showroom invite code <b>${esc(me.store_code)}</b> with walk-in customers.
        </div>
        <button id="empty-onboard-btn" class="tray-btn primary" style="width:auto;margin:0 auto;padding:10px 22px;font-size:13px">+ Onboard Customer</button>
      </div>
    `}
  </div>`;

  $('#jw-onboard-customer-btn').onclick = () => { activeTab = 'setup'; jeweller(); };
  $('#empty-onboard-btn')?.addEventListener('click', () => { activeTab = 'setup'; jeweller(); });
  $('#jw-calibrate-btn').onclick = () => { $('#cr').focus(); };
  $('#banner-goto-setup')?.addEventListener('click', () => { activeTab = 'setup'; jeweller(); });
  $('#copy-shop-code-btn')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(me.store_code);
    toast('Store Code ' + me.store_code + ' copied to clipboard!');
  });
  $('#copy-code-head-btn')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(me.store_code);
    toast('Store Code ' + me.store_code + ' copied to clipboard!');
  });
  $('#act-customers-btn')?.addEventListener('click', () => { activeTab = 'customers'; jeweller(); });
  $('#act-qr-btn')?.addEventListener('click', () => { activeTab = 'setup'; jeweller(); });
  $('#act-staff-btn')?.addEventListener('click', () => { activeTab = 'staff'; jeweller(); });
  $('#act-setup-btn')?.addEventListener('click', () => { activeTab = 'setup'; jeweller(); });

  app.querySelectorAll('[data-ok]').forEach(b => (b.onclick = guard(async () => { await api('POST', `/api/jeweller/payments/${b.dataset.ok}/confirm`); jeweller(); })));
  app.querySelectorAll('[data-no]').forEach(b => (b.onclick = guard(async () => {
    if (confirm('Mark as not received?')) { await api('POST', `/api/jeweller/payments/${b.dataset.no}/reject`, {}); jeweller(); }
  })));
  $('#cal').onclick = guard(async () => {
    const r = await api('POST', '/api/jeweller/calibrate', { product: $('#cp').value, board_rate: Number($('#cr').value) });
    toast(`Calibrated: ${r.factor_pct.toFixed(2)}%`); jeweller();
  });
}

function renderJewellerCustomers(me) {
  app.innerHTML = `
  <div class="section-heading-row" style="margin-top:8px">
    <h1 style="font-size:26px;font-weight:800;color:var(--ink-deep);margin:0">Enrolled Customers (${me.customers.length})</h1>
  </div>

  ${me.customers.length ? me.customers.map(c => `
    <div class="card" style="margin-bottom:16px">
      <div class="row between" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div>
          <b style="font-size:16px;color:var(--ink-deep)">${esc(c.name)}</b> <span class="mute" style="font-size:13px">(${esc(c.phone)})</span>
          <div class="mute" style="font-size:12px;margin-top:2px">PAN: <code style="color:var(--gold)">${esc(c.pan_masked)}</code> · KYC: <span class="pill ok" style="font-size:10px">${esc(c.kyc_status)}</span></div>
        </div>
        <div class="row" style="gap:8px">
          ${c.enrolments && c.enrolments[0] ? `
            <button class="small ghost" data-cust-passbook="${c.enrolments[0].id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              View Passbook
            </button>
          ` : ''}
          ${c.link_status === 'PENDING' ? `<button class="small btn-save-advance" data-ap="${c.id}">Approve Customer</button>` : ''}
          <button class="small ghost" data-nudge="${c.id}">WhatsApp Nudge</button>
        </div>
      </div>

      <!-- Customer Precious Metal Holdings Breakdown -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:10px;background:var(--bg-card-subtle);border-radius:12px;padding:12px;margin-bottom:12px">
        <div>
          <div class="mute" style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Gold Holdings (AU)</div>
          <div style="font-size:15px;font-weight:800;color:var(--gold);font-family:var(--font-mono)">${g4(c.totalGoldGrams || 0)}</div>
        </div>
        <div>
          <div class="mute" style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Silver Holdings (AG)</div>
          <div style="font-size:15px;font-weight:800;color:#0f766e;font-family:var(--font-mono)">${g4(c.totalSilverGrams || 0)}</div>
        </div>
        <div>
          <div class="mute" style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Total Deposited</div>
          <div style="font-size:15px;font-weight:800;color:var(--ink-deep)">${inr(c.totalPaidRupees || 0)}</div>
        </div>
        <div>
          <div class="mute" style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Active Schemes</div>
          <div style="font-size:15px;font-weight:800;color:var(--ink-deep)">${(c.enrolments || []).length} Plans</div>
        </div>
      </div>

      ${c.enrolments.map(e => {
        const isSilver = e.product.startsWith('S');
        return `
        <div class="row between" style="font-size:12px;border-top:1px solid var(--border-card);padding-top:10px;margin-top:8px">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="metal-badge-sq ${isSilver ? 'silver' : ''}" style="width:20px;height:20px;font-size:9px">${isSilver ? 'AG' : 'AU'}</span>
            <span>${esc(cfg.products[e.product]?.label || e.product)} · Holds <b style="color:var(--gold)">${g4(e.grams)}</b> · Missed: ${e.missed}</span>
          </div>
          <div class="row">
            ${e.status === 'ACTIVE' && e.matured ? `<button class="small btn-save-advance" data-rd="${e.id}">Redeem Goods</button>` : ''}
            ${e.status === 'ACTIVE' ? `<button class="small ghost" data-rf="${e.id}" style="color:var(--rose)">Refund</button>` : ''}
          </div>
        </div>
      `;
      }).join('')}
    </div>
  `).join('') : '<div class="card" style="padding:28px;text-align:center" class="mute">No customers linked yet</div>'}`;

  app.querySelectorAll('[data-cust-passbook]').forEach(b => {
    b.onclick = () => passbook(b.dataset.custPassbook);
  });
  app.querySelectorAll('[data-ap]').forEach(b => (b.onclick = guard(async () => { await api('POST', `/api/jeweller/customers/${b.dataset.ap}/approve`); jeweller(); })));
  app.querySelectorAll('[data-nudge]').forEach(b => (b.onclick = guard(async () => {
    const r = await api('POST', `/api/jeweller/customers/${b.dataset.nudge}/nudge`);
    toast(`WhatsApp nudge sent (${r.nudgesSent} alerts).`);
  })));
  app.querySelectorAll('[data-rd]').forEach(b => (b.onclick = guard(async () => {
    if (!confirm('Confirm customer collected goods at the showroom?')) return;
    const r = await api('POST', `/api/jeweller/enrolments/${b.dataset.rd}/redeem`, {});
    toast(`Redeemed ${r.grams.toFixed(4)} g physical goods`); jeweller();
  })));
  app.querySelectorAll('[data-rf]').forEach(b => (b.onclick = guard(async () => {
    if (!confirm('Authorize Day 364 statutory refund?')) return;
    const r = await api('POST', `/api/jeweller/enrolments/${b.dataset.rf}/refund`, {});
    toast(`Refund ${inr(r.refund)} executed`); jeweller();
  })));
}

async function renderJewellerLedger(me) {
  const l = await api('GET', '/api/jeweller/ledger');
  app.innerHTML = `
  <div class="section-heading-row" style="margin-top:8px">
    <div>
      <h1 style="font-size:26px;font-weight:800;color:var(--ink-deep);margin:0 0 4px">Showroom Ledger</h1>
      <div class="mute" style="font-size:13px">Showroom customer deposits and counter allocations</div>
    </div>
    <span class="pill ok">Verified &amp; Reconciled</span>
  </div>
  <div class="card" style="padding:0;overflow:hidden">
    <div class="table-wrapper" style="max-height:580px">
      <table>
        <thead>
          <tr>
            <th>Date &amp; Time</th>
            <th>Customer</th>
            <th>Asset</th>
            <th>Type</th>
            <th>Amount (₹)</th>
            <th>Locked Rate / g</th>
            <th>Grams Credited</th>
            <th>Bank UTR / Ref</th>
          </tr>
        </thead>
        <tbody>
          ${l.rows.length ? l.rows.map(r => {
            const isSilver = r.metal === 'SILVER' || (r.product && r.product.startsWith('S'));
            return `
            <tr>
              <td><span style="font-size:12px;color:var(--ink-secondary)">${when(r.ts)}</span></td>
              <td>
                <b style="color:var(--ink-deep);font-size:13px">${esc(r.name)}</b>
                <div class="mute" style="font-size:11px">${esc(r.phone || '')} · PAN: ${esc(r.pan_masked || '')}</div>
              </td>
              <td>
                <div style="display:flex;align-items:center;gap:6px">
                  <span class="metal-badge-sq ${isSilver ? 'silver' : ''}" style="width:22px;height:22px;font-size:9px">${isSilver ? 'AG' : 'AU'}</span>
                  <div>
                    <div style="font-weight:700;font-size:13px">${esc(r.productLabel || r.product || 'Metal')}</div>
                    <div class="mute" style="font-size:10px">${r.metal || ''}</div>
                  </div>
                </div>
              </td>
              <td><span class="pill ${r.type === 'CREDIT' ? 'ok' : 'bad'}">${esc(r.type)}</span></td>
              <td><b>${inr(r.amount)}</b></td>
              <td><span style="font-family:var(--font-mono);font-size:12px;color:var(--ink-secondary)">${r.ratePerGram ? inr(r.ratePerGram) + '/g' : '–'}</span></td>
              <td style="font-family:var(--font-mono);font-weight:800;color:${r.grams >= 0 ? 'var(--emerald)' : 'var(--rose)'}">${r.grams > 0 ? '+' : ''}${r.grams.toFixed(4)}</td>
              <td>
                ${r.bankUtr ? `<code style="font-size:11px;color:var(--gold)">${esc(r.bankUtr)}</code>` : `<code style="font-size:11px;color:var(--ink-secondary)">${esc(r.reference || '–')}</code>`}
              </td>
            </tr>
          `;
          }).join('') : `
            <tr><td colspan="8" style="text-align:center;padding:36px" class="mute">No transactions in showroom ledger yet.</td></tr>
          `}
        </tbody>
      </table>
    </div>
  </div>`;
}

async function renderJewellerStaff(me) {
  const list = await api('GET', '/api/jeweller/staff-leaderboard');
  app.innerHTML = `
  <div class="section-heading-row" style="margin-top:8px">
    <h1 style="font-size:26px;font-weight:800;color:var(--ink-deep);margin:0">Staff Performance Leaderboard</h1>
  </div>
  <div class="card" style="padding:0;overflow:hidden">
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Staff ID / Name</th><th>Customers Onboarded</th><th>Schemes Enrolled</th><th>Total Advance Value</th></tr></thead>
        <tbody>
          ${list.map(s => `
            <tr>
              <td><b>${esc(s.staff)}</b></td>
              <td>${s.customers}</td>
              <td>${s.schemes}</td>
              <td><b style="color:var(--gold)">${inr(s.totalRupees)}</b></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function renderJewellerSetup(me) {
  app.innerHTML = `
  <div class="section-heading-row" style="margin-top:8px">
    <div>
      <h1 style="font-size:26px;font-weight:800;color:var(--ink-deep);margin:0">Store Setup & Verification</h1>
      <p class="mute" style="font-size:13px;margin:4px 0 0">Complete your verification checklist to activate customer enrolments</p>
    </div>
    <span class="pill ${me.status === 'LIVE' ? 'ok' : ''}">${esc(me.status)}</span>
  </div>

  <div class="dashboard-grid">
    <!-- Counter QR & Store Code Card -->
    <div class="card" style="text-align:center">
      <h3 style="font-size:18px;color:var(--ink-deep);margin:0 0 6px">Counter QR & Store Code</h3>
      <p class="mute" style="font-size:12px;margin:0 0 16px">Display this permanent code at your showroom counter</p>
      
      <div style="background:#ffffff;padding:16px;border-radius:18px;border:1px solid var(--border-light);display:inline-block;margin-bottom:14px;box-shadow:0 4px 16px rgba(12,38,27,0.06)">
        <img src="/api/qr?data=${encodeURIComponent(me.store_code)}" width="160" height="160" style="display:block">
      </div>

      <div class="row" style="justify-content:center;gap:8px;margin-bottom:18px">
        <span class="chip" style="font-size:20px;letter-spacing:2px;font-weight:800;padding:10px 18px">${esc(me.store_code)}</span>
        <button id="btn-copy-code-setup" class="chip" style="cursor:pointer;padding:10px 16px">Copy Code</button>
      </div>

      <div style="border-top:1px solid var(--border-light);padding-top:16px;text-align:left">
        <label style="margin:0 0 6px">Generate Single-Use Staff Invite</label>
        <div class="row" style="gap:10px">
          <input id="stfid" placeholder="Staff Name or Counter No." style="flex:1">
          <button id="inv" class="btn-save-advance" style="white-space:nowrap;padding:12px 18px">Generate Code</button>
        </div>
      </div>
    </div>

    <!-- Verification Checklist & Go Live -->
    <div class="card">
      <div class="row between" style="margin-bottom:12px">
        <div>
          <h3 style="font-size:18px;color:var(--ink-deep);margin:0 0 4px">Verification Checklist</h3>
          <p class="mute" style="font-size:12px;margin:0">All items must be confirmed before store can go live</p>
        </div>
        ${me.status !== 'LIVE' ? '<button id="btn-tick-all" class="chip" style="cursor:pointer;font-size:11px;background:var(--emerald-bg);color:var(--emerald);border-color:var(--emerald-border)">Tick All Checks</button>' : ''}
      </div>

      ${me.checks.map(c => `
        <label style="display:flex;gap:12px;align-items:center;text-transform:none;font-size:13px;margin:12px 0;color:var(--ink-deep);cursor:pointer">
          <input type="checkbox" style="width:18px;height:18px;cursor:pointer" data-k="${c.key}" ${c.done ? 'checked' : ''} ${c.auto ? 'disabled' : ''}>
          <span>${esc(c.label)} ${c.auto ? '<span class="pill ok" style="font-size:10px;padding:1px 6px;margin-left:6px">Auto Verified</span>' : ''}</span>
        </label>
      `).join('')}

      <div style="margin-top:24px;border-top:1px solid var(--border-light);padding-top:18px">
        ${me.status === 'LIVE' 
          ? '<div class="pill ok" style="padding:12px;width:100%;text-align:center;font-size:14px">Showroom is Active &amp; LIVE</div>' 
          : '<button id="live" class="btn-save-advance" style="width:100%;padding:16px;font-size:15px">Confirm Checklist &amp; Go Live</button>'
        }
      </div>
    </div>
  </div>`;

  $('#btn-copy-code-setup')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(me.store_code);
    toast(`Store Code ${me.store_code} copied!`, 'success');
  });

  $('#btn-tick-all')?.addEventListener('click', guard(async () => {
    for (const c of me.checks) {
      if (!c.auto && !c.done) {
        await api('POST', '/api/jeweller/checklist', { key: c.key, done: true });
      }
    }
    toast('All checks completed! Click Go Live to activate.', 'success');
    jeweller();
  }));

  app.querySelectorAll('[data-k]').forEach(c => (c.onchange = guard(async () => {
    await api('POST', '/api/jeweller/checklist', { key: c.dataset.k, done: c.checked });
  })));

  $('#live')?.addEventListener('click', guard(async () => {
    await api('POST', '/api/jeweller/golive');
    toast('Your showroom is now LIVE! Customers can now link and save.', 'success');
    activeTab = 'today';
    jeweller();
  }));

  $('#inv').onclick = guard(async () => {
    const r = await api('POST', '/api/jeweller/invite', { staff_id: $('#stfid').value });
    toast('Single-use counter invite generated: ' + r.code, 'success');
  });
}

function jwRegister() {
  dNav.style.display = 'none';
  bNav.classList.add('hidden');
  app.innerHTML = `
  <div style="max-width:540px;margin:30px auto">
    <div class="card" style="padding:32px 28px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">
        <div>
          <h2 style="font-size:22px;color:var(--ink-deep);margin:0 0 6px">Register Jewellery Store</h2>
          <p class="mute" style="font-size:13px;margin:0">Set up your showroom for customer jewellery savings plans</p>
        </div>
        <button type="button" id="fill-demo-jw" class="chip" style="cursor:pointer;background:var(--emerald-bg);color:var(--emerald);border-color:var(--emerald-border);font-size:11px">
          Fill Demo Details
        </button>
      </div>

      <label>Owner Name</label>
      <input id="o" placeholder="e.g. Anil Mehta">

      <label>Jewellery Store Name</label>
      <input id="s" placeholder="e.g. Mehta Jewellers">

      <label>City</label>
      <input id="c" placeholder="e.g. Mumbai">

      <label>Store UPI ID (Direct Counter Settlement)</label>
      <input id="v" placeholder="e.g. mehtajewellers@okhdfcbank">
      <span class="mute" style="font-size:11px;display:block;margin-top:4px">Customer payments settle directly into your bank account via this UPI ID</span>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px">
        <div>
          <label style="margin-top:4px">Business PAN</label>
          <input id="p" maxlength="10" placeholder="AAPFU0939F" style="text-transform:uppercase;font-family:var(--font-mono)">
        </div>
        <div>
          <label style="margin-top:4px">GSTIN</label>
          <input id="g" maxlength="15" placeholder="27AAPFU0939F1ZV" style="text-transform:uppercase;font-family:var(--font-mono)">
        </div>
      </div>

      <label style="margin-top:12px">BIS Hallmark Certificate No. (Optional)</label>
      <input id="b" placeholder="e.g. BIS-9988">

      <button id="go" class="btn-save-advance" style="width:100%;margin-top:22px;padding:16px;font-size:15px">
        Register Store &amp; Generate Code
      </button>
    </div>
  </div>`;

  $('#fill-demo-jw')?.addEventListener('click', () => {
    $('#o').value = 'Rajesh Varma';
    $('#s').value = 'Varma Gold & Diamonds';
    $('#c').value = 'Mumbai';
    $('#v').value = 'varmagold@okhdfcbank';
    $('#p').value = 'AAPFU0939F';
    $('#g').value = '27AAPFU0939F1ZV';
    $('#b').value = 'BIS-9988';
  });

  $('#go').onclick = guard(async () => {
    const owner_name = $('#o').value.trim();
    const shop_name = $('#s').value.trim();
    const city = $('#c').value.trim();
    const upi_vpa = $('#v').value.trim();
    const pan = $('#p').value.trim().toUpperCase();
    const gstin = $('#g').value.trim().toUpperCase();
    const bis_no = $('#b').value.trim();

    if (!owner_name || !shop_name || !city) {
      throw new Error('Please enter owner name, store name, and city.');
    }
    if (!upi_vpa.includes('@')) {
      throw new Error('Please enter a valid UPI ID (e.g. shopname@okhdfcbank).');
    }
    if (pan.length !== 10) {
      throw new Error('Business PAN must be 10 characters (e.g. AAPFU0939F).');
    }

    const btn = $('#go');
    btn.disabled = true;
    btn.textContent = 'Registering Store...';

    try {
      const res = await api('POST', '/api/jeweller/register', {
        owner_name, shop_name, city, upi_vpa, pan, gstin, bis_no
      });
      toast(`Showroom registered! Your Store Code is ${res.store_code}`, 'success');
      activeTab = 'setup';
      await jeweller();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Register Store & Generate Code';
      throw err;
    }
  });
}

// ---------------- Boot ----------------
function start() {
  session?.role === 'customer' ? guard(customer)() : session?.role === 'jeweller' ? guard(jeweller)() : landing();
}

(async () => {
  const urlP = new URLSearchParams(window.location.search);
  if (urlP.get('payment') === 'success') {
    toast(`Payment ${urlP.get('ref') || ''} confirmed by ICICI Bank! Pure metal credited.`, 'success');
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (urlP.get('payment') === 'failed') {
    toast(`Payment ${urlP.get('ref') || ''} was not completed or was declined by bank.`, 'error');
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  cfg = await (await fetch('/api/config')).json();
  if (cfg.rates) updateLiveTicker(cfg.rates);
  if (cfg.dev) {
    const d = $('#dev');
    if (d) {
      d.style.display = 'block';
      d.innerHTML = `Test Mode: Clock Offset +${cfg.clockOffsetDays}d <button id="a30">+30d</button> <button id="a335">+335d</button> <button id="a365">+365d</button>`;
      for (const n of [30, 335, 365]) $('#a' + n).onclick = async () => {
        await fetch('/api/dev/advance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ days: n }) });
        location.reload();
      };
    }
  }
  start();

  // Dynamic Real-time Live Bullion Ticker Auto-Poller (Every 10 Seconds)
  setInterval(async () => {
    try {
      const res = await fetch('/api/rates');
      const rt = await res.json();
      if (rt && rt.rates) {
        updateLiveTicker(rt);
        const lGrid = $('#landing-rates-grid');
        if (lGrid) renderLandingRatesGrid(rt);
        const ov = $('#overview-rates-list');
        if (ov) ov.innerHTML = renderRatesList(rt);
        const tag = $('#live-rate-status-tag');
        if (tag) tag.textContent = 'Live · Refreshed just now';
      }
    } catch {}
  }, 10000);
})();
