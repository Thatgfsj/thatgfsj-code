# Thatgfsj Code

<p align="center">
  <img src="https://img.shields.io/badge/Version-0.1.0-blue?style=for-the-badge" alt="Badge">
  <img src="https://img.shields.io/badge/Node.js-18+-green?style=for-the-badge&logo=node.js" alt="Badge">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="Badge">
</p>

<p align="center">
  Your AI Coding Assistant - A CLI tool powered by AI
</p>

---

## Overview

**Thatgfsj Code** is an AI-powered CLI tool for developers. It combines natural language processing with file operations and shell command execution to help you code faster.

### Features

- 🤖 **AI Chat** - Natural language interaction
- 📁 **File Operations** - Read, write, list, delete files
- 🔧 **Shell Commands** - Execute system commands safely
- 💬 **Interactive Mode** - Continuous conversation
- 🔄 **Streaming Support** - Real-time AI responses

---

## Quick Start

### Installation

```bash
# Clone and install
git clone https://github.com/Thatgfsj/thatgfsj-code.git
cd thatgfsj-code
npm install
npm run build

# Link globally
npm link
```

### Usage

```bash
# Show help
thatgfsj --help

# Start interactive chat
thatgfsj chat

# Execute single prompt
thatgfsj exec "Hello, write a hello world in Python"

# Initialize config
thatgfsj init

# Show config
thatgfsj config
```

---

## Commands

| Command | Description |
|---------|-------------|
| `thatgfsj` | Show version info |
| `thatgfsj chat` | Start interactive mode |
| `thatgfsj exec <prompt>` | Execute single prompt |
| `thatgfsj init` | Initialize configuration |
| `thatgfsj config` | Show current configuration |

---

## Configuration

### Environment Variables

```bash
# Set API key
export OPENAI_API_KEY=your_key
# or
export MINIMAX_API_KEY=your_key
```

### Config File

Created at `~/.thatgfsj/config.json`:

```json
{
  "model": "minimax/MiniMax-M2.5",
  "apiKey": "",
  "temperature": 0.7,
  "maxTokens": 4096
}
```

---

## Architecture

```
┌─────────────────────────────────────────┐
│              CLI Layer                   │
│   (Commander, Chalk, Ora)               │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│              Core Layer                  │
│  ┌─────────────┐ ┌─────────────────┐    │
│  │ AI Engine   │ │ Session Manager │    │
│  └─────────────┘ └─────────────────┘    │
│  ┌─────────────┐ ┌─────────────────┐    │
│  │Tool Registry│ │ Config Manager  │    │
│  └─────────────┘ └─────────────────┘    │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│              Tools Layer                 │
│   File Tool  │  Shell Tool  │  ...     │
└─────────────────────────────────────────┘
```

---

## Development

```bash
# Build
npm run build

# Dev mode
npm run dev

# Link for testing
npm link
```

---

## License

MIT License - See [LICENSE](./LICENSE) for details.

---

## Contributing

Contributions are welcome! Please submit issues and pull requests.
