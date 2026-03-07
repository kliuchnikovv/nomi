/**
 * iOS Contacts Client
 * Uses React Native module to access Contacts Framework
 */

import { NativeModules, Platform } from 'react-native';
import { ragApi } from '../../../apiClient';

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
     * Check current permission status for Contacts access
     */
    async checkPermissionStatus(): Promise<'authorized' | 'denied' | 'notDetermined'> {
        if (!IOSContactsManager) {
            throw new Error('IOSContactsManager is not available.');
        }

        try {
            const status: string = await IOSContactsManager.checkPermissionStatus();
            return status as 'authorized' | 'denied' | 'notDetermined';
        } catch (error) {
            console.error('[IOSContactsClient] checkPermissionStatus error:', error);
            throw error;
        }
    }

    /**
     * Request permission to access Contacts
     * @returns true if permission granted, false if denied
     */
    async requestPermission(): Promise<boolean> {
        if (!IOSContactsManager) {
            throw new Error('IOSContactsManager is not available.');
        }

        try {
            const granted: boolean = await IOSContactsManager.requestPermission();
            return granted;
        } catch (error) {
            console.error('[IOSContactsClient] requestPermission error:', error);
            throw error;
        }
    }

    /**
     * Open iOS Settings app to manage Contacts permissions
     */
    async openSettings(): Promise<void> {
        if (!IOSContactsManager) {
            throw new Error('IOSContactsManager is not available.');
        }

        try {
            await IOSContactsManager.openSettings();
        } catch (error) {
            console.error('[IOSContactsClient] openSettings error:', error);
            throw error;
        }
    }

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
     * Index contacts into backend RAG store
     */
    async indexForRAG(integrationId: string): Promise<void> {
        if (Platform.OS !== 'ios') {
            console.warn('[IOSContactsClient] RAG indexing is iOS only');
            return;
        }

        try {
            const contacts = await this.searchContacts('', 500);

            for (const contact of contacts) {
                const fullName = [contact.givenName, contact.familyName].filter(Boolean).join(' ');
                let content = `Contact: ${fullName}.`;
                if (contact.organization) content += ` Works at ${contact.organization}.`;
                if (contact.jobTitle) content += ` Position: ${contact.jobTitle}.`;
                if (contact.phoneNumbers.length > 0) content += ` Phones: ${contact.phoneNumbers.map(p => p.value).join(', ')}.`;
                if (contact.emailAddresses.length > 0) content += ` Emails: ${contact.emailAddresses.map(e => e.value).join(', ')}.`;

                await ragApi.index({
                    id: `ios_contacts_${integrationId}_${contact.id}`,
                    source_type: 'ios_contact',
                    content,
                    metadata: { integrationId, contactId: contact.id },
                });
            }

            console.log(`[IOSContactsClient] Indexed ${contacts.length} contacts for RAG`);
        } catch (error) {
            console.error('[IOSContactsClient] indexForRAG error:', error);
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
