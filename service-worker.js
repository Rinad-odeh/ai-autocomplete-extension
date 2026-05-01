const DEFAULT_SETTINGS = {
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

chrome.runtime.onInstalled.addListener(async () => {
  const syncKeys = Object.keys(DEFAULT_SETTINGS).filter(k => k !== "apiKey");
  const existing = await chrome.storage.sync.get(syncKeys);
  const next = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (key === "apiKey") continue;
    if (existing[key] === undefined) next[key] = value;
  }
  if (Object.keys(next).length) await chrome.storage.sync.set(next);
});


async function getSettings() {
  const syncKeys = Object.keys(DEFAULT_SETTINGS).filter(k => k !== "apiKey");
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(syncKeys),
    chrome.storage.local.get(["apiKey"])
  ]);
  return { ...DEFAULT_SETTINGS, ...sync, ...local };
}


function buildPrompt({ beforeCursor, selectedText, afterCursor }) {

  const before = (beforeCursor || "").slice(-800);
  const after  = (afterCursor  || "").slice(0, 200);

  const lines = [
    "You are a fast, precise inline writing autocomplete assistant.",
    "Your task: output ONLY the natural continuation of the text, nothing else.",
    "",
    "Rules:",
    "- Output raw continuation text only. No markdown, no quotes, no explanations.",
    "- Do NOT repeat any text that already exists before or after the cursor.",
    "- Match the writing style, tone, and language of the existing text.",
    "- Keep it concise: 5 to 15 words is ideal.",
    "- If the text ends mid-sentence, continue the sentence naturally.",
    "- If the text ends with a period/punctuation, start a new sentence.",
    "- NEVER output placeholder text like '[…]' or '...'.",
    "",
  ];

  if (selectedText) {
    lines.push(`Selected text (will be replaced): """${selectedText}"""`);
  }
  if (after) {
    lines.push(`Text after cursor (do not repeat): """${after}"""`);
  }
  lines.push(`Text before cursor:`);
  lines.push(`"""${before}"""`);
  lines.push(``, `Continue:`);

  return lines.join("\n");
}


