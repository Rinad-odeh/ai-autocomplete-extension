const DEFAULTS = {
  provider: "mock",
  endpoint: "http://localhost:11434/api/generate",
  model: "llama3.2:latest",
  apiKey: "",
  maxTokens: 56,
  temperature: 0.15,
  debounceMs: 160,
  strictAntiRepeat: true,
  enabled: true
};

const PROVIDER_INFO = {
  mock: "✦ Mock mode — instant demo, no API key needed. Suggestions are heuristic-based.",
  groq: "⚡ Groq — free and very fast! Get your API key from console.groq.com",
  openai_compatible: "☁ Cloud API — set your endpoint and paste an API key. Compatible with OpenAI, Mistral, Together, and more.",
  ollama: "⬡ Local Ollama — run models on your machine. Start Ollama then pick a model name."
};

const PROVIDER_DEFAULTS = {
  groq: {
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.1-8b-instant"
  },
  openai_compatible: {
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini"
  },
  ollama: {
    endpoint: "http://localhost:11434/api/generate",
    model: "llama3.2:latest"
  }
};

const els = {
  enabled:          document.getElementById("enabled"),
  provider:         document.getElementById("provider"),
  endpoint:         document.getElementById("endpoint"),
  model:            document.getElementById("model"),
  apiKey:           document.getElementById("apiKey"),
  maxTokens:        document.getElementById("maxTokens"),
  temperature:      document.getElementById("temperature"),
  debounceMs:       document.getElementById("debounceMs"),
  strictAntiRepeat: document.getElementById("strictAntiRepeat"),
  saveBtn:          document.getElementById("saveBtn"),
  status:           document.getElementById("status"),
  statusDot:        document.getElementById("statusDot"),
  statusText:       document.getElementById("statusText"),
  providerInfo:     document.getElementById("providerInfo"),
  endpointRow:      document.getElementById("endpointRow"),
  modelRow:         document.getElementById("modelRow"),
  apiKeyRow:        document.getElementById("apiKeyRow"),
};

restore();
els.saveBtn.addEventListener("click", save);
els.provider.addEventListener("change", onProviderChange);
els.enabled.addEventListener("change", updateEnabledUI);

async function restore() {
  const syncKeys = Object.keys(DEFAULTS).filter(k => k !== "apiKey");
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(syncKeys),
    chrome.storage.local.get(["apiKey"])
  ]);
  const cfg = { ...DEFAULTS, ...sync, ...local };

  els.enabled.checked          = cfg.enabled;
  els.provider.value           = cfg.provider;
  els.endpoint.value           = cfg.endpoint;
  els.model.value              = cfg.model;
  els.apiKey.value             = cfg.apiKey || "";
  els.maxTokens.value          = cfg.maxTokens;
  els.temperature.value        = cfg.temperature;
  els.debounceMs.value         = cfg.debounceMs;
  els.strictAntiRepeat.checked = cfg.strictAntiRepeat !== false;

  updateProviderUI();
  updateEnabledUI();
}

async function save() {
  const cfg = {
    enabled:          els.enabled.checked,
    provider:         els.provider.value  || DEFAULTS.provider,
    endpoint:         els.endpoint.value.trim() || DEFAULTS.endpoint,
    model:            els.model.value.trim()    || DEFAULTS.model,
    maxTokens:        clampInt(els.maxTokens.value,    8,  256, DEFAULTS.maxTokens),
    temperature:      clampFloat(els.temperature.value, 0,   2,  DEFAULTS.temperature),
    debounceMs:       clampInt(els.debounceMs.value,   20, 2000, DEFAULTS.debounceMs),
    strictAntiRepeat: els.strictAntiRepeat.checked
  };
  const apiKey = els.apiKey.value.trim();

  await chrome.storage.sync.set(cfg);
  await chrome.storage.local.set({ apiKey });

  els.status.classList.add("visible");
  setTimeout(() => els.status.classList.remove("visible"), 1800);
}


function updateProviderUI() {
  const p = els.provider.value;
  els.providerInfo.textContent = PROVIDER_INFO[p] || "";
  els.providerInfo.classList.toggle("visible", true);
  const isMock = p === "mock";
  els.endpointRow.style.display = isMock ? "none" : "flex";
  els.modelRow.style.display    = isMock ? "none" : "flex";
  els.apiKeyRow.style.display   = (p === "openai_compatible" || p === "groq") ? "flex" : "none";
}


function onProviderChange() {
  updateProviderUI();
  const p = els.provider.value;
  const defs = PROVIDER_DEFAULTS[p];
  if (defs) {
    els.endpoint.value = defs.endpoint;
    els.model.value    = defs.model;
  }
}

function updateEnabledUI() {
  const on = els.enabled.checked;
  els.statusDot.classList.toggle("active", on);
  els.statusText.textContent = on ? "Autocomplete enabled" : "Autocomplete disabled";
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function clampFloat(v, min, max, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

