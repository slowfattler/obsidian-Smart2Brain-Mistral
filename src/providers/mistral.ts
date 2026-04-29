/**
 * Mistral AI Provider
 * 
 * Direct Mistral API integration without external dependencies.
 * Uses the Mistral API which is OpenAI-compatible.
 */

import { requestUrl, TFile } from "obsidian";
import type {
	AuthObject,
	AuthValidationResult,
	BaseProviderDefinition,
	EmbeddingProviderDefinition,
	ProviderSetupInstructions,
} from "../types/provider/index";

/**
 * Mistral API models response
 */
interface MistralModelsResponse {
	data: Array<{ id: string }>;
}

/**
 * Mistral API chat completion request
 */
interface MistralChatRequest {
	model: string;
	messages: Array<{ role: string; content: string }>;
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	stream?: boolean;
}

/**
 * Mistral API chat completion response
 */
interface MistralChatResponse {
	choices: Array<{ message: { content: string } }>;
}

/**
 * Mistral API embedding request
 */
interface MistralEmbeddingRequest {
	input: string | string[];
	model: string;
}

/**
 * Mistral API embedding response
 */
interface MistralEmbeddingResponse {
	data: Array<{ embedding: number[] }>;
}

/**
 * Mistral embedding models
 */
const MISTRAL_EMBEDDING_MODELS = [
	"mistral-embed",
	"mistral-embedding",
];

/**
 * Mistral chat models
 */
const MISTRAL_CHAT_MODELS = [
	"mistral-tiny",
	"mistral-small",
	"mistral-medium",
	"mistral-large",
	"mixtral-8x7b",
	"mixtral-8x22b",
	"codestral-latest",
];

/**
 * Setup instructions for Mistral
 */
const setupInstructions: ProviderSetupInstructions = {
	steps: [
		"Go to https://console.mistral.ai/ and sign in",
		"Navigate to API Keys in your account settings",
		"Generate a new API key",
		"Copy the API key and paste it below",
	],
	link: {
		url: "https://docs.mistral.ai/api/",
		text: "Mistral API Documentation",
	},
};

/**
 * Simple text splitter for documents
 * This is a lightweight alternative to langchain's RecursiveCharacterTextSplitter
 */
export function splitTextIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
	const chunks: string[] = [];
	const sentences = text.split(/[.!?\n]+/);
	
	let currentChunk = "";
	let currentChunkLength = 0;
	
	for (const sentence of sentences) {
		const sentenceText = sentence.trim();
		if (!sentenceText) continue;
		
		const sentenceLength = sentenceText.split(/\s+/).length;
		
		if (currentChunkLength + sentenceLength > chunkSize && currentChunkLength > 0) {
			chunks.push(currentChunk.trim());
			currentChunk = sentenceText;
			currentChunkLength = sentenceLength;
		} else if (currentChunkLength + sentenceLength > chunkSize) {
			chunks.push(sentenceText);
			currentChunk = "";
			currentChunkLength = 0;
		} else {
			if (currentChunk) {
				currentChunk += " " + sentenceText;
			} else {
				currentChunk = sentenceText;
			}
			currentChunkLength += sentenceLength + 1;
		}
	}
	
	if (currentChunk.trim()) {
		chunks.push(currentChunk.trim());
	}
	
	return chunks;
}

/**
 * Embedding model interface for the vector store
 */
export interface EmbeddingModel {
	embedQuery: (query: string) => Promise<number[]>;
	embedDocuments: (documents: string[]) => Promise<number[][]>;
}

/**
 * Document with vector embedding for persistence
 */
export interface PersistentDocument {
	pageContent: string;
	embedding: number[];
	metadata: Record<string, unknown>;
}

/**
 * Vector store data format for file persistence
 */
export interface VectorStoreData {
	version: number;
	documents: PersistentDocument[];
}

/**
 * Simple in-memory vector store with cosine similarity
 */
export class SimpleVectorStore {
	private embeddings: number[][] = [];
	private documents: string[] = [];
	private metadata: Array<Record<string, unknown>> = [];
	private embeddingModel: EmbeddingModel | null = null;

	constructor(embeddingModel?: EmbeddingModel) {
		if (embeddingModel) {
			this.embeddingModel = embeddingModel;
		}
	}

	/**
	 * Set the embedding model to use
	 */
	setEmbeddingModel(model: EmbeddingModel): void {
		this.embeddingModel = model;
	}

