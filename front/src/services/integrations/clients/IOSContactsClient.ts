/**
 * iOS Contacts Client
 * Uses React Native module to access Contacts Framework
 */

import { NativeModules, Platform } from 'react-native';

const { IOSContactsManager } = NativeModules;

export interface PhoneNumber {
    label: string;
    value: string;
}

export interface EmailAddress {
    label: string;
    value: string;
}

export interface PostalAddress {
    label: string;
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
}

export interface Contact {
    id: string;
    givenName?: string;
    familyName?: string;
    middleName?: string;
    nickname?: string;
    organization?: string;
    jobTitle?: string;
    phoneNumbers: PhoneNumber[];
    emailAddresses: EmailAddress[];
    postalAddresses: PostalAddress[];
    notes?: string;
    url?: string;
    birthday?: string;
    imageData?: string;
    thumbnailImageData?: string;
}

export interface ContactGroup {
    id: string;
    name: string;
}

class IOSContactsClient {
    /**
     * Search contacts by name, email, or phone
     */
    async searchContacts(query: string, limit: number = 10): Promise<Contact[]> {
        if (!IOSContactsManager) {
            throw new Error('IOSContactsManager is not available. Make sure iOS native module is properly linked.');
        }

        try {
            const contacts: Contact[] = await IOSContactsManager.searchContacts(query, limit);
            return contacts;
        } catch (error) {
            console.error('[IOSContactsClient] searchContacts error:', error);
            throw error;
        }
    }

    /**
     * Get contact details by identifier
     */
    async getContact(id: string): Promise<Contact> {
        if (!IOSContactsManager) {
            throw new Error('IOSContactsManager is not available.');
        }

        const contact = await IOSContactsManager.getContact(id);
        return contact;
    }

    /**
     * Create a new contact
     */
    async createContact(contactData: Partial<Contact>): Promise<Contact> {
        if (!IOSContactsManager) {
            throw new Error('IOSContactsManager is not available.');
        }

        const contact = await IOSContactsManager.createContact(contactData);
        return contact;
    }

    /**
     * Update an existing contact
     */
    async updateContact(id: string, updates: Partial<Contact>): Promise<Contact> {
        if (!IOSContactsManager) {
            throw new Error('IOSContactsManager is not available.');
        }

        const contact = await IOSContactsManager.updateContact(id, updates);
        return contact;
    }

    /**
     * Delete a contact
     */
    async deleteContact(id: string): Promise<void> {
        if (!IOSContactsManager) {
            throw new Error('IOSContactsManager is not available.');
        }

        await IOSContactsManager.deleteContact(id);
    }

    /**
     * Get list of contact groups
     */
    async getGroups(): Promise<ContactGroup[]> {
        if (!IOSContactsManager) {
            throw new Error('IOSContactsManager is not available.');
        }

        const groups = await IOSContactsManager.getGroups();
        return groups;
    }

    /**
     * Index contacts for RAG (Retrieval-Augmented Generation)
     */
    async indexForRAG(integrationId: string): Promise<void> {
        if (Platform.OS !== 'ios') {
            console.warn('[IOSContactsClient] RAG indexing is iOS only');
            return;
        }

        try {
            const { VectorStore } = await import('@genie/front/services/database/VectorStore');
            const vectorStore = new VectorStore();

            const contacts = await this.searchContacts('', 500);

            for (const contact of contacts) {
                const fullName = [contact.givenName, contact.familyName].filter(Boolean).join(' ');

                let content = `Contact: ${fullName}. `;
                if (contact.organization) content += `Works at ${contact.organization}. `;
                if (contact.jobTitle) content += `Position: ${contact.jobTitle}. `;

                if (contact.phoneNumbers.length > 0) {
                    content += `Phones: ${contact.phoneNumbers.map(p => p.value).join(', ')}. `;
                }
                if (contact.emailAddresses.length > 0) {
                    content += `Emails: ${contact.emailAddresses.map(e => e.value).join(', ')}. `;
                }
                if (contact.notes) content += `Notes: ${contact.notes}. `;

                await vectorStore.addDocument({
                    id: `ios_contacts_${integrationId}_${contact.id}`,
                    sourceType: 'ios_contact',
                    content,
                    metadata: {
                        integrationId,
                        contactId: contact.id,
                        givenName: contact.givenName,
                        familyName: contact.familyName,
                        organization: contact.organization,
                        jobTitle: contact.jobTitle,
                        emailAddresses: contact.emailAddresses.map(e => e.value),
                        phoneNumbers: contact.phoneNumbers.map(p => p.value)
                    }
                });
            }

            console.log(`[IOSContactsClient] Indexed ${contacts.length} contacts for RAG`);
        } catch (error) {
            console.error('[IOSContactsClient] indexForRAG error:', error);
        }
    }

    /**
     * Search in RAG indexed contacts
     */
    async searchInRAG(query: string, integrationId?: string): Promise<any[]> {
        if (Platform.OS !== 'ios') {
            return [];
        }

        try {
            const { VectorStore } = await import('@genie/front/services/database/VectorStore');
            const vectorStore = new VectorStore();

            const sourceType = integrationId ? `ios_contact_${integrationId}` : 'ios_contact';
            const results = await vectorStore.search(query, 5, sourceType);

            return results;
        } catch (error) {
            console.error('[IOSContactsClient] searchInRAG error:', error);
            return [];
        }
    }

    /**
     * Background task handler for contacts sync
     */
    async onWake(integrationId: string): Promise<void> {
        await this.indexForRAG(integrationId);
    }
}

export const iosContactsClient = new IOSContactsClient();

export { IOSContactsClient };
