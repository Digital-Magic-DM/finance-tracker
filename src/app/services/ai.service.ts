import { Injectable, signal } from '@angular/core';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable({ providedIn: 'root' })
export class AiService {
  isChatOpen = signal(false);
  hasApiKey = signal(false);

  constructor() {
    if (typeof localStorage !== 'undefined') {
      this.hasApiKey.set(!!localStorage.getItem('fintracker_gemini_key'));
    }
  }

  toggleChat() {
    this.isChatOpen.update((v) => !v);
  }

  closeChat() {
    this.isChatOpen.set(false);
  }

  getApiKey(): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('fintracker_gemini_key');
    }
    return null;
  }

  setApiKey(key: string) {
    if (typeof localStorage !== 'undefined') {
      if (key) {
        localStorage.setItem('fintracker_gemini_key', key);
        this.hasApiKey.set(true);
      } else {
        localStorage.removeItem('fintracker_gemini_key');
        this.hasApiKey.set(false);
      }
    }
  }

  getSavedModel(): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('fintracker_gemini_model');
    }
    return null;
  }

  setSavedModel(model: string) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('fintracker_gemini_model', model);
    }
  }

  async chatWithData(userMessage: string, contextData: any): Promise<string> {
    const key = this.getApiKey();
    if (!key) {
      throw new Error('No API Key found. Please add your Gemini API Key in Settings.');
    }

    const genAI = new GoogleGenerativeAI(key);

    const systemPrompt = `
You are FinTracker AI, an elite, highly secure, no-nonsense financial advisor built exclusively for the FinTracker app.
CRITICAL RULES:
1. You MUST ONLY discuss finance, the user's portfolio, investments, transactions, and Systematic Investment Plans (SIPs).
2. If the user asks ANY question not related to finance, wealth, or the provided data, politely but firmly refuse to answer. Do not write code or answer general trivia.
3. Your analysis must rely primarily on the exact JSON data provided below.
4. Always use plain text or markdown formatting. 
5. Keep answers short, structured, impactful, and brutalist. NO FLUFF.
6. Do not merely repeat the raw data; synthesize it into actionable insights.
7. Understand real-world SIP mechanisms: SIP installments only execute on open stock market trading days (NSE/BSE). If a user's SIP due date falls on a weekend or market holiday, it is automatically rolled over to the next open business day.

Current Full Financial Context (Assets, Transactions, and Active SIP Commitments):
${JSON.stringify(contextData, null, 2)}
`;

    const fullPrompt = `${systemPrompt}\n\nUser Question: ${userMessage}`;

    const preferredModel = this.getSavedModel() || 'auto';
    const modelsToTry = preferredModel === 'auto' 
      ? ["gemini-3.1-pro-preview", "gemini-3.1-flash-lite-preview", "gemini-2.5-flash", "gemini-2.0-flash"]
      : [preferredModel];

    let lastError: any = null;
    let significantError: any = null;

    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        return response.text();
      } catch (error: any) {
        lastError = error;
        const msg = error?.message || '';
        
        // Save the first significant error (like 503 Overloaded or 429 Quota) to show the user if all fallbacks run out of options
        if (!msg.includes('not found') && !msg.includes('404') && !significantError) {
            significantError = error;
        }

        // If the specific model is not found/supported/503/429 AND we are on auto fallback, silently try the next
        const shouldFallback = msg.includes('not found') || msg.includes('404') || msg.includes('503') || msg.includes('high demand') || msg.includes('429') || msg.includes('quota') || msg.includes('exhausted');

        if (preferredModel === 'auto' && shouldFallback) {
           console.warn(`Model ${modelName} unavailable or out of quota, falling back to next...`);
           continue;
        } else {
           // For Auth issues, invalid keys, or if a user specifically chose a model that failed -> throw immediately
           console.error(`Gemini AI API Error [${modelName}]:`, error);
           throw new Error(error?.message || `Failed to generate response using ${modelName}. Check your API key or model availability.`);
        }
      }
    }

    // Prioritize throwing the 503 or 429 error rather than a 404 from the final fallback component
    throw new Error(significantError?.message || lastError?.message || 'All model fallbacks failed. Check your API key.');
  }
}