	/**
	 * Calculate cosine similarity between two vectors
	 */
	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) return 0;
		
		let dotProduct = 0;
		let normA = 0;
		let normB = 0;
		
		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}
		
		const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
		if (magnitude === 0) return 0;
		
		return dotProduct / magnitude;
	}

	/**
	 * Maximum batch size for embedding API calls (Mistral rate limits)
	 * Free tier: ~32 requests per minute = ~1 request every 1.9 seconds
	 * With batch size of 4, we get ~8 calls per minute (32 embeddings)
	 */
	private static readonly MAX_EMBEDDING_BATCH_SIZE = 4;
	
	/**
	 * Delay between embedding batches in milliseconds
	 * At 4 embeddings per call, we can do ~8 calls/minute safely
	 * That's ~1 call every 7.5 seconds = 7500ms
	 */
	private static readonly EMBEDDING_BATCH_DELAY_MS = 8000;

	async addDocuments(documents: Array<{ pageContent: string; metadata: Record<string, unknown> }>) {
		if (!this.embeddingModel) {
			// Fallback to text-only mode if no embedding model
			for (const doc of documents) {
				this.documents.push(doc.pageContent);
				this.metadata.push(doc.metadata);
				this.embeddings.push([]);
			}
			return;
		}

		// Extract text content from documents
		const texts = documents.map((doc) => doc.pageContent);
		
		// Batch embeddings to avoid rate limits - process in chunks of MAX_EMBEDDING_BATCH_SIZE
		const embeddings: number[][] = [];
		for (let i = 0; i < texts.length; i += SimpleVectorStore.MAX_EMBEDDING_BATCH_SIZE) {
			const batchTexts = texts.slice(i, i + SimpleVectorStore.MAX_EMBEDDING_BATCH_SIZE);
			try {
				const batchEmbeddings = await this.embeddingModel.embedDocuments(batchTexts);
				embeddings.push(...batchEmbeddings);
			} catch (error) {
				const errorMsg = String(error);
				if (errorMsg.includes("429") || errorMsg.includes("rate limit") || errorMsg.includes("too many")) {
					console.warn(`Rate limited on embedding batch ${i/SimpleVectorStore.MAX_EMBEDDING_BATCH_SIZE}, waiting longer...`);
					// Wait extra long after rate limit hit
					await new Promise(resolve => setTimeout(resolve, SimpleVectorStore.EMBEDDING_BATCH_DELAY_MS * 3));
					// Retry this batch
					const batchEmbeddings = await this.embeddingModel.embedDocuments(batchTexts);
					embeddings.push(...batchEmbeddings);
				} else {
					throw error;
				}
			}
			
			// Delay between embedding batches to avoid rate limits
			if (i + SimpleVectorStore.MAX_EMBEDDING_BATCH_SIZE < texts.length) {
				await new Promise(resolve => setTimeout(resolve, SimpleVectorStore.EMBEDDING_BATCH_DELAY_MS));
			}
		}
		
		// Store documents, metadata, and embeddings
		for (let i = 0; i < documents.length; i++) {
			this.documents.push(documents[i].pageContent);
			this.metadata.push(documents[i].metadata);
			this.embeddings.push(embeddings[i] || []);
		}
	}

	async similaritySearch(query: string, k: number = 5): Promise<Array<{ pageContent: string; metadata: Record<string, unknown> }>> {
		if (!this.embeddingModel || this.embeddings.length === 0) {
			// Fallback to word-based text search if no embeddings
			// Split query into words (filter out very short words for better matching)
			const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
			const results = this.documents
				.map((content, index) => {
					const lowerContent = content.toLowerCase();
					const matches = queryWords.filter(word => lowerContent.includes(word));
					return {
						content,
						metadata: this.metadata[index],
						score: matches.length,
					};
				})
				.filter((item) => item.score > 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, k);

			// If no matches found, return first k documents as fallback
			const finalResults = results.length > 0 ? results : this.documents.slice(0, k).map((content, index) => ({
				content,
				metadata: this.metadata[index],
				score: 0,
			}));

			return finalResults.map((item) => ({
				pageContent: item.content,
				metadata: item.metadata,
			}));
		}

		// Compute embedding for the query
		const queryEmbedding = await this.embeddingModel.embedQuery(query);
		
		// Calculate cosine similarity between query and all stored embeddings
		const results = this.embeddings
			.map((embedding, index) => ({
				score: this.cosineSimilarity(queryEmbedding, embedding),
				content: this.documents[index],
				metadata: this.metadata[index],
			}))
			// Filter out invalid results (where embedding was empty)
			.filter((item) => !isNaN(item.score) && item.score > -1)
			// Sort by similarity (descending)
			.sort((a, b) => b.score - a.score)
			.slice(0, k);

		return results.map((item) => ({
			pageContent: item.content,
			metadata: item.metadata,
		}));
	}

	/**
	 * Clear all stored documents and embeddings
	 */
	clear(): void {
		this.documents = [];
		this.metadata = [];
		this.embeddings = [];
	}

	/**
	 * Get the number of stored documents
	 */
	get count(): number {
		return this.documents.length;
	}

	/**
	 * Stub methods for compatibility with PersistentVectorStore
	 * These do nothing for in-memory store
	 */
	async load(): Promise<void> {
		// In-memory store - nothing to load
		console.log("SimpleVectorStore: Using in-memory mode (no persistence)");
	}

	async save(): Promise<void> {
		// In-memory store - nothing to save
		console.log("SimpleVectorStore: Using in-memory mode (no persistence)");
	}

	async clearAndSave(): Promise<void> {
		this.clear();
		console.log("SimpleVectorStore: Cleared in-memory store");
	}

	async addDocumentsAndSave(documents: Array<{ pageContent: string; metadata: Record<string, unknown> }>): Promise<void> {
		await this.addDocuments(documents);
		// In-memory store - nothing to save
	}
}

