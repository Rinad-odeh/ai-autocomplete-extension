
const EDITABLE_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email", "password"]);
const MIN_CHARS_TO_TRIGGER = 3;


const state = {
  target: null,
  ghost: null,
  completion: "",
  requestSeq: 0,
  debounceTimer: null,
  lastContext: null,
  settings: { debounceMs: 160, enabled: true }
};


(function injectStyles() {
  const style = document.createElement("style");
  style.id = "local-ai-style";
  style.textContent = `
    .local-ai-ghost {
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      white-space: pre;
      opacity: 0.42;
      color: inherit;
      background: transparent;
      border: none;
      padding: 0;
      margin: 0;
      overflow: hidden;
      max-width: 600px;
      text-overflow: ellipsis;
      animation: local-ai-fade-in 0.12s ease;
    }
    @keyframes local-ai-fade-in {
      from { opacity: 0; transform: translateY(1px); }
      to   { opacity: 0.42; transform: translateY(0); }
    }
    .local-ai-ghost.local-ai-ghost--dark {
      color: #cbd5e1;
    }
    .local-ai-ghost.local-ai-ghost--light {
      color: #374151;
    }
  `;
  document.documentElement.appendChild(style);
})();

init();

async function init() {
  await refreshSettings();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && (changes.debounceMs || changes.enabled)) {
      refreshSettings();
    }
  });

  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("selectionchange", onSelectionChange, true);
  document.addEventListener("scroll", repositionGhost, true);
  document.addEventListener("click", onClick, true);
  window.addEventListener("resize", repositionGhost, true);
  window.addEventListener("scroll", repositionGhost, true);
}

async function refreshSettings() {
  const s = await chrome.storage.sync.get(["debounceMs", "enabled"]);
  state.settings.debounceMs = Number(s.debounceMs) || 160;
  state.settings.enabled = s.enabled !== false;
  if (!state.settings.enabled) clearGhost();
}


function isSupportedEditable(el) {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    const t = (el.type || "text").toLowerCase();
    return !el.readOnly && !el.disabled && EDITABLE_INPUT_TYPES.has(t);
  }
  return el.isContentEditable && el.getAttribute("contenteditable") !== "false";
}


function onFocusIn(e) {
  const el = e.target;
  if (isSupportedEditable(el)) {
    if (state.target !== el) {
      clearGhost();
      state.target = el;
    }
  }
}

function onFocusOut(e) {
  if (e.target === state.target) {
    clearGhost();
    state.target = null;
    state.lastContext = null;
  }
}

function onInput(e) {
  if (e.target !== state.target) return;
  clearGhost();
  scheduleSuggestion();
}

function onClick(e) {
  if (e.target !== state.target) return;
  clearGhost();
}

function onKeyUp(e) {

  if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "x")) {
    if (e.target === state.target) {
      clearGhost();
      scheduleSuggestion();
    }
  }
}

function onKeyDown(e) {
  if (e.target !== state.target) return;

  // Accept
  if (e.key === "Tab" && state.completion) {
    e.preventDefault();
    e.stopPropagation();
    applyCompletion();
    return;
  }

  
  if ((e.ctrlKey || e.metaKey) && e.key === "ArrowRight" && state.completion) {
    e.preventDefault();
    applyFirstWord();
    return;
  }


  const dismissKeys = new Set([
    "Escape", "ArrowLeft", "ArrowUp", "ArrowDown",
    "PageUp", "PageDown", "Home", "End"
  ]);
  if (dismissKeys.has(e.key)) {
    clearGhost();
    return;
  }

  if (e.key === "ArrowRight" && !e.ctrlKey && !e.metaKey) {
    clearGhost();
    return;
  }
}

function onSelectionChange() {
  if (!state.target || document.activeElement !== state.target) {
    if (state.ghost) clearGhost();
    return;
  }
  repositionGhost();
}


function scheduleSuggestion() {
  if (!state.settings.enabled || !state.target) return;
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    requestSuggestion().catch(() => clearGhost());
  }, state.settings.debounceMs);
}

