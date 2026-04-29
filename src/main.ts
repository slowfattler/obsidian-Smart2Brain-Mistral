import { Plugin, WorkspaceLeaf, TFile, Notice, requestUrl } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { mistralProvider, SimpleVectorStore, PersistentVectorStore, splitTextIntoChunks, EmbeddingModel } from "./providers/mistral";
import type { BaseProviderDefinition } from "./providers/index";
import { DEFAULT_SETTINGS, validateSettings, type MistralAssistantSettings } from "./settings";
import { ChatView, VIEW_TYPE_CHAT } from "./views/ChatView";
import { SettingsTab } from "./views/SettingsTab";

/**
 * Document type for RAG
 */
interface RAGDocument {
	pageContent: string;
	metadata: Record<string, unknown>;
}

/**
 * Main plugin class
 */
export default class MistralAssistantPlugin extends Plugin {
	settings: MistralAssistantSettings = DEFAULT_SETTINGS;
	vectorStore: SimpleVectorStore | PersistentVectorStore | null = null;
	activeProvider: BaseProviderDefinition | null = null;
	// Indexing status for UI feedback
	indexingProgress: { current: number; total: number } | null = null;
	isIndexing: boolean = false;

	/**
	 * Load settings from plugin data
	 */
	async loadSettings(): Promise<void> {
		const data = await this.loadData();
		this.settings = validateSettings({
			...DEFAULT_SETTINGS,
			...(data as Partial<MistralAssistantSettings>),
		});
	}

	/**
	 * Save settings to plugin data
	 */
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * Get the embedding model from settings
	 */
	getEmbeddingModel(): EmbeddingModel | null {
		if (!this.getApiKey()) {
			return null;
		}

		const embeddingModelId = this.settings.embeddingModel || "mistral-embed";
		const auth = {
			apiKey: this.getApiKey(),
			baseUrl: this.getBaseUrl(),
		};

		// Create embedding instance using the mistral provider
		const embeddingInstance = mistralProvider.createEmbeddingInstance(auth, embeddingModelId);
		
		return {
			embedQuery: embeddingInstance.embedQuery.bind(embeddingInstance),
			embedDocuments: embeddingInstance.embedDocuments.bind(embeddingInstance),
		};
	}

	/**
	 * Get the vector store file path from settings
	 */
	getVectorStorePath(): string {
		return this.settings.vectorStorePath || ".obsidian/plugins/obsidian-mistral-assistant/vectorstore.json";
	}

	/**
	 * Initialize the vector store with embedding model and load from file
	 */
	async initVectorStore(): Promise<void> {
		try {
			const embeddingModel = this.getEmbeddingModel();
			const vectorStorePath = this.getVectorStorePath();
			
			// Create persistent vector store
			this.vectorStore = new PersistentVectorStore(embeddingModel || undefined, this.app, vectorStorePath);
			
			if (embeddingModel) {
				// Set the embedding model on the vector store
				(this.vectorStore as PersistentVectorStore).setEmbeddingModel(embeddingModel);
			}
			
			// Load existing data from file
			try {
				await (this.vectorStore as PersistentVectorStore).load();
				console.log(`Vector store initialized. Loaded ${this.vectorStore.count} existing documents.`);
			} catch (loadError) {
				console.warn("Could not load existing vector store:", loadError);
			}
			
		} catch (error) {
			console.error("Failed to initialize vector store:", error);
			// Fallback to in-memory store
			this.vectorStore = new SimpleVectorStore();
			new Notice(`Vector store uses in-memory mode: ${error}`);
		}
	}

	/**
	 * Get the API key from settings
	 */
	getApiKey(): string | null {
		if (this.settings.activeProviderId && this.settings.providerInstances[this.settings.activeProviderId]) {
			const provider = this.settings.providerInstances[this.settings.activeProviderId];
			return (provider.auth?.apiKey as string) || null;
		}
		// Fallback: check if there's any provider with apiKey
		for (const provider of Object.values(this.settings.providerInstances)) {
			if (provider.auth?.apiKey) {
				return provider.auth.apiKey as string;
			}
		}
		return null;
	}