/**
 * Persistent vector store that saves data to a JSON file
 * Extends SimpleVectorStore with file-based persistence
 */
export class PersistentVectorStore extends SimpleVectorStore {
	private filePath: string;
	private app: any; // Obsidian App instance
	
	constructor(embeddingModel: EmbeddingModel | undefined, app: any, filePath: string) {
		super(embeddingModel);
		this.app = app;
		this.filePath = filePath;
	}
	
	/**
	 * Load vector store data from file
	 * Uses vault.adapter to support paths outside the vault (like .obsidian/plugins/)
	 */
	async load(): Promise<void> {
		try {
			// Check if filePath is valid
			if (!this.filePath) {
				console.warn("Vector store filePath is not set, starting fresh");
				this.documents = [];
				this.embeddings = [];
				this.metadata = [];
				return;
			}
			
			// Ensure parent directory exists before attempting to read
			await this.ensureDirectoryExists();
			
			// Use vault.adapter to read file directly (supports paths outside vault)
			let fileContent: string;
			try {
				fileContent = await this.app.vault.adapter.read(this.filePath);
			} catch (readError) {
				// File doesn't exist
				console.log(`No existing vector store at ${this.filePath}, starting fresh`);
				this.documents = [];
				this.embeddings = [];
				this.metadata = [];
				return;
			}
			
			const data: VectorStoreData = JSON.parse(fileContent);
			
			// Restore documents, embeddings, and metadata
			for (const doc of data.documents) {
				this.documents.push(doc.pageContent);
				this.embeddings.push(doc.embedding);
				this.metadata.push(doc.metadata);
			}
			
			console.log(`Loaded ${this.documents.length} vectorized documents from ${this.filePath}`);
		} catch (error) {
			// File doesn't exist yet or is corrupted - start fresh
			console.log(`No existing vector store at ${this.filePath || '(undefined path)'}, starting fresh:`, error);
			this.documents = [];
			this.embeddings = [];
			this.metadata = [];
		}
	}
	
	/**
	 * Ensure parent directory exists
	 */
	private async ensureDirectoryExists(): Promise<void> {
		if (!this.filePath) {
			throw new Error("Cannot ensure directory: filePath is not set");
		}
		const dirPath = this.filePath.substring(0, this.filePath.lastIndexOf("/"));
		if (dirPath && !(await this.app.vault.exists(dirPath))) {
			try {
				await this.app.vault.createFolder(dirPath);
				console.log(`Created directory ${dirPath}`);
			} catch (dirError) {
				console.warn(`Could not create directory ${dirPath}:`, dirError);
				// Continue anyway, might already exist
			}
		}
	}

	/**
	 * Write content to file, overwriting if exists
	 * Uses vault.adapter.write() to bypass the Vault cache entirely
	 * This avoids race conditions with concurrent writes and cache synchronization issues
	 */
	private async writeFile(content: string): Promise<void> {
		if (!this.filePath) {
			throw new Error("Cannot write file: filePath is not set");
		}
		
		// Ensure parent directory exists
		await this.ensureDirectoryExists();
		
		// Write directly to filesystem, bypassing Vault cache
		// This always overwrites if file exists, no race conditions possible
		await this.app.vault.adapter.write(this.filePath, content);
	}

