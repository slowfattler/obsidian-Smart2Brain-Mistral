// src/llm/mistral.ts
import { LLM } from "../interfaces/llm";

// Interface für die Mistral-API-Antwort
interface MistralResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  error?: {
    message: string;
    type: string;
    code: string;
  };
}

// Interface für die Mistral-Konfiguration
interface MistralConfig {
  apiKey: string;
  model: string;
  apiUrl?: string; // Optional: Falls die API-URL angepasst werden soll
}

export class MistralLLM implements LLM {
  private config: MistralConfig;

  constructor(apiKey: string, model: string = "mistral-tiny", apiUrl: string = "https://api.mistral.ai/v1") {
    this.config = {
      apiKey,
      model,
      apiUrl,
    };
  }

  /**
   * Generiert eine Antwort von der Mistral-API.
   * @param prompt Der Eingabetext für das Modell.
   * @returns Die generierte Antwort als String.
   * @throws Error bei API-Fehlern oder ungültigen Antworten.
   */
  async generate(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.config.apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: "user", content: prompt }],
          stream: false, // Streaming deaktiviert (kann bei Bedarf aktiviert werden)
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Mistral API error: ${response.status} ${response.statusText}\n` +
          (errorData.error?.message ? `Details: ${errorData.error.message}` : "")
        );
      }

      const data: MistralResponse = await response.json();
      if (!data.choices?.[0]?.message?.content) {
        throw new Error("Ungültige Antwort von der Mistral-API: Kein 'content' in der Antwort.");
      }

      return data.choices[0].message.content;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Mistral-API-Fehler: ${error.message}`);
      }
      throw new Error("Unbekannter Fehler bei der Mistral-API-Anfrage.");
    }
  }

  /**
   * Aktualisiert die API-Konfiguration (z. B. für dynamische Änderungen).
   * @param config Neue Konfiguration (apiKey, model, apiUrl).
   */
  updateConfig(config: Partial<MistralConfig>) {
    this.config = { ...this.config, ...config };
  }
}