# AI Chrome Autocomplete Extension

A Chrome Extension (Manifest V3) that shows inline ghost-text suggestions while you type in any text field on any website — similar to how Cursor works for code. Accept suggestions with `Tab`.

## Features

- **Inline ghost-text** completions that appear as you type
- **Tab to accept** completions quickly
- **Works on most websites** — textarea, input fields, and contenteditable (Gmail, Notion, etc.)
- **Smart positioning** — ghost text follows your cursor exactly, matching font and size
- **Dark/light aware** — ghost text color adapts to the field's background
- **Anti-repeat filter** — suppresses low-quality or repetitive completions
- **Multiple AI providers** supported

## Providers

| Provider | Cost | Speed | Setup |
|----------|------|-------|-------|
| Mock | Free | Instant | None |
| Groq | Free tier available | Very fast | API key from console.groq.com |
| OpenAI | Paid | Fast | API key from platform.openai.com |
| Local Ollama | Free | Depends on hardware | Install ollama.com |

## Quick Start

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Click **Extension options** to configure your provider

## Provider Setup

### Groq (Recommended)
- Provider: `Cloud API (OpenAI-compatible)`
- Endpoint: `https://api.groq.com/openai/v1/chat/completions`
- Model: `llama-3.1-8b-instant`
- API Key: get one free at [console.groq.com](https://console.groq.com)

### OpenAI
- Provider: `Cloud API (OpenAI-compatible)`
- Endpoint: `https://api.openai.com/v1/chat/completions`
- Model: `gpt-4o-mini`
- API Key: requires a paid account at [platform.openai.com](https://platform.openai.com)


### Local Ollama
- Install Ollama from [ollama.com](https://ollama.com)
- Run: `ollama pull llama3.2`
- Provider: `Local Ollama`
- Endpoint: `http://localhost:11434/api/generate`
- Model: `llama3.2:latest`

### Mock (Demo)
- No setup needed — works instantly with heuristic completions
- Good for testing the UI and ghost-text positioning

## Usage

1. Click any text field on any website
2. Start typing — a grey suggestion appears inline after ~160ms
3. `Tab` → accept full suggestion
4. `Esc` or arrow keys → dismiss

## Known Limitations

- `file://` pages require enabling **Allow access to file URLs** in Chrome extension settings
- For local testing, use `python -m http.server 8080` and open `http://localhost:8080/your-file.html`
- Gmail and rich-text editors use `contenteditable` — supported but positioning may vary slightly

## Security

- API keys are stored in `chrome.storage.local` only — never synced to the cloud
- No data is logged or stored — text is sent directly to your chosen provider

## Technical Skills

- JavaScript (ES6+) for extension logic, event handling, and async messaging
- Chrome Extensions API (Manifest V3): `content_scripts`, `service_worker`, and `chrome.runtime`
- DOM APIs for caret tracking, text selection, focus handling, and contenteditable support
- Prompt engineering and response post-processing for inline AI completions
- REST API integration with OpenAI-compatible providers (OpenAI, Groq, Ollama-compatible flows)
- State and configuration management with `chrome.storage.sync` and `chrome.storage.local`
- UI/UX implementation with HTML/CSS (options page, ghost-text overlay, and responsive demo page)
