/**
 * Provider Authentication Types
 */

/**
 * Authentication field types
 */
export type AuthFieldKind = "text" | "secret" | "textarea" | "select";

/**
 * Base authentication field definition
 */
export interface BaseAuthField {
	label: string;
	description: string;
	kind: AuthFieldKind;
	required: boolean;
	placeholder?: string;
}

/**
 * Select option for auth fields
 */
export interface AuthFieldSelectOption {
	value: string;
	label: string;
}

/**
 * Select-type authentication field
 */
export interface AuthFieldSelect extends BaseAuthField {
	kind: "select";
	options: AuthFieldSelectOption[];
	defaultValue?: string;
}

/**
 * Union type for all auth field types
 */
export type AuthFieldDefinition = BaseAuthField | AuthFieldSelect;

/**
 * Authentication configuration for a provider
 * Maps field names to their definitions
 */
export interface ProviderAuthConfig {
	[fieldName: string]: AuthFieldDefinition;
}

/**
 * Auth object containing the actual values provided by the user
 */
export interface AuthObject {
	[fieldName: string]: string | Record<string, string>;
}

/**
 * Auth object key type
 */
export type AuthObjectKey = keyof AuthObject;