	/**
	 * Get the base URL from settings
	 */
	getBaseUrl(): string {
		if (this.settings.activeProviderId && this.settings.providerInstances[this.settings.activeProviderId]) {
			const provider = this.settings.providerInstances[this.settings.activeProviderId];
			return (provider.auth?.baseUrl as string) || "https://api.mistral.ai";
		}
		// Fallback: check if there's any provider with baseUrl
		for (const provider of Object.values(this.settings.providerInstances)) {
			if (provider.auth?.baseUrl) {
				return provider.auth.baseUrl as string;
			}
		}
		return "https://api.mistral.ai";
	}

	/**
	 * Set indexing progress for UI
	 */
	setIndexingProgress(current: number, total: number): void {
		this.indexingProgress = { current, total };
		// Trigger view refresh if needed
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
		for (const leaf of leaves) {
			const view = leaf.view as any;
			if (view && view.onIndexingProgressUpdate) {
				view.onIndexingProgressUpdate();
			}
		}
	}

	/**
	 * Clear indexing progress
	 */
	clearIndexingProgress(): void {
		this.indexingProgress = null;
		this.isIndexing = false;
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
		for (const leaf of leaves) {
			const view = leaf.view as any;
			if (view && view.onIndexingProgressUpdate) {
				view.onIndexingProgressUpdate();
			}
		}
	}

