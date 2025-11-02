// Gmail External Send Confirm (+all-address)
// Clean, reply-safe implementation

// Settings
const INTERNAL_DOMAINS = ["gmail.com"]; // add your internal domains
const COMPANY_ALL_ADDRESS = "abcd@gmail.com"; // change to your all-hands address

// Selectors
const SELECTORS = {
  send: [
    '[role="button"][data-tooltip*="送信"]',
    '[role="button"][data-tooltip*="Send"]',
    '[aria-label*="送信"]',
    '[aria-label*="Send"]',
    '.T-I.J-J5-Ji.aoO'
  ].join(',')
};

// Utils
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ADDRESS_RE = /<?([^<>\s]+@[^<>\s]+)>?/;
const SPLIT_RE = /[;,.\s、；]+/;
const qs = (s, sel) => s?.querySelector?.(sel) || null;
const qsa = (s, sel) => Array.from(s?.querySelectorAll?.(sel) || []);
const uniqLower = (a) => Array.from(new Set(a.map((x) => String(x).toLowerCase())));
const settleDom = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

// DOM helpers
const dom = {
  nearestComposeRoot(el) {
    if (!el?.closest) return null;
    return (
      el.closest('div[role="dialog"]') ||
      el.closest('.nH[role="region"]') ||
      el.closest('.AD') ||
      null
    );
  },
  findSendButton(root) { return root?.querySelector?.(SELECTORS.send) || null; },
  findAnySendButton() { return document.querySelector(SELECTORS.send) || null; },
};

// Address helpers
const normalizeAddress = (addr) => {
  const m = ADDRESS_RE.exec(String(addr || '').toLowerCase());
  return m ? m[1] : null;
};
const isInternalDomain = (domain) => INTERNAL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
const isExternal = (email) => {
  const m = /@([^>\s]+)$/.exec(email);
  if (!m) return true;
  return !isInternalDomain(m[1].replace(/[>\s]/g, ''));
};
const isCompanyAll = (email) => normalizeAddress(email) === COMPANY_ALL_ADDRESS;

// Recipient collection (strict: compose To/Cc/Bcc only)
function collectRecipients(scope) {
  try {
    const emails = new Set();
    const pushFromText = (s) => String(s || '')
      .split(SPLIT_RE)
      .forEach((x) => { const m = x.match(EMAIL_RE); if (m) emails.add(m[0].toLowerCase()); });

    const addChipsFrom = (container) => {
      if (!container?.querySelectorAll) return;
      container.querySelectorAll('[data-hovercard-id*="@"]').forEach((el) => {
        const v = el.getAttribute('data-hovercard-id');
        if (v && EMAIL_RE.test(v)) emails.add(v.toLowerCase());
      });
    };

    const to = qs(scope, 'textarea[name="to"]');
    const cc = qs(scope, 'textarea[name="cc"]');
    const bcc = qs(scope, 'textarea[name="bcc"]');
    [to, cc, bcc].forEach((field) => {
      if (!field) return;
      if (field.value) pushFromText(field.value);
      const container = field.closest('[role="combobox"]') || field.parentElement;
      addChipsFrom(container);
    });

    qsa(scope, '[aria-label*="宛"], [aria-label*="To"], [aria-label*="Cc"], [aria-label*="Bcc"]').forEach(addChipsFrom);

    return Array.from(emails);
  } catch (e) {
    console.warn('GESC: collectRecipients error', e);
    return [];
  }
}

async function getStableRecipients(root, { minStableFrames = 2, maxWaitMs = 350 } = {}) {
  const start = performance.now();
  let last = '';
  let stable = 0;
  while (true) {
    await settleDom();
    const nowList = uniqLower(collectRecipients(root)).sort();
    const key = nowList.join(',');
    if (last === key) {
      stable += 1;
      if (stable >= minStableFrames) return nowList;
    } else { last = key; stable = 1; }
    if (performance.now() - start > maxWaitMs) return nowList;
  }
}

