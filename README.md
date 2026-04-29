# Obsidian Mistral Assistant

An Obsidian plugin that integrates Mistral AI models into your vault, allowing you to chat with your notes using Retrieval-Augmented Generation (RAG) or use Mistral's chat models directly.

## Features

- **Chat with Mistral Models**: Direct integration with Mistral AI's API
- **RAG Support**: Search and retrieve relevant information from your notes
- **Multiple Models**: Support for various Mistral models (mistral-tiny, mistral-small, mixtral-8x7b, etc.)
- **Embedding Support**: Use Mistral's embedding models for vector search
- **Chat Interface**: Clean, modern chat UI with message history
- **Streaming Responses**: Real-time streaming of AI responses
- **Customizable Settings**: Configure API keys, models, temperature, and RAG parameters

## Installation

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/your-username/obsidian-mistral-assistant.git
   cd obsidian-mistral-assistant
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

4. Copy the `main.js`, `styles.css`, and `manifest.json` files to your Obsidian vault's plugins folder:
   ```
   .obsidian/plugins/obsidian-mistral-assistant/
   ```

5. Enable the plugin in Obsidian's Settings → Community plugins

### Manual Installation

1. Download the latest release from GitHub
2. Extract the files to your vault's plugins folder
3. Enable the plugin in Obsidian

## Usage

### Setting Up API Access

1. Get your Mistral API key from [console.mistral.ai](https://console.mistral.ai/)
2. Open Obsidian Settings → Mistral Assistant
3. Enter your API key
4. (Optional) Set a custom base URL if you're using a self-hosted instance
5. Click "Test Connection" to verify your API key works
6. Click "Fetch Models" to load available models
7. Save your settings

### Using the Chat

- **Open Chat**: Click the ribbon icon or use the command palette (Ctrl/Cmd + P) and search for "Open Mistral Chat"
- **Send Message**: Type your question and press Enter or click Send
- **Index Notes**: Click "Index Notes" to re-index your vault for RAG
- **Enable RAG**: In settings, enable RAG to search your notes for answers

### Available Models

The plugin supports these Mistral models:
- Chat: `mistral-tiny`, `mistral-small`, `mistral-medium`, `mistral-large`, `mixtral-8x7b`, `mixtral-8x22b`
- Embeddings: `mistral-embed`, `mistral-embedding`

## Configuration

### Settings Options

| Setting | Description | Default |
|---------|-------------|---------|
| API Key | Your Mistral AI API key | - |
| Base URL | API endpoint (optional) | https://api.mistral.ai |
| Chat Model | Model for chat completion | mistral-tiny |
| Embedding Model | Model for embeddings | mistral-embed |
| Temperature | Creativity level (0-2) | 0.7 |
| Enable RAG | Search notes for answers | true |
| Chunk Size | Document chunk size (tokens) | 1000 |
| Chunk Overlap | Token overlap between chunks | 200 |

## Architecture

This plugin follows the Smart2Brain architecture pattern with:

- **Provider System**: Modular design for different AI providers (currently only Mistral)
- **RAG Pipeline**: Document indexing → Vector storage → Similarity search → Answer generation
- **Type Safety**: Full TypeScript support with Zod validation for settings

### Key Files

- `src/main.ts` - Main plugin class with all core functionality
- `src/providers/mistral.ts` - Mistral AI provider implementation
- `src/providers/index.ts` - Provider registry
- `src/views/ChatView.ts` - Chat interface
- `src/views/SettingsTab.ts` - Settings UI
- `src/settings.ts` - Settings schema and validation

## Development

### Project Structure

```
obsidian-mistral-assistant/
├── src/
│   ├── main.ts              # Plugin main class
│   ├── settings.ts          # Settings schema
│   ├── providers/
│   │   ├── index.ts         # Provider registry
│   │   └── mistral.ts       # Mistral provider
│   ├── types/
│   │   └── provider/        # Provider type definitions
│   └── views/
│       ├── ChatView.ts      # Chat interface
│       └── SettingsTab.ts   # Settings UI
├── styles.css              # Plugin styles
├── manifest.json            # Plugin metadata
├── package.json            # Dependencies
├── tsconfig.json           # TypeScript config
└── vite.config.ts          # Vite build config
```

### Building

```bash
# Development build (watches for changes)
npm run dev

# Production build
npm run build

# Type checking
npm run check

# Format code
npm run format
```

## Compatibility

- **Obsidian**: >= 1.5.0
- **Platform**: Desktop (may work on mobile with limitations)

## License

MIT

## Credits

This plugin is inspired by [Smart2Brain](https://github.com/your-papa/obsidian-Smart2Brain) and uses similar architectural patterns.

## Support

If you encounter any issues or have feature requests, please open an issue on GitHub.