	/**
	 * Save vector store data to file
	 * Uses vault.adapter.write() to bypass cache and avoid race conditions
	 */
	async save(): Promise<void> {
		try {
			// Prepare data for saving
			const data: VectorStoreData = {
				version: 1,
				documents: this.documents.map((content, index) => ({
					pageContent: content,
					embedding: this.embeddings[index] || [],
					metadata: this.metadata[index] || {},
				})),
			};
			
			const content = JSON.stringify(data, null, 2);
			
			// Save using race-condition-safe write
			await this.writeFile(content);
			
			console.log(`Saved ${this.documents.length} vectorized documents to ${this.filePath}`);
		} catch (error) {
			console.error(`Failed to save vector store to ${this.filePath}:`, error);
			throw error;
		}
	}
	
	/**
	 * Clear all documents and save the empty state
	 */
	async clearAndSave(): Promise<void> {
		this.documents = [];
		this.embeddings = [];
		this.metadata = [];
		
		// Create empty file
		const data: VectorStoreData = {
			version: 1,
			documents: [],
		};
		
		try {
			const content = JSON.stringify(data, null, 2);
			
			// Delete and recreate
			await this.writeFile(content);
			console.log(`Cleared vector store at ${this.filePath}`);
		} catch (error) {
			console.error(`Failed to clear vector store file:`, error);
		}
	}
	
	/**
	 * Add documents and save to file
	 */
	async addDocumentsAndSave(documents: Array<{ pageContent: string; metadata: Record<string, unknown> }>): Promise<void> {
		await super.addDocuments(documents);
		
		// Save after adding
		try {
			await this.save();
		} catch (error) {
			console.error(`Warning: Failed to save vector store after adding documents:`, error);
			// Continue anyway - documents are in memory
		}
	}
	
}

/**
 * Factory function to create the appropriate vector store
 */
export function createVectorStore(
	embeddingModel: EmbeddingModel | undefined,
	app: any,
	vectorStorePath: string
): SimpleVectorStore {
	// For now, use persistent store if app is available
	if (app) {
		return new PersistentVectorStore(embeddingModel, app, vectorStorePath);
	}
	return new SimpleVectorStore(embeddingModel);
}

/**
 * Call Mistral chat API
 */
async function callMistralChatAPI(
	apiKey: string,
	baseUrl: string,
	model: string,
	messages: Array<{ role: string; content: string }>,
	temperature?: number,
	topP?: number,
	maxTokens?: number,
	stream: boolean = false
): Promise<Response> {
	const url = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
	
	const body: MistralChatRequest = {
		model,
		messages,
	};
	
	if (temperature !== undefined) body.temperature = temperature;
	if (topP !== undefined) body.top_p = topP;
	if (maxTokens !== undefined) body.max_tokens = maxTokens;
	if (stream) body.stream = true;

	return requestUrl({
		url,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
	});
}

/**
 * Call Mistral embedding API
 */
async function callMistralEmbeddingAPI(
	apiKey: string,
	baseUrl: string,
	model: string,
	input: string
): Promise<number[]> {
	const url = `${baseUrl.replace(/\/+$/, "")}/v1/embeddings`;
	
	const body: MistralEmbeddingRequest = {
		model,
		input,
	};

	const response = await requestUrl({
		url,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
	});

	const data = JSON.parse(response.text) as MistralEmbeddingResponse;
	return data.data[0]?.embedding || [];
}

/**
 * Mistral provider definition
 */