async function requestSuggestion() {
  const el = state.target;
  if (!el || document.activeElement !== el) return;

  const context = getEditingContext(el);
  if (!context) return;

  const trimmedBefore = context.beforeCursor.trimEnd();
  if (trimmedBefore.length < MIN_CHARS_TO_TRIGGER) {
    clearGhost();
    return;
  }


  const contextKey = `${context.beforeCursor}|||${context.selectedText}`;
  if (contextKey === state.lastContext) return;
  state.lastContext = contextKey;

  const seq = ++state.requestSeq;

  const response = await safeSendMessage({ type: "AI_COMPLETE", payload: context });


  if (seq !== state.requestSeq) return;

  if (!response?.ok) {
    clearGhost();
    return;
  }

  const completion = normalizeForDisplay(context, response.completion || "");
  if (!completion) {
    clearGhost();
    return;
  }

  state.completion = completion;
  showGhost(el, completion);
}


function normalizeForDisplay(context, raw) {
  if (!raw) return "";
  let text = raw.replace(/\r/g, "");

  
  const isMultiLine =
    context._elType === "textarea" || context._elType === "contenteditable";
  if (!isMultiLine) {
    text = text.split("\n")[0];
  } else {

    text = text.split("\n").slice(0, 2).join("\n");
  }

  if (!text.trim()) return "";


  if (context.selectedText && text.startsWith(context.selectedText)) {
    text = text.slice(context.selectedText.length);
  }


  if (context.afterCursor) {
    const tail = context.afterCursor.slice(0, 30);
    if (text.endsWith(tail)) text = text.slice(0, -tail.length);
  }

  return text.trimEnd() || "";
}


function getEditingContext(el) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const value = el.value || "";
    return {
      beforeCursor: value.slice(0, start),
      selectedText: value.slice(start, end),
      afterCursor: value.slice(end),
      _elType: el instanceof HTMLTextAreaElement ? "textarea" : "input"
    };
  }

  if (el.isContentEditable) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return null;

    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);

    const post = range.cloneRange();
    post.selectNodeContents(el);
    post.setStart(range.endContainer, range.endOffset);

    return {
      beforeCursor: pre.toString(),
      selectedText: range.toString(),
      afterCursor: post.toString(),
      _elType: "contenteditable"
    };
  }

  return null;
}


function applyCompletion() {
  if (!state.target || !state.completion) return;
  insertText(state.target, state.completion);
  clearGhost();
}

function applyFirstWord() {
  if (!state.target || !state.completion) return;
  const words = state.completion.match(/^\S+(\s+)?/);
  if (!words) return;
  const word = words[0];
  insertText(state.target, word);
  state.completion = state.completion.slice(word.length);
  state.lastContext = null;
  if (state.completion.trim()) {
    showGhost(state.target, state.completion);
  } else {
    clearGhost();
  }
}

function insertText(el, text) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const value = el.value || "";
    el.value = value.slice(0, start) + text + value.slice(end);
    const cursor = start + text.length;
    el.setSelectionRange(cursor, cursor);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  } else if (el.isContentEditable) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    // Handle multi-line text in contenteditable
    const lines = text.split("\n");
    if (lines.length === 1) {
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
    } else {
      const frag = document.createDocumentFragment();
      lines.forEach((line, i) => {
        if (i > 0) frag.appendChild(document.createElement("br"));
        if (line) frag.appendChild(document.createTextNode(line));
      });
      const last = frag.lastChild;
      range.insertNode(frag);
      if (last) {
        range.setStartAfter(last);
        range.collapse(true);
      }
    }
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }
}


function ensureGhost() {
  if (!state.ghost || !document.body.contains(state.ghost)) {
    const div = document.createElement("div");
    div.className = "local-ai-ghost";
    div.setAttribute("aria-hidden", "true");
    document.body.appendChild(div);
    state.ghost = div;
  }
  return state.ghost;
}

