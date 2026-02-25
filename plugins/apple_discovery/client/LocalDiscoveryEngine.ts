import { apple } from '@react-native-ai/apple';
import { generateText } from 'ai';

interface ToolCatalogEntry {
  display_name: string;
  description: string;
  methods?: Array<{ name: string; description?: string }>;
}

interface ToolCatalog {
  [name: string]: ToolCatalogEntry;
}

const DISCOVERY_PROMPT = `You are a tool selection assistant. Given the list of available tools and the user's request, select the tool names that are most relevant to fulfilling the request.

Available tools:
{catalog}

User request: {query}

Return ONLY a JSON array of tool names from the list. Return at most 5 tools.
Return [] if no tools are relevant.
Example: ["gmail", "ios_calendar"]

Respond with JSON array only, no extra text.`;

export class LocalDiscoveryEngine {
  async discoverTools(query: string, catalog: ToolCatalog): Promise<string[]> {
    try {
      const prompt = this.buildPrompt(query, catalog);
      
      const result = await generateText({
        model: apple(),
        prompt,
        temperature: 0.1,
      });

      return this.parseToolsList(result.text);
    } catch (error) {
      console.error('[LocalDiscoveryEngine] Error:', error);
      return [];
    }
  }

  private buildPrompt(query: string, catalog: ToolCatalog): string {
    const catalogText = this.formatCatalog(catalog);
    return DISCOVERY_PROMPT
      .replace('{catalog}', catalogText)
      .replace('{query}', query);
  }

  private formatCatalog(catalog: ToolCatalog): string {
    const lines: string[] = [];
    for (const [name, entry] of Object.entries(catalog)) {
      const methodNames = (entry.methods || [])
        .map(m => m.name)
        .filter(Boolean)
        .join(', ');
      
      lines.push(`- ${name}: ${entry.description}`);
      if (methodNames) {
        lines.push(`  Methods: ${methodNames}`);
      }
    }
    return lines.join('\n');
  }

  private parseToolsList(text: string): string[] {
    const match = text.match(/\[.*?\]/s);
    if (!match) {
      console.warn('[LocalDiscoveryEngine] No JSON array found in response');
      return [];
    }
    
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        return parsed.filter(item => typeof item === 'string');
      }
      return [];
    } catch (error) {
      console.error('[LocalDiscoveryEngine] Failed to parse JSON:', error);
      return [];
    }
  }
}
