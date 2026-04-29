import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import type MistralAssistantPlugin from "../main";

export const VIEW_TYPE_CHAT = "mistral-assistant-chat";

interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	timestamp: Date;
}

export class ChatView extends ItemView {
	plugin: MistralAssistantPlugin;
	messages: ChatMessage[] = [];
	isLoading: boolean = false;
	inputEl: HTMLTextAreaElement;
	chatContainer: HTMLDivElement;

	constructor(leaf: WorkspaceLeaf, plugin: MistralAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText(): string {
		return "Mistral Chat";
	}

	getIcon(): string {
		return "message-square";
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Create container
		const container = contentEl.createDiv();
		container.addClass("mistral-chat-container");

		// Create header
		const header = container.createDiv();
		header.addClass("mistral-chat-header");

		const title = header.createDiv();
		title.addClass("mistral-chat-title");
		const icon = title.createSpan();
		icon.addClass("mistral-icon");
		icon.textContent = "🤖";
		title.createSpan({ text: "Mistral Chat" });

		const actions = header.createDiv();
		actions.addClass("mistral-chat-actions");

		// Index Notes button container
		const indexBtnContainer = actions.createDiv();
		indexBtnContainer.addClass("mistral-index-container");
		
		// Index Notes button
		const indexBtn = indexBtnContainer.createEl("button");
		indexBtn.addClass("mistral-btn", "mistral-btn-small");
		indexBtn.textContent = "Index Notes";
		
		// Indexing status element
		const indexStatus = indexBtnContainer.createSpan();
		indexStatus.addClass("mistral-index-status");
		
		// Loading spinner element
		const indexSpinner = indexBtnContainer.createSpan();
		indexSpinner.addClass("mistral-index-spinner");
		
		// Update indexing UI
		const updateIndexingUI = () => {
			const progress = this.plugin.indexingProgress;
			const isIndexing = this.plugin.isIndexing;
			
			if (isIndexing && progress) {
				indexBtn.disabled = true;
				indexStatus.textContent = `${progress.current}/${progress.total} Notizen indexiert`;
				indexStatus.style.display = "inline";
				indexSpinner.style.display = "inline-block";
			} else {
				indexBtn.disabled = false;
				indexStatus.textContent = "";
				indexStatus.style.display = "none";
				indexSpinner.style.display = "none";
			}
		};
		
		// Method to be called when progress updates
		(this as any).onIndexingProgressUpdate = updateIndexingUI;
		
		indexBtn.addEventListener("click", async () => {
			try {
				this.plugin.settings.enableRAG = true;
				await this.plugin.saveSettings();
				await this.plugin.initVectorStore();
				await this.plugin.indexVault();
				new Notice("Notizen erfolgreich indexiert!");
			} catch (error) {
				console.error("Error indexing notes:", error);
				new Notice(`Fehler beim Indexieren: ${error}`);
				this.plugin.clearIndexingProgress();
			}
		});
		
		// Initial UI update
		updateIndexingUI();

		// Create messages container
		this.chatContainer = container.createDiv();
		this.chatContainer.addClass("mistral-chat-messages");

		// Add welcome message
		this.addMessage("assistant", "Hello! I'm your Mistral AI Assistant. I can help you search and understand your notes, or answer general questions. Ask me anything!", new Date());

		// Check if API is configured
		if (!this.plugin.getApiKey()) {
			this.addMessage("assistant", "⚠️ Please configure your Mistral API key in the plugin settings before using the chat.", new Date());
		}

		// Create input container
		const inputContainer = container.createDiv();
		inputContainer.addClass("mistral-chat-input-container");

		this.inputEl = inputContainer.createEl("textarea") as HTMLTextAreaElement;
		this.inputEl.addClass("mistral-chat-input");
		this.inputEl.placeholder = this.plugin.getApiKey() 
			? "Type your message here... (Ctrl/Cmd + Enter to send)" 
			: "Please configure API key in settings...";
		this.inputEl.disabled = !this.plugin.getApiKey();
		this.inputEl.rows = 1;

		// Send button
		const sendBtn = inputContainer.createEl("button");
		sendBtn.addClass("mistral-btn", "mistral-btn-primary", "mistral-send-btn");
		sendBtn.textContent = "Send";
		sendBtn.disabled = !this.plugin.getApiKey();

		// Keyboard handling
		this.inputEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				this.sendMessage();
			}
		});

		sendBtn.addEventListener("click", () => this.sendMessage());

		// Auto-focus input
		this.inputEl.focus();

		// Scroll to bottom
		this.scrollToBottom();
	}

	async sendMessage() {
		if (!this.inputEl.value.trim() || this.isLoading) return;

		const userMessage = this.inputEl.value.trim();
		this.inputEl.value = "";

		// Add user message
		this.addMessage("user", userMessage, new Date());
		this.isLoading = true;
		this.scrollToBottom();

		try {
			// Use streaming
			let streamedContent = "";
			const messageEl = this.addMessage("assistant", "", new Date());

			for await (const chunk of this.plugin.streamMessage(userMessage)) {
				streamedContent += chunk;
				messageEl.querySelector(".mistral-message-text")!.textContent = streamedContent;
				this.scrollToBottom();
			}
		} catch (error) {
			console.error("Streaming error:", error);
			const errorMsg = String(error);
			// Check for rate limiting
			if (errorMsg.includes("429") || errorMsg.includes("rate limit") || errorMsg.includes("too many")) {
				this.addMessage("assistant", "⚠️ Rate limit erreicht. Bitte warte einige Minuten und versuche es erneut.", new Date());
				return;
			}
			// Fall back to non-streaming
			try {
				const response = await this.plugin.handleChatQuestion(userMessage);
				this.addMessage("assistant", response, new Date());
			} catch (fallbackError) {
				const fallbackMsg = String(fallbackError);
				if (fallbackMsg.includes("429") || fallbackMsg.includes("rate limit") || fallbackMsg.includes("too many")) {
					this.addMessage("assistant", "⚠️ Rate limit erreicht. Bitte warte einige Minuten und versuche es erneut.", new Date());
				} else if (fallbackMsg.includes("No API key") || fallbackMsg.includes("apiKey")) {
					this.addMessage("assistant", "⚠️ Bitte konfiguriere deinen Mistral API Key in den Plugin-Einstellungen.", new Date());
				} else if (fallbackMsg.includes("Invalid API key") || fallbackMsg.includes("401") || fallbackMsg.includes("403")) {
					this.addMessage("assistant", "⚠️ Ungültiger Mistral API Key. Bitte überprüfe deine Einstellungen.", new Date());
				} else {
					this.addMessage("assistant", `❌ Fehler: ${fallbackMsg}`, new Date());
				}
			}
		} finally {
			this.isLoading = false;
			this.scrollToBottom();
		}
	}

	addMessage(role: "user" | "assistant", content: string, timestamp: Date): HTMLElement {
		const messageEl = this.chatContainer.createDiv();
		messageEl.addClass("mistral-message", role);

		const avatar = messageEl.createDiv();
		avatar.addClass("mistral-message-avatar");
		avatar.textContent = role === "user" ? "👤" : "🤖";

		const contentDiv = messageEl.createDiv();
		contentDiv.addClass("mistral-message-content");

		const textDiv = contentDiv.createDiv();
		textDiv.addClass("mistral-message-text");
		textDiv.textContent = content;
		// Replace newlines with br tags
		textDiv.innerHTML = textDiv.textContent.replace(/\n/g, "<br>");

		const timeDiv = contentDiv.createDiv();
		timeDiv.addClass("mistral-message-time");
		timeDiv.textContent = timestamp.toLocaleTimeString();

		this.scrollToBottom();
		return messageEl;
	}

	scrollToBottom() {
		requestAnimationFrame(() => {
			this.chatContainer?.scrollTo({
				top: this.chatContainer.scrollHeight,
				behavior: "smooth",
			});
		});
	}

	async onClose() {
		// Clean up
		this.chatContainer = null!;
	}
}
