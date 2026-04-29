/**
 * Plugin Settings
 */

import { z } from "zod";

/**
 * Settings schema using Zod for validation
 */
export const SettingsSchema = z.object({
	// Provider instances
	providerInstances: z.record(
		z.string(),
		z.object({
			templateId: z.string(),
			displayName: z.string(),
			auth: z.record(z.string(), z.unknown()),
			defaultModel: z.string().optional(),
		})
	),
	// Active provider ID
	activeProviderId: z.string().optional(),
	// Default settings for new chats
	defaultTemperature: z.number().min(0).max(2).default(0.7),
	defaultMaxTokens: z.number().int().positive().optional(),
	// Chat settings
	chatOpenLocation: z.enum(["left", "right", "main"]).default("right"),
	// RAG settings
	enableRAG: z.boolean().default(true),
	ragChunkSize: z.number().int().positive().default(1000),
	ragChunkOverlap: z.number().int().min(0).default(200),
	// Vector store settings
	vectorStorePath: z.string().default(".obsidian/plugins/obsidian-mistral-assistant/vectorstore.json"),
	// Embedding model
	embeddingModel: z.string().default("mistral-embed"),
	// Chat model
	chatModel: z.string().default("mistral-tiny"),
});

/**
 * Type for the plugin settings
 */
export type MistralAssistantSettings = z.infer<typeof SettingsSchema>;

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: MistralAssistantSettings = {
	providerInstances: {},
	activeProviderId: undefined,
	defaultTemperature: 0.7,
	defaultMaxTokens: undefined,
	chatOpenLocation: "right",
	enableRAG: true,
	ragChunkSize: 1000,
	ragChunkOverlap: 200,
	vectorStorePath: ".obsidian/plugins/obsidian-mistral-assistant/vectorstore.json",
	embeddingModel: "mistral-embed",
	chatModel: "mistral-tiny",
};

/**
 * Get validated settings from a partial object
 */
export function validateSettings(partialSettings: Partial<MistralAssistantSettings>): MistralAssistantSettings {
	const parsed = SettingsSchema.safeParse({
		...DEFAULT_SETTINGS,
		...partialSettings,
	});

	if (parsed.success) {
		return parsed.data;
	}

	// Merge with defaults for any missing values
	const result: MistralAssistantSettings = { ...DEFAULT_SETTINGS };
	for (const key of Object.keys(partialSettings) as Array<keyof MistralAssistantSettings>) {
		(result as any)[key] = (partialSettings as any)[key];
	}
	return result;
}
