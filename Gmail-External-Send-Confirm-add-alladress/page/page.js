/******************************
 * 設定
 ******************************/
const INTERNAL_DOMAINS = [
    // 親ドメインでサブドメインも内部扱い
    "gmail.com",
];
const COMPANY_ALL_ADDRESS = "abcd@gmail.com"; // ←環境に合わせて

/******************************
 * 共通ユーティリティ
 ******************************/
const SELECTORS = {
    send: [
        '[role="button"][data-tooltip*="送信"]',
        '[role="button"][data-tooltip*="Send"]',
        '[aria-label*="送信"]',
        '[aria-label*="Send"]',
    ].join(","),
};
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ADDRESS_RE = /<?([^<>\s]+@[^<>\s]+)>?/; // "Name <a@b>" → a@b
const SPLIT_RE = /[;,\s、，；]+/; // 多言語区切り

const by = {
    qs: (scope, sel) => scope.querySelector?.(sel) || null,
    qsa: (scope, sel) => Array.from(scope.querySelectorAll?.(sel) || []),
};

const str = {
    toLower: (s) => String(s || "").trim().toLowerCase(),
};

const arr = {
    uniqLower: (a) => Array.from(new Set(a.map((x) => str.toLower(x)))),
};

const dom = {
    nearestComposeRoot(el) {
        if (!el || !el.closest) return null;
        return (
            el.closest('div[role="dialog"]') || // ポップアウト
            el.closest('.nH[role="region"]') || // サイド
            el.closest('.AD') || // 旧UI
            null
        );
    },
    findSendButton(root) {
        return root?.querySelector?.(SELECTORS.send) || null;
    },
    findAnySendButton() {
        return document.querySelector(SELECTORS.send) || null;
    },
};
const settleDom = () =>
    new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (!done) {
                done = true;
                resolve();
            }
        };
        // レイアウト反映を待つため rAF×2
        requestAnimationFrame(() => requestAnimationFrame(finish));
        // 稀な取りこぼし対策の保険（最初に完了した方が採用される）
        setTimeout(finish, 50);
    });

// ★ 受信者入力の確定（To/Cc/Bcc がフォーカス中なら blur して確定させる）
// ★ 宛先の削除/編集を強制コミット（blur）し、本文 or 件名にフォーカスを移す
function commitRecipientInputs(root) {
    // 1) 宛先入力系（textarea/combobox/contenteditable）を総当りで blur
    const targetSelectors = [
        'textarea[name="to"]',
        'textarea[name="cc"]',
        'textarea[name="bcc"]',
        // Gmail の別UIで使われる候補
        '[aria-label*="宛先"]',
        '[aria-label*="To"]',
        '[aria-label*="Cc"]',
        '[aria-label*="Bcc"]',
        '[role="combobox"]',
        '[role="textbox"][aria-multiline="true"]',
        '[contenteditable="true"]',
    ].join(',');

    let didBlur = false;
    root.querySelectorAll(targetSelectors).forEach((el) => {
        try {
            el.dispatchEvent(new Event('input', {
                bubbles: true
            }));
            el.dispatchEvent(new Event('change', {
                bubbles: true
            }));
            if (typeof el.blur === 'function') {
                el.blur();
                didBlur = true;
            }
        } catch (e) {}
    });

    // ★ セレクタに掛からなくても、compose 内でフォーカス中なら必ず外す
    if (root.contains(document.activeElement)) {
        try {
            document.activeElement.blur();
            didBlur = true;
        } catch (e) {}
    }

    // 2) “本文を一度クリック”相当：本文→件名→送信ボタン の順でフォーカス移動
    const focusOrder = [
        '[aria-label*="本文"]',
        '[aria-label*="Message body"]',
        'div[role="textbox"][g_editable="true"]',
        'input[name="subjectbox"]',
        '[aria-label*="件名"]',
        '[aria-label*="Subject"]',
        SELECTORS.send,
    ];
    for (const sel of focusOrder) {
        const el = root.querySelector(sel) || document.querySelector(sel);
        if (el && typeof el.focus === 'function') {
            try {
                el.focus();
            } catch (e) {}
            break;
        }
    }

    // 3) クリック相当（保険）
    const bodyLike =
        root.querySelector('[aria-label*="本文"], [aria-label*="Message body"], div[role="textbox"][g_editable="true"]') ||
        document.activeElement;
    if (bodyLike) {
        try {
            bodyLike.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                view: window
            }));
            bodyLike.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                view: window
            }));
            bodyLike.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            }));
        } catch (e) {}
    }
}

