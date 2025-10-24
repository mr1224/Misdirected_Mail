// === 設定 ===
const INTERNAL_DOMAINS = [
  // ここに自社ドメインを列挙（親ドメインでサブドメインも内部扱い）
  "gmail.com"
];
const COUNTDOWN_SEC = 3;

// === DOMフック実装（InboxSDK なし）===
let bypassOnce = false;

// 送信ボタンへ動的にバインド
const mo = new MutationObserver(() => bindSendButtons());
mo.observe(document.documentElement, { subtree: true, childList: true });
bindSendButtons();

// Ctrl/Cmd+Enter を横取り
document.addEventListener(
  "keydown",
  async (e) => {
    const isSubmitShortcut = e.key === "Enter" && (e.ctrlKey || e.metaKey);
    if (!isSubmitShortcut) return;
    if (bypassOnce) return;
    const composeRoot = findNearestComposeRoot(document.activeElement) || document;
    const recipients = collectRecipientsFromDOM(composeRoot);
    const externals = recipients.filter(isExternalDomain);
    if (externals.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const ok = await showCountdownModal(externals, COUNTDOWN_SEC);
    if (ok) {
      bypassOnce = true;
      const btn = findSendButton(composeRoot) || findAnySendButton();
      btn?.click();
      setTimeout(() => (bypassOnce = false), 800);
    }
  },
  true
);

function bindSendButtons() {
  const sel = [
    '[role="button"][data-tooltip*="送信"]',
    '[role="button"][data-tooltip*="Send"]',
    '[aria-label*="送信"]',
    '[aria-label*="Send"]'
  ].join(",");
  document.querySelectorAll(sel).forEach((btn) => {
    if (btn.__gescBound) return;
    btn.__gescBound = true;
    btn.addEventListener(
      "click",
      async (e) => {
        if (bypassOnce) return;
        const composeRoot = findNearestComposeRoot(btn) || document;
        const recipients = collectRecipientsFromDOM(composeRoot);
        const externals = recipients.filter(isExternalDomain);
        if (externals.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        const ok = await showCountdownModal(externals, COUNTDOWN_SEC);
        if (ok) {
          bypassOnce = true;
          setTimeout(() => {
            try { btn.click(); } finally { setTimeout(() => (bypassOnce = false), 500); }
          }, 0);
        }
      },
      true
    );
  });
}

function findNearestComposeRoot(el) {
  if (!el || !el.closest) return null;
  return (
    el.closest('div[role="dialog"]') || // ポップアウト作成
    el.closest('.nH[role="region"]') || // サイド作成
    el.closest('.AD') || // 旧UIの作成領域
    null
  );
}

function findSendButton(root) {
  const sel = [
    '[role="button"][data-tooltip*="送信"]',
    '[role="button"][data-tooltip*="Send"]',
    '[aria-label*="送信"]',
    '[aria-label*="Send"]'
  ].join(",");
  return root?.querySelector?.(sel) || null;
}

function findAnySendButton() {
  const sel = [
    '[role="button"][data-tooltip*="送信"]',
    '[role="button"][data-tooltip*="Send"]',
    '[aria-label*="送信"]',
    '[aria-label*="Send"]'
  ].join(",");
  const list = document.querySelectorAll(sel);
  return list[0] || null;
}

// 宛先抽出（DOM）
function collectRecipientsFromDOM(scope) {
  try {
    const emails = new Set();
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    const splitRegex = /[;,\s、，；]+/; // 多言語の区切りに対応

    const pushAll = (s) => String(s || "")
      .split(splitRegex)
      .forEach((x) => {
        const m = x.match(emailRegex);
        if (m) emails.add(m[0].toLowerCase());
      });

    const q = (sel) => scope.querySelector?.(sel);
    const qa = (sel) => scope.querySelectorAll?.(sel) || [];

    // 入力欄（空のこともある）
    const to = q('textarea[name="to"]');
    const cc = q('textarea[name="cc"]');
    const bcc = q('textarea[name="bcc"]');
    if (to?.value) pushAll(to.value);
    if (cc?.value) pushAll(cc.value);
    if (bcc?.value) pushAll(bcc.value);

    // 受信者チップ（data-hovercard-id にメールが入ることが多い）
    qa('[data-hovercard-id*="@"]').forEach((el) => {
      const v = el.getAttribute('data-hovercard-id');
      if (v && emailRegex.test(v)) emails.add(v.toLowerCase());
    });

    // mailto リンク（予備）
    qa('a[href^="mailto:"]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const addr = decodeURIComponent(href.replace(/^mailto:/i, '').split('?')[0]);
      if (emailRegex.test(addr)) emails.add(addr.toLowerCase());
    });

    // ラベル付近のテキスト（宛先/To/Cc/Bcc）
    qa('[aria-label*="宛先"], [aria-label*="To"], [aria-label*="Cc"], [aria-label*="Bcc"]').forEach((c) => {
      pushAll(c.textContent || '');
    });

    return Array.from(emails);
  } catch (e) {
    console.warn('GESC: collectRecipientsFromDOM error', e);
    return [];
  }
}

// 外部ドメイン判定
function isExternalDomain(email) {
  const m = /@([^>\s]+)$/.exec(email);
  if (!m) return true;
  const domain = m[1].replace(/[>\s]/g, "");
  return !INTERNAL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

// チェックリスト式モーダル（全チェックで送信可能・全選択なし）
function showCountdownModal(externals, _secondsIgnored = 0) {
  return new Promise((resolve) => {
    // 既存UIの掃除
    document.getElementById("gesc-overlay")?.remove();
    document.getElementById("gesc-style")?.remove();

    // スタイル
    const style = document.createElement("style");
    style.id = "gesc-style";
    style.textContent = `
#gesc-overlay { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans JP", sans-serif; }
#gesc-modal { background: #fff; color: #111; width: 560px; max-width: 92vw; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); padding: 20px 20px 16px; }
#gesc-title { font-size: 16px; font-weight: 700; margin: 0 0 12px; }
#gesc-note { font-size: 13px; color: #444; margin: 6px 0 12px; }
#gesc-list { background: #f7f7f7; border-radius: 8px; padding: 10px; margin: 8px 0 14px; max-height: 200px; overflow: auto; font-size: 13px; }
.gesc-row { display: flex; align-items: center; gap: 8px; padding: 6px 4px; }
.gesc-email { word-break: break-all; }
#gesc-actions { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
#gesc-remaining { margin-right: auto; font-size: 12px; color: #555; }
.gesc-btn { border: 1px solid #d0d0d0; background: #fff; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
.gesc-btn.primary { background: #1a73e8; border-color: #1a73e8; color: #fff; }
.gesc-btn[disabled] { opacity: 0.6; cursor: not-allowed; }`;
    document.documentElement.appendChild(style);

    // ルート
    const overlay = document.createElement("div");
    overlay.id = "gesc-overlay";
    overlay.setAttribute("role", "presentation");

    const modal = document.createElement("div");
    modal.id = "gesc-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "gesc-title");
    modal.tabIndex = -1;

    // タイトル・説明
    const title = document.createElement("h2");
    title.id = "gesc-title";
    title.textContent = "社外宛先を検出しました。送信してよろしいですか？";

    const note = document.createElement("div");
    note.id = "gesc-note";
    note.append(
      document.createTextNode("次の宛先は "),
      (() => { const b = document.createElement("b"); b.textContent = "組織外ドメイン"; return b; })(),
      document.createTextNode(" です。各宛先の確認チェックを入れてください。")
    );

    // リスト（チェックボックス付き）
    const list = document.createElement("div");
    list.id = "gesc-list";

    const uniq = Array.from(new Set(externals.map((e) => String(e).toLowerCase())));
    const checkboxes = [];
    uniq.forEach((addr, idx) => {
      const row = document.createElement("label");
      row.className = "gesc-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = `gesc-cb-${idx}`;
      cb.setAttribute("data-email", addr);
      const span = document.createElement("span");
      span.className = "gesc-email";
      span.textContent = addr;
      row.append(cb, span);
      list.appendChild(row);
      checkboxes.push(cb);
    });

    // アクション
    const actions = document.createElement("div");
    actions.id = "gesc-actions";

    // 残数表示
    const remaining = document.createElement("span");
    remaining.id = "gesc-remaining";

    const cancel = document.createElement("button");
    cancel.className = "gesc-btn";
    cancel.id = "gesc-cancel";
    cancel.textContent = "編集に戻る";

    const ok = document.createElement("button");
    ok.className = "gesc-btn primary";
    ok.id = "gesc-ok";
    ok.textContent = "送信する";
    ok.disabled = true;

    actions.append(remaining, cancel, ok);
    modal.append(title, note, list, actions);
    overlay.appendChild(modal);
    document.documentElement.appendChild(overlay);
    modal.focus();

    // 有効化条件：全チェック
    const updateState = () => {
      const total = checkboxes.length;
      const checked = checkboxes.filter(c => c.checked).length;
      const left = total - checked;
      ok.disabled = (left > 0);
      remaining.textContent = left > 0 ? `未チェック: ${left} 件` : "すべて確認済みです";
    };
    checkboxes.forEach((c) => c.addEventListener("change", updateState));
    updateState();

    // キーボード
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); cancel.click(); }
      else if (e.key === "Enter" && !ok.disabled) { e.preventDefault(); ok.click(); }
    });

    // 後片付け
    const cleanup = () => { overlay.remove(); style.remove(); };
    cancel.addEventListener("click", () => { cleanup(); resolve(false); });
    ok.addEventListener("click", () => { if (ok.disabled) return; cleanup(); resolve(true); });
  });
}