// Modal
function showChecklistModal({ externals = [], allHands = [] }) {
  return new Promise((resolve) => {
    document.getElementById('gesc-overlay')?.remove();
    document.getElementById('gesc-style')?.remove();

    const style = document.createElement('style');
    style.id = 'gesc-style';
    style.textContent = `#gesc-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,\"Segoe UI\",Roboto,\"Noto Sans JP\",sans-serif}#gesc-modal{background:#fff;color:#111;width:560px;max-width:92vw;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:20px 20px 16px}#gesc-title{font-size:16px;font-weight:700;margin:0 0 12px}.gesc-note{font-size:13px;color:#444;margin:6px 0 10px}.gesc-list{background:#f7f7f7;border-radius:8px;padding:10px;margin:0 0 12px;max-height:200px;overflow:auto;font-size:13px}.gesc-row{display:flex;align-items:center;gap:8px;padding:6px 4px}.gesc-email{word-break:break-all}#gesc-actions{display:flex;gap:8px;justify-content:flex-end;align-items:center}#gesc-remaining{margin-right:auto;font-size:12px;color:#555}.gesc-btn{border:1px solid #d0d0d0;background:#fff;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer}.gesc-btn.primary{background:#1a73e8;border-color:#1a73e8;color:#fff}.gesc-btn[disabled]{opacity:.6;cursor:not-allowed}`;
    document.documentElement.appendChild(style);

    const ext = uniqLower(externals);
    const all = uniqLower(allHands);

    const overlay = document.createElement('div');
    overlay.id = 'gesc-overlay';
    const modal = document.createElement('div');
    modal.id = 'gesc-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'gesc-title');
    modal.tabIndex = -1;

    const title = document.createElement('h2');
    title.id = 'gesc-title';
    const noteTop = document.createElement('div');
    noteTop.className = 'gesc-note';

    if (ext.length > 0 && all.length > 0) {
      title.textContent = '社外宛先・全社宛を検出しました。送信してよろしいですか？';
      noteTop.textContent = '各宛先を確認してください。';
    } else if (all.length > 0) {
      title.textContent = '全社宛を検出しました。送信してよろしいですか？';
      noteTop.textContent = '社内全員に送信されます。各宛先を確認してください。';
    } else {
      title.textContent = '社外宛先を検出しました。送信してよろしいですか？';
      noteTop.textContent = '各宛先を確認してください。';
    }
    modal.append(title, noteTop);

    const checkboxes = [];
    const appendList = (addresses) => {
      const list = document.createElement('div');
      list.className = 'gesc-list';
      addresses.forEach((addr, i) => {
        const row = document.createElement('label');
        row.className = 'gesc-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = `gesc-${i}-${Math.random().toString(36).slice(2,7)}`;
        cb.setAttribute('data-email', addr);
        const span = document.createElement('span');
        span.className = 'gesc-email';
        span.textContent = addr;
        row.append(cb, span);
        list.appendChild(row);
        checkboxes.push(cb);
      });
      modal.append(list);
    };

    if (ext.length > 0) appendList(ext);
    if (all.length > 0) {
      if (ext.length > 0) {
        const noteAll = document.createElement('div');
        noteAll.className = 'gesc-note';
        noteAll.textContent = '社内全員に送信されます。各宛先を確認してください。';
        modal.append(noteAll);
      }
      appendList(all);
    }

    const actions = document.createElement('div');
    actions.id = 'gesc-actions';
    const remaining = document.createElement('span');
    remaining.id = 'gesc-remaining';
    const cancel = document.createElement('button');
    cancel.className = 'gesc-btn';
    cancel.id = 'gesc-cancel';
    cancel.textContent = '編集に戻る';
    const ok = document.createElement('button');
    ok.className = 'gesc-btn primary';
    ok.id = 'gesc-ok';
    ok.textContent = '送信する';
    ok.disabled = true;
    actions.append(remaining, cancel, ok);
    modal.append(actions);
    overlay.appendChild(modal);
    document.documentElement.appendChild(overlay);
    modal.focus();

    const updateState = () => {
      const total = checkboxes.length;
      const checked = checkboxes.filter((c) => c.checked).length;
      const left = total - checked;
      ok.disabled = left > 0;
      remaining.textContent = left > 0 ? `未チェック: ${left} 件` : 'すべて確認済みです';
    };
    checkboxes.forEach((c) => c.addEventListener('change', updateState));
    updateState();

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel.click(); }
      else if (e.key === 'Enter' && !ok.disabled) { e.preventDefault(); ok.click(); }
    });

    const cleanup = () => { overlay.remove(); style.remove(); };
    cancel.addEventListener('click', () => { cleanup(); resolve(false); });
    ok.addEventListener('click', () => { if (ok.disabled) return; cleanup(); resolve(true); });
  });
}

// Commit inputs
function commitRecipientInputs(root) {
  const targets = [
    'textarea[name="to"]', 'textarea[name="cc"]', 'textarea[name="bcc"]',
    '[role="combobox"]', '[role="textbox"][aria-multiline="true"]', '[contenteditable="true"]',
  ].join(',');
  qsa(root, targets).forEach((el) => {
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur?.();
    } catch (e) {}
  });
}

// Intercept & confirm
let bypassOnce = false;
let sendGuardOpen = false;

