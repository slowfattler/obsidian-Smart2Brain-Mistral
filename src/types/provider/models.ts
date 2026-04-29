/**
 * Model Configuration Types
 */

/**
 * Configuration options for chat models
 */
export interface ChatModelConfig {
	temperature?: number;
	topP?: number;
	maxTokens?: number;
	stop?: string[];
	presencePenalty?: number;
	frequencyPenalty?: number;
}

/**
 * Configuration options for embedding models
 */
export interface EmbeddingModelConfig {
	// Embedding-specific options can be added here
}

/**
 * Model metadata for display and filtering
 */
export interface ModelMetadata {
	id: string;
	name: string;
	description?: string;
	contextWindow?: number;
	maxTokens?: number;
	provider?: string;
	createdAt?: string;
}
