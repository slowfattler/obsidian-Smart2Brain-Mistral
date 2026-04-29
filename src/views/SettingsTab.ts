import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type MistralAssistantPlugin from "../main";
import { mistralProvider } from "../providers/index";

export class SettingsTab extends PluginSettingTab {
	plugin: MistralAssistantPlugin;

	constructor(app: App, plugin: MistralAssistantPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl("h2", { text: "Mistral Assistant Settings" });

		// API Configuration Section
		containerEl.createEl("h3", { text: "API Configuration" });
		containerEl.createEl("p", {
			text: "Configure your Mistral AI API access. Get your API key from console.mistral.ai.",
			cls: "mistral-settings-description",
		});

		// API Key
		new Setting(containerEl)
			.setName("API Key")
			.setDesc("Your Mistral AI API key")
			.addText((text) => {
				text.inputEl.type = "password";
				text.inputEl.placeholder = "Enter your Mistral API key";
				const currentApiKey = this.getApiKey();
				if (currentApiKey) {
					text.setValue(currentApiKey);
					text.inputEl.addEventListener("focus", () => {
						text.inputEl.type = "text";
					});
					text.inputEl.addEventListener("blur", () => {
						text.inputEl.type = "password";
					});
				}
				text.onChange(async (value: string) => {
					this.plugin.settings.providerInstances = {
						"mistral-default": {
							templateId: "mistral",
							displayName: "Mistral AI",
							auth: { apiKey: value },
							defaultModel: this.plugin.settings.chatModel,
						},
					};
					this.plugin.settings.activeProviderId = "mistral-default";
					await this.plugin.saveSettings();
					await this.plugin.updateProvider();
				});
				return text;
			});

		// Base URL
		new Setting(containerEl)
			.setName("Base URL")
			.setDesc("Mistral API base URL (optional, default: https://api.mistral.ai)")
			.addText((text) => {
				text.inputEl.type = "text";
				text.inputEl.placeholder = "https://api.mistral.ai";
				const currentBaseUrl = this.getBaseUrl();
				if (currentBaseUrl) {
					text.setValue(currentBaseUrl);
				}
				text.onChange(async (value: string) => {
					const current = this.plugin.settings.providerInstances["mistral-default"] || { auth: {} };
					this.plugin.settings.providerInstances = {
						"mistral-default": {
							...current,
							auth: { ...current.auth, baseUrl: value },
						},
					};
					await this.plugin.saveSettings();
				});
				return text;
			});

		// Test Connection button
		new Setting(containerEl)
			.addButton((btn) => {
				btn.setButtonText("Test Connection");
				btn.setCta();
				btn.onClick(async () => {
					const apiKey = this.getApiKey();
					const baseUrl = this.getBaseUrl() || "https://api.mistral.ai";
					
					if (!apiKey) {
						new Notice("Please enter an API key first");
						return;
					}
					
					new Notice("Testing Mistral API connection...");
					try {
						const result = await mistralProvider.validateAuth({ apiKey, baseUrl });
						if (result.valid) {
							new Notice("✅ Connection successful!");
						} else {
							new Notice(`❌ Connection failed: ${result.error}`);
						}
					} catch (error) {
						new Notice(`❌ Connection error: ${error}`);
					}
				});
				return btn;
			});

		// Chat Model
		new Setting(containerEl)
			.setName("Chat Model")
			.setDesc("Default model for chat")
			.addDropdown((dropdown) => {
				dropdown.addOption("mistral-tiny", "mistral-tiny");
				dropdown.addOption("mistral-small", "mistral-small");
				dropdown.addOption("mistral-medium", "mistral-medium");
				dropdown.addOption("mistral-large", "mistral-large");
				dropdown.addOption("mixtral-8x7b", "mixtral-8x7b");
				dropdown.addOption("mixtral-8x22b", "mixtral-8x22b");
				dropdown.setValue(this.plugin.settings.chatModel || "mistral-tiny");
				dropdown.onChange(async (value: string) => {
					this.plugin.settings.chatModel = value;
					const current = this.plugin.settings.providerInstances["mistral-default"] || {};
					this.plugin.settings.providerInstances = {
						"mistral-default": {
							...current,
							defaultModel: value,
						},
					};
					await this.plugin.saveSettings();
				});
				return dropdown;
			});

		// Embedding Model
		new Setting(containerEl)
			.setName("Embedding Model")
			.setDesc("Model for embeddings (RAG)")
			.addDropdown((dropdown) => {
				dropdown.addOption("mistral-embed", "mistral-embed");
				dropdown.addOption("mistral-embedding", "mistral-embedding");
				dropdown.setValue(this.plugin.settings.embeddingModel || "mistral-embed");
				dropdown.onChange(async (value: string) => {
					this.plugin.settings.embeddingModel = value;
					await this.plugin.saveSettings();
				});
				return dropdown;
			});

		// Temperature
		new Setting(containerEl)
			.setName("Temperature")
			.setDesc("Creativity level (0 = deterministic, 2 = creative)")
			.addSlider((slider) => {
				slider.setLimits(0, 2, 0.1);
				slider.setValue(this.plugin.settings.defaultTemperature || 0.7);
				slider.onChange(async (value: number) => {
					this.plugin.settings.defaultTemperature = value;
					await this.plugin.saveSettings();
				});
				return slider;
			});

		// RAG Settings Section
		containerEl.createEl("h3", { text: "Retrieval Augmented Generation (RAG)" });
		containerEl.createEl("p", {
			text: "RAG allows the assistant to search your notes and provide answers based on your content.",
			cls: "mistral-settings-description",
		});

		// Enable RAG
		new Setting(containerEl)
			.setName("Enable RAG")
			.setDesc("Search notes for answers to your questions")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.enableRAG || true);
				toggle.onChange(async (value: boolean) => {
					this.plugin.settings.enableRAG = value;
					await this.plugin.saveSettings();
				});
				return toggle;
			});

		// Chunk Size
		new Setting(containerEl)
			.setName("Chunk Size")
			.setDesc("Size of document chunks for indexing (tokens)")
			.addText((text) => {
				text.inputEl.type = "number";
				text.setValue(String(this.plugin.settings.ragChunkSize || 1000));
				text.onChange(async (value: string) => {
					this.plugin.settings.ragChunkSize = parseInt(value, 10) || 1000;
					await this.plugin.saveSettings();
				});
				return text;
			});

		// Chunk Overlap
		new Setting(containerEl)
			.setName("Chunk Overlap")
			.setDesc("Overlap between chunks (tokens)")
			.addText((text) => {
				text.inputEl.type = "number";
				text.setValue(String(this.plugin.settings.ragChunkOverlap || 200));
				text.onChange(async (value: string) => {
					this.plugin.settings.ragChunkOverlap = parseInt(value, 10) || 200;
					await this.plugin.saveSettings();
				});
				return text;
			});

		// Vector Store Path
		new Setting(containerEl)
			.setName("Vector Store Pfad")
			.setDesc("Dateipfad für gespeicherte Vektordaten (z.B.: .obsidian/plugins/obsidian-mistral-assistant/vectorstore.json)")
			.addText((text) => {
				text.inputEl.type = "text";
				text.inputEl.placeholder = ".obsidian/plugins/obsidian-mistral-assistant/vectorstore.json";
				text.setValue(this.plugin.settings.vectorStorePath || ".obsidian/plugins/obsidian-mistral-assistant/vectorstore.json");
				text.onChange(async (value: string) => {
					this.plugin.settings.vectorStorePath = value.trim();
					await this.plugin.saveSettings();
					// Reinitialize vector store with new path
					if (this.plugin.settings.enableRAG) {
						try {
							await this.plugin.initVectorStore();
							new Notice(`Vector store Pfad aktualisiert: ${value}`);
						} catch (error) {
							new Notice(`Fehler beim Aktualisieren des Vector Stores: ${error}`);
						}
					}
				});
				return text;
			});
	}

	/**
	 * Get the current API key from settings
	 */
	private getApiKey(): string {
		const provider = this.plugin.settings.providerInstances["mistral-default"];
		return (provider?.auth?.apiKey as string) || "";
	}

	/**
	 * Get the current base URL from settings
	 */
	private getBaseUrl(): string {
		const provider = this.plugin.settings.providerInstances["mistral-default"];
		return (provider?.auth?.baseUrl as string) || "https://api.mistral.ai";
	}
}