async function getStableRecipients(root, { minStableFrames = 2, maxWaitMs = 350 } = {}) {
  const start = performance.now();
  let last = null;
  let stable = 0;

  while (true) {
    // DOM確定を待つ（rAF×2 + 50ms 保険は settleDom に委ねる）
    await settleDom();

    const nowList = arr.uniqLower(collectRecipients(root)).sort();
    const key = nowList.join(",");

    if (last === key) {
      stable += 1;
      if (stable >= minStableFrames) return nowList;
    } else {
      last = key;
      stable = 1;
    }

    if (performance.now() - start > maxWaitMs) {
      // タイムアウトでも最新を返す（実用上これで十分）
      return nowList;
    }
  }
}

/******************************
 * アドレス判定
 ******************************/
function normalizeAddress(addr) {
    const s = str.toLower(addr);
    const m = ADDRESS_RE.exec(s);
    return m ? m[1] : null;
}

function isInternalDomain(domain) {
    return INTERNAL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function isExternal(email) {
    const m = /@([^>\s]+)$/.exec(email);
    if (!m) return true;
    return !isInternalDomain(m[1].replace(/[>\s]/g, ""));
}

function isCompanyAll(email) {
    const norm = normalizeAddress(email);
    return !!norm && norm === COMPANY_ALL_ADDRESS;
}

/******************************
 * 宛先収集（統一）
 ******************************/
function collectRecipients(scope) {
    try {
        const emails = new Set();

        const pushFromText = (s) =>
            String(s || "")
            .split(SPLIT_RE)
            .forEach((x) => {
                const m = x.match(EMAIL_RE);
                if (m) emails.add(m[0].toLowerCase());
            });

        const q = (sel) => by.qs(scope, sel);
        const qa = (sel) => by.qsa(scope, sel);

        // 入力欄
        const to = q('textarea[name="to"]');
        const cc = q('textarea[name="cc"]');
        const bcc = q('textarea[name="bcc"]');
        if (to?.value) pushFromText(to.value);
        if (cc?.value) pushFromText(cc.value);
        if (bcc?.value) pushFromText(bcc.value);

        // 受信者チップ
        qa('[data-hovercard-id*="@"]').forEach((el) => {
            const v = el.getAttribute("data-hovercard-id");
            if (v && EMAIL_RE.test(v)) emails.add(v.toLowerCase());
        });

        // mailto
        qa('a[href^="mailto:"]').forEach((a) => {
            const href = a.getAttribute("href") || "";
            const addr = decodeURIComponent(href.replace(/^mailto:/i, "").split("?")[0]);
            if (EMAIL_RE.test(addr)) emails.add(addr.toLowerCase());
        });

        // ラベル近辺
        qa('[aria-label*="宛先"], [aria-label*="To"], [aria-label*="Cc"], [aria-label*="Bcc"]').forEach((c) =>
            pushFromText(c.textContent || "")
        );

        return Array.from(emails);
    } catch (e) {
        console.warn("GESC: collectRecipients error", e);
        return [];
    }
}

/******************************
 * モーダル（チェックリスト式・全選択なし）
 ******************************/
function showChecklistModal({
    externals = [],
    allHands = []
}) {
    return new Promise((resolve) => {
        // 既存UI掃除
        document.getElementById("gesc-overlay")?.remove();
        document.getElementById("gesc-style")?.remove();

        // スタイル
        const style = document.createElement("style");
        style.id = "gesc-style";
        // NOTE: テンプレートリテラル内の改行とインデントを整理
        style.textContent = `#gesc-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    background: rgba(0,0,0,0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans JP", sans-serif;
}
#gesc-modal {
    background: #fff;
    color: #111;
    width: 560px;
    max-width: 92vw;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    padding: 20px 20px 16px;
}
#gesc-title {
    font-size: 16px;
    font-weight: 700;
    margin: 0 0 12px;
}
.gesc-note {
    font-size: 13px;
    color: #444;
    margin: 6px 0 10px;
}
.gesc-section-title {
    font-size: 13px;
    font-weight: 700;
    margin: 10px 0 6px;
}
.gesc-list {
    background: #f7f7f7;
    border-radius: 8px;
    padding: 10px;
    margin: 0 0 12px;
    max-height: 200px;
    overflow: auto;
    font-size: 13px;
}
.gesc-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px;
}
.gesc-email {
    word-break: break-all;
}
#gesc-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    align-items: center;
}
#gesc-remaining {
    margin-right: auto;
    font-size: 12px;
    color: #555;
}
.gesc-btn {
    border: 1px solid #d0d0d0;
    background: #fff;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 13px;
    cursor: pointer;
}
.gesc-btn.primary {
    background: #1a73e8;
    border-color: #1a73e8;
    color: #fff;
}
.gesc-btn[disabled] {
    opacity: 0.6;
    cursor: not-allowed;
}`;
        document.documentElement.appendChild(style);

        const ext = arr.uniqLower(externals);
        const all = arr.uniqLower(allHands);

        // ルート
        const overlay = document.createElement("div");
        overlay.id = "gesc-overlay";
        const modal = document.createElement("div");
        modal.id = "gesc-modal";
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-labelledby", "gesc-title");
        modal.tabIndex = -1;

        // タイトル・先頭文言
        const title = document.createElement("h2");
        title.id = "gesc-title";
        const noteTop = document.createElement("div");
        noteTop.className = "gesc-note";

        if (ext.length > 0 && all.length > 0) {
            title.textContent = "社外宛先・Workty-allを検出しました。送信してよろしいですか？";
            noteTop.append(
                document.createTextNode("次の宛先は "),
                (() => {
                    const b = document.createElement("b");
                    b.textContent = "組織外ドメイン";
                    return b;
                })(),
                document.createTextNode(" です。各宛先の確認チェックを入れてください。")
            );
        } else if (all.length > 0) {
            title.textContent = "Workty-allを検出しました。送信してよろしいですか？";
            noteTop.textContent = "社内全員に送信されます。よろしければ確認チェックを入れてください。";
        } else {
            title.textContent = "社外宛先を検出しました。送信してよろしいですか？";
            noteTop.append(
                document.createTextNode("次の宛先は "),
                (() => {
                    const b = document.createElement("b");
                    b.textContent = "組織外ドメイン";
                    return b;
                })(),
                document.createTextNode(" です。各宛先の確認チェックを入れてください。")
            );
        }

        modal.append(title, noteTop);

        const checkboxes = [];

        const appendList = (addresses) => {
            const list = document.createElement("div");
            list.className = "gesc-list";
            addresses.forEach((addr, i) => {
                const row = document.createElement("label");
                row.className = "gesc-row";
                const cb = document.createElement("input");
                cb.type = "checkbox";
                // NOTE: テンプレートリテラルを使用
                cb.id = `gesc-${i}-${Math.random().toString(36).slice(2, 7)}`;
                cb.setAttribute("data-email", addr);
                const span = document.createElement("span");
                span.className = "gesc-email";
                span.textContent = addr;
                row.append(cb, span);
                list.appendChild(row);
                checkboxes.push(cb);
            });
            modal.append(list);
        };

        // 社外
        if (ext.length > 0) appendList(ext);

        // 社内全員（Workty-all）
        if (all.length > 0) {
            if (ext.length > 0) {
                const noteAll = document.createElement("div");
                noteAll.className = "gesc-note";
                noteAll.textContent = "社内全員に送信されます。よろしければ確認チェックを入れてください。";
                modal.append(noteAll);
            }
            appendList(all);
        }

        // フッター
        const actions = document.createElement("div");
        actions.id = "gesc-actions";
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

        modal.append(actions);
        overlay.appendChild(modal);
        document.documentElement.appendChild(overlay);
        modal.focus();

        // 有効化：全チェック必須
        const updateState = () => {
            const total = checkboxes.length;
            const checked = checkboxes.filter((c) => c.checked).length;
            const left = total - checked;
            // NOTE: テンプレートリテラルを使用
            ok.disabled = left > 0;
            remaining.textContent = left > 0 ? `未チェック: ${left} 件` : "すべて確認済みです";
        };
        checkboxes.forEach((c) => c.addEventListener("change", updateState));
        updateState();

        // キーボード
        overlay.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                cancel.click();
            } else if (e.key === "Enter" && !ok.disabled) {
                e.preventDefault();
                ok.click();
            }
        });

        // 後片付け
        const cleanup = () => {
            overlay.remove();
            style.remove();
        };
        cancel.addEventListener("click", () => {
            cleanup();
            resolve(false);
        });
        ok.addEventListener("click", () => {
            if (ok.disabled) return;
            cleanup();
            resolve(true);
        });
    });
}