	/**
	 * Get all documents from the vault and index them
	 */
	async indexVault(): Promise<void> {
		if (!this.settings.enableRAG) {
			return;
		}

		const files = this.app.vault.getMarkdownFiles();
		const docs: RAGDocument[] = [];

		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				docs.push({
					pageContent: content,
					metadata: {
						source: file.path,
						fileName: file.name,
					},
				});
			} catch (error) {
				console.error(`Failed to read file ${file.path}:`, error);
			}
		}

		if (docs.length === 0) return;

		// Initialize vector store with embedding model if not exists
		if (!this.vectorStore) {
			await this.initVectorStore();
		}

		// Clear existing documents before re-indexing
		if (this.vectorStore) {
			if (this.vectorStore instanceof PersistentVectorStore) {
				await (this.vectorStore as PersistentVectorStore).clear();
			} else {
				(this.vectorStore as SimpleVectorStore).clear();
			}
		}

		// Split documents into chunks using our simple splitter
		const chunkSize = this.settings.ragChunkSize || 1000;
		const overlap = this.settings.ragChunkOverlap || 200;
		
		// Mistral free tier rate limits: ~32 requests per minute
		// SimpleVectorStore batches embeddings in groups of 4 with 8s delay between batches
		// So each document batch can generate multiple embedding API calls
		// We add document-level batching with generous delays
		const docBatchSize = 1; // Process 1 document at a time (most conservative)
		const delayMs = 15000; // 15 second delay between documents (very safe for free tier)
		
		// Set indexing state
		this.isIndexing = true;
		this.setIndexingProgress(0, docs.length);
		
		let processedDocs = 0;
		
		for (let i = 0; i < docs.length; i += docBatchSize) {
			const batch = docs.slice(i, i + docBatchSize);
			const chunkedDocs: RAGDocument[] = [];
			
			// Collect all chunks from this batch of documents
			for (const doc of batch) {
				const chunks = splitTextIntoChunks(doc.pageContent, chunkSize, overlap);
				
				for (const chunk of chunks) {
					chunkedDocs.push({
						pageContent: chunk,
						metadata: {
							...doc.metadata,
							chunkIndex: chunks.indexOf(chunk),
							totalChunks: chunks.length,
						},
					});
				}
			}
			
			try {
				if (this.vectorStore && chunkedDocs.length > 0) {
					// Add all chunks from this batch and save to file
					if (this.vectorStore instanceof PersistentVectorStore) {
						await (this.vectorStore as PersistentVectorStore).addDocumentsAndSave(chunkedDocs);
					} else {
						await (this.vectorStore as SimpleVectorStore).addDocuments(chunkedDocs);
					}
				}
				
				processedDocs += batch.length;
				this.setIndexingProgress(processedDocs, docs.length);
				
				// Delay between batches to avoid rate limiting (429 errors)
				if (i + docBatchSize < docs.length) {
					await new Promise(resolve => setTimeout(resolve, delayMs));
				}
			} catch (error) {
				console.error(`Error indexing document batch ${i/docBatchSize}:`, error);
				// If rate limited, wait extra long and then retry this batch
				const errorMsg = String(error);
				if (errorMsg.includes("429") || errorMsg.includes("rate limit") || errorMsg.includes("too many")) {
					const extendedDelay = delayMs * 4; // 60 seconds
					console.warn(`⚠️ Rate limited! Waiting ${extendedDelay}ms before retrying...`);
					// Wait longer and retry THIS batch
					await new Promise(resolve => setTimeout(resolve, extendedDelay));
					// Retry the same batch - don't update progress yet
					i -= docBatchSize; // Go back to retry this batch
				} else {
					// Re-throw non-rate-limit errors
					this.clearIndexingProgress();
					throw error;
				}
			}
		}

		this.clearIndexingProgress();
	}

	/**
	 * Search the vector store for similar documents
	 */
	async searchSimilar(query: string, k: number = 5): Promise<RAGDocument[]> {
		if (!this.vectorStore) {
			return [];
		}

		const results = await this.vectorStore.similaritySearch(query, k);
		return results as RAGDocument[];
	}

	/**
	 * Send a message to the chat model
	 */
	async sendMessage(message: string, context?: RAGDocument[]): Promise<string> {
		const apiKey = this.getApiKey();
		const baseUrl = this.getBaseUrl();
		const model = this.settings.chatModel || "mistral-tiny";
		const temperature = this.settings.defaultTemperature || 0.7;

		if (!apiKey) {
			throw new Error("No API key configured");
		}

		// If we have context from RAG, build the prompt
		let prompt = message;
		if (context && context.length > 0 && this.settings.enableRAG) {
			const contextText = context
				.map((doc) => `--- Document: ${doc.metadata.source || "unknown"} ---\n${doc.pageContent}`)
				.join("\n\n");
			prompt = `Context from your notes:\n${contextText}\n\nUser question: ${message}`;
		}

		try {
			const response = await requestUrl({
				url: `${baseUrl}/v1/chat/completions`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model,
					messages: [
						{ role: "user", content: prompt }
					],
					temperature,
					max_tokens: 2000,
				}),
			});

			const data = JSON.parse(response.text);
			return data.choices?.[0]?.message?.content || "No response content received";
		} catch (error) {
			console.error("Error sending message:", error);
			throw error;
		}
	}

	/**
	 * Generate a streaming response
	 * Note: Mistral's streaming uses SSE which isn't fully supported by requestUrl.
	 * For now, we simulate streaming by chunking the response.
	 */
	async *streamMessage(message: string, context?: RAGDocument[]): AsyncGenerator<string> {
		// Generate context if not provided and RAG is enabled
		let resolvedContext = context;
		if (!resolvedContext && this.settings.enableRAG && this.vectorStore && this.vectorStore.count > 0) {
			resolvedContext = await this.searchSimilar(message, 5);
			console.log(`Found ${resolvedContext.length} relevant chunks for streaming query: ${message}`);
		}

		// For now, use non-streaming and yield chunks manually
		// In the future, implement proper SSE handling
		const fullResponse = await this.sendMessage(message, resolvedContext);
		
		// Simulate streaming by yielding chunks of the response
		const chunkSize = 10;
		for (let i = 0; i < fullResponse.length; i += chunkSize) {
			yield fullResponse.slice(i, i + chunkSize);
			// Small delay to simulate streaming
			await new Promise(resolve => setTimeout(resolve, 10));
		}
	}

	/**
	 * Handle chat: answer a question using RAG
	 */
	async handleChatQuestion(question: string): Promise<string> {
		// Check if we need to index (no vector store, or vector store is empty, and RAG is enabled)
		const needsIndexing = this.settings.enableRAG && 
			(!this.vectorStore || this.vectorStore.count === 0);
		
		if (needsIndexing) {
			new Notice("Notizen werden für RAG indexiert...");
			
			// Initialize vector store if not exists
			if (!this.vectorStore) {
				await this.initVectorStore();
			}
			
			// Set embedding model on vector store if it exists
			const embeddingModel = this.getEmbeddingModel();
			if (embeddingModel && this.vectorStore) {
				(this.vectorStore as SimpleVectorStore).setEmbeddingModel(embeddingModel);
			}
			
			await this.indexVault();
		}

		// Search for relevant context
		let context: RAGDocument[] = [];
		if (this.settings.enableRAG && this.vectorStore && this.vectorStore.count > 0) {
			context = await this.searchSimilar(question, 5);
			console.log(`Found ${context.length} relevant chunks for query: ${question}`);
		} else if (this.settings.enableRAG) {
			// Vector store exists but is empty
			console.log("Vector store is empty, no RAG context available");
		}

		// Generate response
		try {
			return await this.sendMessage(question, context);
		} catch (error) {
			const errorMsg = String(error);
			if (errorMsg.includes("429") || errorMsg.includes("rate limit") || errorMsg.includes("too many")) {
				throw new Error("Rate limit erreicht. Bitte warte einige Minuten und versuche es erneut.");
			}
			throw error;
		}
	}

	/**
	 * Create a new chat session
	 */
	createChatSession(): { id: string; messages: Array<{ role: "user" | "assistant"; content: string }> } {
		return {
			id: uuidv4(),
			messages: [],
		};
	}

	/**
	 * Update plugin state when settings change
	 */
	async updateProvider(): Promise<void> {
		if (this.settings.activeProviderId && this.settings.providerInstances[this.settings.activeProviderId]) {
			this.activeProvider = mistralProvider;
		} else {
			// Check if there's any provider instance
			if (Object.keys(this.settings.providerInstances).length > 0) {
				this.activeProvider = mistralProvider;
			} else {
				this.activeProvider = null;
			}
		}

		// Reinitialize vector store with new settings
		if (this.settings.enableRAG) {
			await this.initVectorStore();
			
			// If vector store exists, update its embedding model
			if (this.vectorStore) {
				const embeddingModel = this.getEmbeddingModel();
				if (embeddingModel) {
					(this.vectorStore as SimpleVectorStore).setEmbeddingModel(embeddingModel);
				}
			}
		}
	}

	/**
	 * Plugin load
	 */
	async onload() {
		console.log("Loading Mistral Assistant plugin");

		// Load settings
		await this.loadSettings();

		// Set up provider
		await this.updateProvider();

		// Register chat view
		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

		this.registerExtensions(["mistral-chat"], VIEW_TYPE_CHAT);

		// Register ribbon icon
		this.addRibbonIcon("message-square", "Mistral Chat", () => {
			this.activateChatView();
		});

		// Register command
		this.addCommand({
			id: "open-mistral-chat",
			name: "Open Mistral Chat",
			callback: () => {
				this.activateChatView();
			},
		});

		// Register settings tab
		this.addSettingTab(new SettingsTab(this.app, this));

		// Register context menu for adding files to chat
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFile) {
					menu.addItem((item) => {
						item.setTitle("Add to Mistral Chat")
							.setIcon("message-square-plus")
							.onClick(() => {
								new Notice(`Added ${file.name} to Mistral Chat`);
							});
					});
				}
			})
		);

		console.log("Mistral Assistant plugin loaded");
	}

	/**
	 * Activate the chat view
	 */
	activateChatView(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
		if (leaves.length > 0) {
			this.app.workspace.revealLeaf(leaves[0]);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			leaf.setViewState({
				type: VIEW_TYPE_CHAT,
				active: true,
			});
			this.app.workspace.revealLeaf(leaf);
		}
	}

	/**
	 * Plugin unload
	 */
	async onunload() {
		console.log("Unloading Mistral Assistant plugin");
	}
}