async function interceptAndConfirm(triggerEl) {
  if (bypassOnce) return true;
  const root = dom.nearestComposeRoot(triggerEl) || document;
  commitRecipientInputs(root);

  let recipients = await getStableRecipients(root);
  if (!recipients || recipients.length === 0) {
    // Narrow fallback: region-limited and recipient areas only
    const region = root.closest?.('.nH[role="region"]') || root.closest?.('.nH') || null;
    if (region) {
      const emails = new Set();
      const addChipsFrom = (container) => {
        container?.querySelectorAll?.('[data-hovercard-id*="@"]').forEach((el) => {
          const v = el.getAttribute('data-hovercard-id');
          if (v && EMAIL_RE.test(v)) emails.add(v.toLowerCase());
        });
      };
      const to = region.querySelector('textarea[name="to"]');
      const cc = region.querySelector('textarea[name="cc"]');
      const bcc = region.querySelector('textarea[name="bcc"]');
      [to, cc, bcc].forEach((f) => addChipsFrom(f?.closest('[role="combobox"]') || f?.parentElement));
      region.querySelectorAll('[aria-label*="宛"], [aria-label*="To"], [aria-label*="Cc"], [aria-label*="Bcc"]').forEach(addChipsFrom);
      recipients = Array.from(emails);
    }
  }

  const externals = recipients.filter(isExternal);
  const allHands = recipients.filter(isCompanyAll);
  if (externals.length === 0 && allHands.length === 0) return true;

  const ok = await showChecklistModal({ externals, allHands });
  if (!ok) return false;

  sendGuardOpen = true;
  bypassOnce = true;
  setTimeout(() => { sendGuardOpen = false; bypassOnce = false; }, 800);
  return true;
}

// Block submit unless allowed
document.addEventListener('submit', (e) => {
  if (sendGuardOpen) return;
  e.preventDefault();
  e.stopImmediatePropagation?.();
  e.stopPropagation();
}, true);

// Filter non-send buttons (avoid "送信済み" etc.)
function isRealSendButton(btn) {
  if (!btn) return false;
  const aria = (btn.getAttribute('aria-label') || '').trim();
  const tip = (btn.getAttribute('data-tooltip') || '').trim();
  const text = (btn.textContent || '').trim();
  const blacklist = ['送信済み', 'その他の送信オプション'];
  return !blacklist.some((w) => aria.includes(w) || tip.includes(w) || text.includes(w));
}

// Bind buttons dynamically
function bindSendButtons() {
  document.querySelectorAll(SELECTORS.send).forEach((btn) => {
    if (!isRealSendButton(btn)) return;
    if (btn.__gescBound) return;
    btn.__gescBound = true;

    const handler = async (e) => {
      if (bypassOnce) return;
      e.preventDefault();
      e.stopImmediatePropagation?.();
      e.stopPropagation();
      const allowed = await interceptAndConfirm(btn);
      if (!allowed) return;
      if (!bypassOnce) { bypassOnce = true; setTimeout(() => (bypassOnce = false), 800); }
      btn.click();
    };

    btn.addEventListener('mousedown', handler, true);
    btn.addEventListener('click', handler, true);
  });
}

const mo = new MutationObserver(bindSendButtons);
mo.observe(document.documentElement, { subtree: true, childList: true });
bindSendButtons();

// Keyboard shortcut Ctrl/Cmd+Enter
document.addEventListener('keydown', async (e) => {
  const isSubmitShortcut = e.key === 'Enter' && (e.ctrlKey || e.metaKey);
  if (!isSubmitShortcut) return;
  e.preventDefault();
  e.stopImmediatePropagation?.();
  e.stopPropagation();

  const allowed = await interceptAndConfirm(document.activeElement);
  if (!allowed) return;
  const root = dom.nearestComposeRoot(document.activeElement) || document;
  const btn = dom.findSendButton(root) || dom.findAnySendButton();
  if (btn) {
    if (!bypassOnce) { bypassOnce = true; setTimeout(() => (bypassOnce = false), 800); }
    btn.click();
  }
}, true);

// Delegated click capture
document.addEventListener('click', async (e) => {
  const targetBtn = e.target?.closest?.(SELECTORS.send);
  if (!targetBtn) return;
  if (!isRealSendButton(targetBtn)) return;
  if (bypassOnce) return;
  e.preventDefault();
  e.stopImmediatePropagation?.();
  e.stopPropagation();
  const allowed = await interceptAndConfirm(targetBtn);
  if (!allowed) return;
  if (!bypassOnce) { bypassOnce = true; setTimeout(() => (bypassOnce = false), 800); }
  targetBtn.click();
}, true);