/******************************
 * 送信前フック（共通処理を一本化）
 ******************************/
let bypassOnce = false;
let sendGuardOpen = false;

async function interceptAndConfirm(triggerEl) {
    if (bypassOnce) return true;

    const root = dom.nearestComposeRoot(triggerEl) || document;
    commitRecipientInputs(root);

    const recipients = await getStableRecipients(root);
    const externals = recipients.filter(isExternal);
    const allHands = recipients.filter(isCompanyAll);

    if (externals.length === 0 && allHands.length === 0) return true;

    const ok = await showChecklistModal({
        externals,
        allHands
    });
    if (!ok) return false;

    // ★ 送信許可ウィンドウを短時間だけ開く
    sendGuardOpen = true;
    bypassOnce = true;
    setTimeout(() => {
        sendGuardOpen = false;
        bypassOnce = false;
    }, 800);

    return true;
}

// ★ ドキュメント全体の submit を捕捉して、許可中以外は止める
document.addEventListener(
    "submit",
    (e) => {
        if (sendGuardOpen) return; // 許可ウィンドウ中は通す
        e.preventDefault();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        e.stopPropagation();
    },
    true // capture
);

/******************************
 * バインド
 ******************************/
function bindSendButtons() {
    document.querySelectorAll(SELECTORS.send).forEach((btn) => {
        if (btn.__gescBound) return;
        btn.__gescBound = true;

        const handler = async (e) => {
            if (bypassOnce) return;
            // ★ 必ず最初にキャンセル（既定動作＆他のリスナーも止める）
            e.preventDefault();
            if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
            e.stopPropagation();

            const allowed = await interceptAndConfirm(btn);
            if (!allowed) return; // モーダルでキャンセル

            // 自前クリックで再度このハンドラが走らないよう一時的に素通り
            if (!bypassOnce) {
                bypassOnce = true;
                setTimeout(() => (bypassOnce = false), 800);
            }
            btn.click();

        };

        // ★ mousedown と click の両方を capture でフック
        btn.addEventListener("mousedown", handler, true);
        btn.addEventListener("click", handler, true);
    });
}

// 初期＆動的監視
const mo = new MutationObserver(bindSendButtons);
mo.observe(document.documentElement, {
    subtree: true,
    childList: true
});
bindSendButtons();

/******************************
 * キーボード送信（Ctrl/Cmd+Enter）
 ******************************/
document.addEventListener(
    "keydown",
    async (e) => {
        const isSubmitShortcut = e.key === "Enter" && (e.ctrlKey || e.metaKey);
        if (!isSubmitShortcut) return;

        // ★ まずキャンセル（既定動作＆他のハンドラを完封）
        e.preventDefault();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        e.stopPropagation();

        const allowed = await interceptAndConfirm(document.activeElement);
        if (!allowed) return;

        const root = dom.nearestComposeRoot(document.activeElement) || document;
        const btn = dom.findSendButton(root) || dom.findAnySendButton();
        if (btn) {
            if (!bypassOnce) {
                bypassOnce = true;
                setTimeout(() => (bypassOnce = false), 800);
            }
            btn.click();
        }
    },
    true // capture
);