function cleanCompletion(raw, beforeCursor) {
  if (!raw) return "";
  let out = String(raw).replace(/\r/g, "");

  // Strip markdown artifacts
  out = out.replace(/^```[\s\S]*?```/g, "").trimStart();
  out = out.replace(/^`([^`]*)`$/, "$1");

  if (!out) return "";

  out = removeLeadingOverlap(beforeCursor, out);
  out = removeDuplicateStartWord(beforeCursor, out);
  out = collapseRepeatedWords(out);
  out = collapseRepeatedPhrases(out);
  out = clipCompletionLength(out);
  out = out.trimStart();

  return out;
}

function removeDuplicateStartWord(beforeCursor, completion) {
  const lastWord  = (beforeCursor || "").toLowerCase().match(/([\p{L}\p{N}_'-]+)\s*$/u);
  const firstWord = (completion   || "").toLowerCase().match(/^\s*([\p{L}\p{N}_'-]+)/u);
  if (!lastWord || !firstWord || lastWord[1] !== firstWord[1]) return completion;
  return completion.replace(/^\s*[\p{L}\p{N}_'-]+\s*/u, "");
}

function clipCompletionLength(text) {
  if (!text) return "";
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 16).join(" ").slice(0, 140);
}

function hasStrictRepetition(text) {
  const words = text.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;

  for (let i = 1; i < words.length; i++) {
    if (words[i] === words[i - 1]) return true;
  }
  for (let size = 2; size <= 4; size++) {
    for (let i = 0; i + size * 2 <= words.length; i++) {
      if (words.slice(i, i + size).join(" ") === words.slice(i + size, i + size * 2).join(" ")) return true;
    }
  }
  return false;
}

function hasLowQualityCompletion(text) {
  const words = text.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/).filter(Boolean);
  if (words.length < 5) return false;

  const uniqueRatio = new Set(words).size / words.length;
  if (words.length >= 8 && uniqueRatio < 0.5) return true;

  const bigrams = [];
  for (let i = 0; i < words.length - 1; i++) bigrams.push(`${words[i]} ${words[i + 1]}`);
  return bigrams.length >= 6 && new Set(bigrams).size / bigrams.length < 0.55;
}

function overlapsContextTail(beforeCursor, completion) {
  const tailWords = (beforeCursor || "").toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).slice(-5);
  const headWords = (completion   || "").toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 5);
  if (!tailWords.length || !headWords.length) return false;

  for (let size = Math.min(tailWords.length, headWords.length); size >= 1; size--) {
    if (tailWords.slice(-size).join(" ") === headWords.slice(0, size).join(" ")) return true;
  }
  return false;
}

function removeLeadingOverlap(beforeCursor, completion) {
  if (!beforeCursor || !completion) return completion || "";
  const maxLen = Math.min(200, beforeCursor.length, completion.length);
  for (let i = maxLen; i >= 6; i--) {
    if (completion.slice(0, i).toLowerCase() === beforeCursor.slice(-i).toLowerCase()) {
      return completion.slice(i);
    }
  }
  return completion;
}

function collapseRepeatedWords(text) {
  const parts = text.split(/(\s+)/);
  const result = [];
  for (const token of parts) {
    const prev = result[result.length - 1];
    if (prev && token.trim() && prev.trim() && token.toLowerCase() === prev.toLowerCase()) continue;
    result.push(token);
  }
  return result.join("");
}

function collapseRepeatedPhrases(text) {
  let out = text;
  for (let size = 4; size >= 2; size--) {
    const words = out.split(/\s+/);
    if (words.length < size * 2) continue;
    const normalized = [];
    for (let i = 0; i < words.length; i++) {
      if (i >= size && i + size <= words.length) {
        const prev = words.slice(i - size, i).join(" ").toLowerCase();
        const curr = words.slice(i, i + size).join(" ").toLowerCase();
        if (prev === curr) continue;
      }
      normalized.push(words[i]);
    }
    out = normalized.join(" ");
  }
  return out;
}


function heuristicCompletion(beforeCursor) {
  const trimmed = (beforeCursor || "").trimEnd();
  if (!trimmed) return "";

  // Try to complete a common pattern
  if (/\bmy name is\s*$/i.test(trimmed))  return "and I specialize in ";
  if (/\bi am\s*$/i.test(trimmed))        return "writing to inquire about ";
  if (/\bthe goal is\s*$/i.test(trimmed)) return "to improve the overall quality and ";
  if (/\bbecause\s*$/i.test(trimmed))     return "this approach leads to better results ";
  if (/\bin order to\s*$/i.test(trimmed)) return "achieve the best possible outcome, ";
  if (/[.!?]$/.test(trimmed))             return " This helps ensure clarity and precision.";
  if (/,$/.test(trimmed))                 return " which leads to better outcomes overall.";
  return " and this approach ensures a clear and practical result.";
}


async function fetchWithTimeout(url, options, ms = 14000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requestOllama(settings, prompt) {
  const body = {
    model: settings.model,
    prompt,
    stream: false,
    options: {
      temperature: Number(settings.temperature) || 0.15,
      num_predict: Number(settings.maxTokens) || 56,
      stop: ["\n\n", "User:", "Human:", "Assistant:"]
    }
  };
  const res = await fetchWithTimeout(settings.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Ollama (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json())?.response || "";
}

async function requestOpenAICompatible(settings, prompt) {
  if (!settings.apiKey) throw new Error("API key required for cloud provider.");
  const body = {
    model: settings.model,
    messages: [
      {
        role: "system",
        content: "You are an inline writing autocomplete assistant. Output ONLY the raw continuation text. No markdown. No explanation. No quotes."
      },
      { role: "user", content: prompt }
    ],
    max_tokens: Number(settings.maxTokens) || 56,
    temperature: Number(settings.temperature) || 0.15,
    frequency_penalty: 1.0,
    presence_penalty: 0.3,
    stop: ["\n\n"]
  };
  const res = await fetchWithTimeout(settings.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Cloud (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json())?.choices?.[0]?.message?.content || "";
}


chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "AI_COMPLETE") return;

  (async () => {
    const settings = await getSettings();

    if (!settings.enabled) {
      sendResponse({ ok: true, completion: "", disabled: true });
      return;
    }

    const payload = message.payload || {};
    const prompt = buildPrompt(payload);
    let rawCompletion = "";

    try {
      if (settings.provider === "mock") {
        rawCompletion = heuristicCompletion(payload.beforeCursor || "");
      } else if (settings.provider === "openai_compatible" || settings.provider === "groq") {
        rawCompletion = await requestOpenAICompatible(settings, prompt);
      } else {
        rawCompletion = await requestOllama(settings, prompt);
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
      return;
    }

    let completion = cleanCompletion(rawCompletion, payload.beforeCursor || "");

    if (settings.strictAntiRepeat) {
      if (
        hasStrictRepetition(completion) ||
        hasLowQualityCompletion(completion) ||
        overlapsContextTail(payload.beforeCursor || "", completion)
      ) {
        completion = "";
      }
    }

    sendResponse({ ok: true, completion });
  })();

  return true; // Keep message channel open for async response
});