function showGhost(el, text) {
  const ghost = ensureGhost();
  const pos = getCaretViewportPosition(el);
  if (!pos) { clearGhost(); return; }

  const cs = window.getComputedStyle(el);

 
  const bg = cs.backgroundColor;
  const isDark = isColorDark(bg);
  ghost.classList.toggle("local-ai-ghost--dark", isDark);
  ghost.classList.toggle("local-ai-ghost--light", !isDark);

  ghost.style.fontFamily = cs.fontFamily;
  ghost.style.fontSize = cs.fontSize;
  ghost.style.fontWeight = cs.fontWeight;
  ghost.style.fontStyle = cs.fontStyle;
  ghost.style.fontVariant = cs.fontVariant;
  ghost.style.letterSpacing = cs.letterSpacing;
  ghost.style.lineHeight = cs.lineHeight;
  ghost.style.textTransform = cs.textTransform;
  ghost.style.wordSpacing = cs.wordSpacing;

  ghost.style.left = `${pos.x}px`;
  ghost.style.top = `${pos.y}px`;
  ghost.textContent = text;
  ghost.style.display = "block";
}

function repositionGhost() {
  if (!state.ghost || !state.completion || !state.target) return;
  if (document.activeElement !== state.target) { clearGhost(); return; }
  showGhost(state.target, state.completion);
}

function clearGhost() {
  state.completion = "";
  state.lastContext = null;
  clearTimeout(state.debounceTimer);
  if (state.ghost) state.ghost.style.display = "none";
}


function getCaretViewportPosition(el) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return getCaretForInputLike(el);
  }
  if (el.isContentEditable) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
   
    const rects = range.getClientRects();
    if (rects.length > 0) {
      const r = rects[0];
      return { x: r.left, y: r.top };
    }
    
    const span = document.createElement("span");
    span.appendChild(document.createTextNode("\u200b"));
    range.insertNode(span);
    const rect = span.getBoundingClientRect();
    span.parentNode.removeChild(span);
  
    el.normalize();
    return { x: rect.left, y: rect.top };
  }
  return null;
}

function getCaretForInputLike(el) {
  const cs = window.getComputedStyle(el);
  const mirror = document.createElement("div");

  const copyProps = [
    "boxSizing", "width", "height",
    "overflowX", "overflowY",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "fontFamily", "fontSize", "fontStyle", "fontVariant", "fontWeight",
    "fontStretch", "lineHeight", "letterSpacing", "wordSpacing",
    "textTransform", "textAlign", "textIndent", "tabSize",
    "whiteSpace"
  ];

  copyProps.forEach(p => { mirror.style[p] = cs[p]; });

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "-9999px";
  mirror.style.left = "-9999px";
 
  if (el instanceof HTMLTextAreaElement) {
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.height = cs.height; 
    mirror.style.overflowY = "scroll";
  } else {
    mirror.style.whiteSpace = "pre";
    mirror.style.overflowX = "hidden";
    mirror.style.width = cs.width;
  }

  const cursorPos = el.selectionStart ?? 0;
  const textBefore = el.value.slice(0, cursorPos);

  mirror.textContent = textBefore;
  const span = document.createElement("span");
  span.textContent = "\u200b"; 
  mirror.appendChild(span);

  document.body.appendChild(mirror);

  const inputRect = el.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();

  // For textarea, account for scroll
  const scrollTop = el instanceof HTMLTextAreaElement ? el.scrollTop : 0;
  const scrollLeft = el.scrollLeft || 0;

  const x = inputRect.left + (spanRect.left - mirrorRect.left) - scrollLeft;
  const y = inputRect.top + (spanRect.top - mirrorRect.top) - scrollTop;

  mirror.remove();

  
  const elLeft = inputRect.left;
  const elRight = inputRect.right - 4;
  const elTop = inputRect.top;
  const elBottom = inputRect.bottom - parseInt(cs.fontSize, 10);

  if (x < elLeft || x > elRight || y < elTop || y > elBottom) return null;
  return { x, y };
}


function isColorDark(color) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    // Perceived luminance
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
  } catch (_) {
    return false;
  }
}

async function safeSendMessage(message) {
  try {
    if (!chrome?.runtime?.id) return null;
  } catch (_) { return null; }

  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(response || null);
      });
    } catch (_) { resolve(null); }
  });
}

