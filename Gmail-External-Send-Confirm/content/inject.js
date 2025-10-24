// Inject page script into Gmail's page context.
(function inject() {
  try {
    // Avoid double injection when Gmail updates the view dynamically.
    const FLAG_ATTR = "data-gesc-injected";
    const root = document.documentElement;
    if (root.hasAttribute(FLAG_ATTR)) return;
    root.setAttribute(FLAG_ATTR, "1");

    const addScript = (attrs) => {
      const s = document.createElement("script");
      Object.entries(attrs).forEach(([k, v]) => (s[k] = v));
      (document.head || document.documentElement).appendChild(s);
      s.onload = () => s.remove();
    };

    // Load only our main page script (DOM フック版)
    addScript({ src: chrome.runtime.getURL("page/page.js") });
  } catch (e) {
    // Swallow to avoid breaking Gmail
    console.warn("GESC inject error", e);
  }
})();
