<script lang="ts">
  import { getPlugin } from "../../stores/state.svelte";
  import { Setting } from "obsidian";

  // Plugin-Instanz abrufen
  const plugin = getPlugin();

  // Reaktive Bindung der Einstellungen
  $: useMistral = plugin.settings.useMistral;
  $: mistralApiKey = plugin.settings.mistralApiKey;
  $: mistralModel = plugin.settings.mistralModel;

  // Speichern der Einstellungen
  async function saveSettings() {
    await plugin.saveSettings();
  }
</script>

<div class="mistral-settings-container">
  <h3>Mistral API Configuration</h3>

  <div class="setting-item">
    <label>Enable Mistral API</label>
    <div class="setting-toggle">
      <input
        type="checkbox"
        bind:checked={useMistral}
        on:change={saveSettings}
      />
    </div>
  </div>

  <div class="setting-item">
    <label>Mistral API Key</label>
    <div class="setting-input">
      <input
        type="password"
        bind:value={mistralApiKey}
        on:change={saveSettings}
        placeholder="Your Mistral API key"
      />
    </div>
  </div>

  <div class="setting-item">
    <label>Mistral Model</label>
    <div class="setting-dropdown">
      <select bind:value={mistralModel} on:change={saveSettings}>
        <option value="mistral-tiny">mistral-tiny (fastest)</option>
        <option value="mistral-small">mistral-small (balanced)</option>
        <option value="mistral-medium">mistral-medium (most capable)</option>
      </select>
    </div>
  </div>
</div>

<style>
  .mistral-settings-container {
    padding: 1rem;
    max-width: 100%;
  }

  .mistral-settings-container h3 {
    margin-top: 0;
    margin-bottom: 1.5rem;
    font-size: 1.2rem;
    color: var(--text-normal);
  }

  .setting-item {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .setting-item label {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-normal);
  }

  .setting-toggle input[type="checkbox"] {
    width: 1.2rem;
    height: 1.2rem;
  }

  .setting-input input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-secondary);
    color: var(--text-normal);
  }

  .setting-dropdown select {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-secondary);
    color: var(--text-normal);
  }
</style>