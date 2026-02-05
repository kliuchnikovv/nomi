
import { Platform } from 'react-native';

const LOG_TAG = '[AppleIntelligence]';

export interface AIResponse {
    text: string;
}

export class AppleIntelligence {
    static isAvailable(): boolean {
        return Platform.OS === 'ios';
    }

    static async generate(prompt: string): Promise<string> {
        if (!this.isAvailable()) {
            throw new Error('Apple Intelligence is only available on iOS');
        }

        try {
            console.log(LOG_TAG, 'Loading Apple FM...');
            const { apple } = require('@react-native-ai/apple');
            const { generateText } = require('ai');

            console.log(LOG_TAG, 'Generating text...');
            const result = await generateText({
                model: apple(),
                prompt,
            });

            const text = (result as { text?: string })?.text?.trim();
            if (!text) {
                throw new Error('Empty result from Apple FM');
            }
            return text;
        } catch (e) {
            console.error(LOG_TAG, 'Error generating text:', e);
            throw e;
        }
    }
}
