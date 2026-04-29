/**
 * Provider Registry
 * 
 * This module provides lookup helpers for code-defined provider templates and
 * persisted provider instances created from those templates.
 */

import type { BaseProviderDefinition, ProviderInstanceMeta, ProviderTemplateId } from "../types/provider/index";
import { mistralProvider } from "./mistral";

export interface ProviderTemplateDefinition {
	id: ProviderTemplateId;
	displayName: string;
	description: string;
}

/**
 * Available provider templates
 */
export const PROVIDER_TEMPLATES: readonly ProviderTemplateDefinition[] = [
	{
		id: "mistral",
		displayName: "Mistral AI",
		description: "Mistral AI models via API with support for chat and embeddings.",
	},
] as const;

/**
 * Get a provider template by ID
 */
export function getProviderTemplate(templateId: ProviderTemplateId): ProviderTemplateDefinition | undefined {
	return PROVIDER_TEMPLATES.find((template) => template.id === templateId);
}

/**
 * Create a provider definition from a template and instance metadata
 */
function createTemplateDefinition(
	instanceId: string,
	templateId: ProviderTemplateId,
	meta: ProviderInstanceMeta,
): BaseProviderDefinition | undefined {
	switch (templateId) {
		case "mistral":
			return {
				...mistralProvider,
				id: instanceId,
				displayName: meta.displayName,
			};
		default:
			return undefined;
	}
}

/**
 * Get a full provider definition from instance metadata
 */
export function getProviderDefinition(
	id: string,
	providerMeta: Record<string, ProviderInstanceMeta> = {},
): BaseProviderDefinition | undefined {
	const meta = providerMeta[id];
	if (!meta) {
		return undefined;
	}
	return createTemplateDefinition(id, meta.templateId, meta);
}

/**
 * Get all available provider templates
 */
export function getAllProviderTemplates(): readonly ProviderTemplateDefinition[] {
	return PROVIDER_TEMPLATES;
}

// Re-export types
export type {
	AuthObject,
	AuthObjectKey,
	BaseProviderDefinition,
	ChatModelConfig,
	EmbeddingProviderDefinition,
	EmbeddingModelConfig,
	LogoProps,
	ModelMetadata,
	ProviderAuthConfig,
	ProviderSetupInstructions,
	ProviderTemplateId,
	ProviderInstanceMeta,
} from "../types/provider/index";

export { isEmbeddingProvider } from "../types/provider/index";

// Re-export the mistral provider for direct use
export { mistralProvider };
