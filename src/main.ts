import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import "./lib/i18n";
import { Logger as Log } from "./utils/logging";
import "./styles.css";
import { AgentManager } from "./agent/AgentManager";
import { inlineDiffPlugin } from "./editor/inlineDiffExtension";
import { selectionHighlightPlugin } from "./editor/selectionHighlightExtension";
import { createReadingViewDiffPostProcessor } from "./editor/readingViewDiffProcessor";
import { terminateWorker as terminateClusteringWorker } from "./utils/computeWorkerManager";
import { SearchModal } from "./components/modal/SearchModal";
import { getQueryClient } from "./lib/query";
import { SkillsService } from "./skills";
import { createMessenger, getMessenger } from "./stores/chatStore.svelte";
import { type PluginDataStore, createData, getData } from "./stores/dataStore.svelte";
import { PendingChangesStore, initPendingChangesStore } from "./stores/pendingChangesStore.svelte";
import { setPlugin } from "./stores/state.svelte";
import { LexicalSearchService } from "./search/LexicalSearchService";
import { ChatView, VIEW_TYPE_CHAT } from "./views/chat/Chat";
import { SmartGraphView, VIEW_TYPE_SMART_GRAPH } from "./views/smart-graph/SmartGraphView";
import SettingsTab from "./views/settings/Settings";
import { VectorStoreService } from "./vectorstore";
import { MistralLLM } from "./llm/mistral";

// [MISTRAL] PluginSettings-Interface und Defaults
interface PluginSettings {
  mistralApiKey: string;
  useMistral: boolean;
  mistralModel: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
  mistralApiKey: "",
  useMistral: false,
  mistralModel: "mistral-tiny",
};

const SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS = new Set([
  "txt", "md", "csv", "json", "png", "jpg", "jpeg", "gif", "webp", "pdf",
]);

export default class SecondBrainPlugin extends Plugin {
  agentManager!: AgentManager;
  skillsService!: SkillsService;
  lexicalSearchService!: LexicalSearchService;
  vectorStoreService!: VectorStoreService;
  pendingChangesStore!: PendingChangesStore;
  queryClient = getQueryClient();
  pluginData!: PluginDataStore;
  settings: PluginSettings = { ...DEFAULT_SETTINGS }; // [FIX] Defaults setzen

  private getAddToChatMenuLabel(selectedCount: number): string {
    if (selectedCount <= 1) {
      return "Add to Chat";
    }
    return `Add ${selectedCount} files to Chat`;
  }

  // ... (alle privaten Methoden wie registerNotebookNavigatorMenus, getSupportedFiles, queueFilesForChatAttachment bleiben unverändert) ...

