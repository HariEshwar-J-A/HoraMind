# HoraMind

By [Harieshwar Jagan Abirami](https://github.com/HariEshwar-J-A)

HoraMind is an AI-powered Telegram Agent for astrology, built on top of the generic OpenClaw framework. It routes user queries through Large Language Models (LLMs) to generate astrological insights, calculated precisely using the [`node-jhora`](https://github.com/HariEshwar-J-A/node-jhora) math engine, and supplemented with traditional wisdom from a BPHS (Brihat Parashara Hora Shastra) RAG database.

## Features

- **Telegram Bot Integration:** Interact with the astrology agent directly via Telegram.
- **Precision Calculations:** Uses the [`node-jhora`](https://github.com/HariEshwar-J-A/node-jhora) engine for multi-stage astrological math.
- **RAG-Powered Wisdom:** Consults Brihat Parashara Hora Shastra texts via a local Vector Database (ChromaDB) for authentic interpretations.
- **Configurable Agent:** Runs on the OpenClaw framework with fully customizable system prompts and preference matrices.
- **Rate Limiting:** Built-in tools manage query limits (e.g., 5 queries) per user interacting with the bot.

## Project Structure

- `agent_config/`: Contains the main system prompt (`preferences.md`) and the OpenClaw agent configuration (`openclaw_config.json`).
- `tools/`: Custom Node.js scripts executed by OpenClaw:
  - `calculate_chart.js`: Performs heavy lifting using the [`node-jhora`](https://github.com/HariEshwar-J-A/node-jhora) engine.
  - `query_bphs_rag.js`: Handles semantic search queries against the local RAG database.
  - `check_rate_limit.js`: Keeps track of and manages user quotas.
- `core/`: Intended directory for the [`node-jhora`](https://github.com/HariEshwar-J-A/node-jhora) code or git submodule.
- `users/`: Local, git-ignored directory storing user-specific data like `chart_data.json` and `karmic_blueprint.md`.

## Setup
1. Clone the repository.
2. Run `npm install` to install dependencies (e.g., OpenClaw, node-jhora).
3. Copy `.env.example` to `.env` and fill in your OpenRouter and Telegram API keys.
4. Run the bot using `npm start`.

## License

This project is licensed under the **PolyForm Noncommercial License 1.0.0**. It is free to use for personal projects, research, and other non-commercial purposes. 

**Any commercial use requires a separate paid agreement.**

Please see the [LICENSE](LICENSE) file for the complete terms and [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md) for further inquiries.

## 🌌 Other Related Projects

If you are building astrological tools, you should absolutely check out our other projects:

- [**JyotishBase**](https://github.com/HariEshwar-J-A/JyotishBase): A specialized Retrieval-Augmented Generation (RAG) database for Vedic Astrology. It contains structured classical texts like Brihat Parashara Hora Shastra (BPHS), enabling AI agents to provide authentic, text-backed astrological interpretations and wisdom.
- [**Node-Jhora**](https://github.com/HariEshwar-J-A/node-jhora): A highly accurate, modular, and open-source TypeScript calculation engine for Vedic Astrology. It provides robust calculations for planetary positions, Dasha systems, divisional charts (Vargas), Shadbala, and more, effectively acting as the mathematical backend for any Jyotish application.
