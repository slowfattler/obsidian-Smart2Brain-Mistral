// src/interfaces/llm.ts
export interface LLM {
  generate(prompt: string): Promise<string>;
}