export const mistralProvider: EmbeddingProviderDefinition = {
	id: "mistral",
	displayName: "Mistral AI",
	setupInstructions,
	auth: {
		apiKey: {
			label: "API Key",
			description: "Your Mistral AI API key from console.mistral.ai",
			kind: "secret",
			required: true,
			placeholder: "xxx...xxx",
		},
		baseUrl: {
			label: "Base URL",
			description: "Mistral API base URL (optional, default: https://api.mistral.ai)",
			kind: "text",
			required: false,
			placeholder: "https://api.mistral.ai",
		},
	},
	createChatInstance: (auth: AuthObject, modelId: string, options = {}) => {
		// Return a simple chat object that can be invoked
		return {
			invoke: async (messages: Array<[string, string]>) => {
				const apiKey = auth.apiKey as string;
				const baseUrl = (auth.baseUrl as string) || "https://api.mistral.ai";
				
				// Convert messages to Mistral format
				const mistralMessages = messages.map(([role, content]) => ({
					role: role === "human" ? "user" : role,
					content,
				}));

				const response = await callMistralChatAPI(
					apiKey,
					baseUrl,
					modelId,
					mistralMessages,
					options.temperature,
					options.topP,
					options.maxTokens,
					false
				);

				const data = JSON.parse(response.text) as MistralChatResponse;
				return {
					content: data.choices[0]?.message?.content || "",
				};
			},
			stream: async function* (messages: Array<[string, string]>) {
				const apiKey = auth.apiKey as string;
				const baseUrl = (auth.baseUrl as string) || "https://api.mistral.ai";
				
				const mistralMessages = messages.map(([role, content]) => ({
					role: role === "human" ? "user" : role,
					content,
				}));

				const response = await callMistralChatAPI(
					apiKey,
					baseUrl,
					modelId,
					mistralMessages,
					options.temperature,
					options.topP,
					options.maxTokens,
					true
				);

				// Handle streaming response
				// Note: This is simplified - actual streaming would need more complex handling
				yield (JSON.parse(response.text) as MistralChatResponse).choices[0]?.message?.content || "";
			},
			_llmType: "mistral",
			model: modelId,
		} as any;
	},
	createEmbeddingInstance: (auth: AuthObject, modelId: string) => {
		// Return a simple embeddings object
		return {
			embedQuery: async (query: string): Promise<number[]> => {
				const apiKey = auth.apiKey as string;
				const baseUrl = (auth.baseUrl as string) || "https://api.mistral.ai";
				return callMistralEmbeddingAPI(apiKey, baseUrl, modelId, query);
			},
			embedDocuments: async (documents: string[]): Promise<number[][]> => {
				const apiKey = auth.apiKey as string;
				const baseUrl = (auth.baseUrl as string) || "https://api.mistral.ai";
				
				// Embed each document separately
				const embeddings = await Promise.all(
					documents.map((doc) => callMistralEmbeddingAPI(apiKey, baseUrl, modelId, doc))
				);
				return embeddings;
			},
		} as any;
	},
	validateAuth: async (auth: AuthObject): Promise<AuthValidationResult> => {
		const apiKey = auth.apiKey as string;
		const baseUrl = (auth.baseUrl as string) || "https://api.mistral.ai";

		if (!apiKey || apiKey.trim() === "") {
			return { valid: false, error: "API key is required" };
		}

		try {
			const response = await requestUrl({
				url: `${baseUrl.replace(/\/+$/, "")}/v1/models`,
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${apiKey}`,
				},
				throw: false,
			});

			if (response.status >= 200 && response.status < 300) {
				return { valid: true };
			}

			let errorMessage: string | undefined;
			try {
				const parsed = JSON.parse(response.text) as { error?: { message?: string } };
				errorMessage = parsed?.error?.message;
			} catch {
				errorMessage = "Unknown error";
			}

			if (response.status === 401 || response.status === 403) {
				return { valid: false, error: errorMessage || "Invalid API key" };
			}

			return {
				valid: false,
				error: errorMessage || `Request failed with status ${response.status}`,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { valid: false, error: `Connection failed: ${message}` };
		}
	},
	discoverModels: async (auth: AuthObject): Promise<string[]> => {
		const apiKey = auth.apiKey as string;
		const baseUrl = (auth.baseUrl as string) || "https://api.mistral.ai";

		const response = await requestUrl({
			url: `${baseUrl.replace(/\/+$/, "")}/v1/models`,
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${apiKey}`,
			},
			throw: false,
		});

		if (response.status < 200 || response.status >= 300) {
			// Fallback to known models if API fails
			return [...MISTRAL_CHAT_MODELS, ...MISTRAL_EMBEDDING_MODELS];
		}

		const payload = JSON.parse(response.text) as MistralModelsResponse;
		const models = Array.isArray(payload.data) ? payload.data : [];

		return models
			.map((m) => m.id)
			.filter((id): id is string => typeof id === "string" && id.trim() !== "");
	},
	discoverEmbeddingModels: async () => {
		return MISTRAL_EMBEDDING_MODELS;
	},
};

export default mistralProvider;