  async onload() {
    // [FIX] NUR die absolut notwendigen Registrierungen hier
    setPlugin(this);

    // [FIX] ALLE Initialisierungen in onLayoutReady verschieben
    this.app.workspace.onLayoutReady(async () => {
      try {
        // [FIX] Settings sicher laden
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        // [FIX] PluginData sicher laden
        this.pluginData = await createData(this);

        // [FIX] SkillsService initialisieren
        this.skillsService = new SkillsService(this);

        // [FIX] AgentManager erstellen
        this.agentManager = new AgentManager(this);
        createMessenger(this.agentManager);

        // [FIX] Alle View-Registrierungen
        this.registerHoverLinkSource(VIEW_TYPE_CHAT, {
          display: "Smart2Brain Chat",
          defaultMod: false,
        });
        this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
        this.registerExtensions(["chat"], VIEW_TYPE_CHAT);

        this.registerHoverLinkSource(VIEW_TYPE_SMART_GRAPH, {
          display: "Smart Graph",
          defaultMod: true,
        });
        this.registerView(VIEW_TYPE_SMART_GRAPH, (leaf) => new SmartGraphView(leaf, this));

        // [FIX] File Open Interception
        const origOpenFile = WorkspaceLeaf.prototype.openFile;
        const app = this.app;
        WorkspaceLeaf.prototype.openFile = async function (file, openState) {
          if (file.extension === "chat") {
            const location = getData().chatOpenLocation;
            if (location === "left" || location === "right") {
              const ws = app.workspace;
              const root = this.getRoot();
              if (root !== ws.leftSplit && root !== ws.rightSplit) {
                const targetSplit = location === "left" ? ws.leftSplit : ws.rightSplit;
                const sidebarLeaf = ws.getLeavesOfType(VIEW_TYPE_CHAT).find((l: WorkspaceLeaf) => l.getRoot() === targetSplit) ??
                  (location === "left" ? ws.getLeftLeaf(false) : ws.getRightLeaf(false));
                if (sidebarLeaf) {
                  await origOpenFile.call(sidebarLeaf, file, openState);
                  ws.revealLeaf(sidebarLeaf);
                  return;
                }
              }
            }
            return origOpenFile.call(this, file, openState);
          }
          return origOpenFile.call(this, file, openState);
        };
        this.register(() => {
          WorkspaceLeaf.prototype.openFile = origOpenFile;
        });

        // [FIX] Ribbon Icons und Commands
        this.addRibbonIcon("message-square", "New Chat", () => this.createNewChat());
        this.addRibbonIcon("git-fork", "Smart Graph", () => this.activateSmartGraphView());

        this.addCommand({
          id: "open-chat",
          name: "Open Chat",
          icon: "message-square",
          callback: async () => await this.agentManager.openLatestChat(),
        });

        this.addCommand({
          id: "new-chat",
          name: "New Chat",
          icon: "plus",
          callback: async () => await this.agentManager.createNewChat(),
        });

        this.addCommand({
          id: "search-notes",
          name: "Search Notes",
          icon: "search",
          callback: () => new SearchModal(this.app).open(),
        });

        this.addCommand({
          id: "open-smart-graph",
          name: "Open Smart Graph",
          icon: "git-fork",
          callback: () => this.activateSmartGraphView(),
        });

        this.addCommand({
          id: "export-chat-as-json",
          name: "Export current chat as JSON",
          icon: "file-json",
          callback: async () => {
            const threadId = getMessenger()?.session?.id;
            if (!threadId) {
              new Notice("No chat is currently open");
              return;
            }
            await this.agentManager.exportChatAsJson(threadId);
            new Notice("Chat exported as JSON");
          },
        });

        // [FIX] SettingsTab erst NACH dem Laden der Settings registrieren
        this.addSettingTab(new SettingsTab(this.app, this));

        // [FIX] Event Listener registrieren
        this.registerEvent(
          this.app.workspace.on("file-open", (file) => {
            if (!(file instanceof TFile)) return;
            if (file.extension !== "md") return;
            this.pluginData.recordRecentlyOpenedNote(file.path);
          }),
        );

        this.registerNotebookNavigatorMenus();

        // [FIX] LexicalSearch und VectorStore initialisieren
        this.lexicalSearchService = LexicalSearchService.startInitialize(this);
        this.vectorStoreService = VectorStoreService.startInitialize(this);

        // [FIX] Skills + Agent init
        await this.skillsService.initialize();
        await this.agentManager.initialize();

        // [FIX] PendingChangesStore initialisieren
        this.pendingChangesStore = new PendingChangesStore(this);
        initPendingChangesStore(this.pendingChangesStore);
        await this.pendingChangesStore.load();

        // [FIX] Editor Extensions registrieren
        this.registerEditorExtension(inlineDiffPlugin);
        this.registerEditorExtension(selectionHighlightPlugin);
        this.registerMarkdownPostProcessor(createReadingViewDiffPostProcessor(this));

        // [FIX] Reading View Refresh
        const refreshReadingViews = () => {
          for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view;
            if (view instanceof MarkdownView) {
              view.previewMode?.rerender(true);
            }
          }
        };
        document.addEventListener("s2b-pending-changes-updated", refreshReadingViews);
        this.register(() => document.removeEventListener("s2b-pending-changes-updated", refreshReadingViews));

        // [FIX] File Menu Events
        this.registerEvent(
          this.app.workspace.on("file-menu", (menu, file) => {
            if (!(file instanceof TFile)) return;
            menu.addItem((item) =>
              item
                .setTitle(this.getAddToChatMenuLabel(1))
                .setIcon("message-square-plus")
                .onClick(async () => {
                  try {
                    await this.queueFilesForChatAttachment([file]);
                  } catch (error) {
                    new Notice(
                      `Failed to add file to chat: ${error instanceof Error ? error.message : String(error)}`,
                    );
                  }
                }),
            );
          }),
        );

        this.registerEvent(
          this.app.workspace.on("files-menu", (menu, files) => {
            const selectedFiles = files.filter((file): file is TFile => file instanceof TFile);
            if (selectedFiles.length === 0) return;
            menu.addItem((item) =>
              item
                .setTitle(this.getAddToChatMenuLabel(selectedFiles.length))
                .setIcon("message-square-plus")
                .onClick(async () => {
                  try {
                    await this.queueFilesForChatAttachment(selectedFiles);
                  } catch (error) {
                    new Notice(
                      `Failed to add files to chat: ${error instanceof Error ? error.message : String(error)}`,
                    );
                  }
                }),
            );
          }),
        );

      } catch (e) {
        Log.error("Initialization failed in onLayoutReady", e);
        new Notice(`Plugin initialization failed: ${e.message}`);
      }
    });
  }

  // [MISTRAL] Methode zum Speichern der Einstellungen
  async saveSettings() {
    await this.saveData(this.settings);
  }

  onunload() {
    Log.info("Unloading plugin");
    if (this.lexicalSearchService) void this.lexicalSearchService.cleanup();
    if (this.vectorStoreService) void this.vectorStoreService.cleanup();
    if (this.agentManager) void this.agentManager.cleanup();
    if (this.pendingChangesStore) this.pendingChangesStore.cleanup();
    terminateClusteringWorker();
  }

  async createNewChat() {
    return this.agentManager?.createNewChat();
  }

  async openLatestChat() {
    return this.agentManager?.openLatestChat();
  }

  async activateSmartGraphView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_SMART_GRAPH)[0];
    if (!leaf) {
      const newLeaf = workspace.getLeaf("tab");
      await newLeaf.setViewState({
        type: VIEW_TYPE_SMART_GRAPH,
        active: true,
      });
      leaf = newLeaf;
    }
    workspace.revealLeaf(leaf);
  }
}