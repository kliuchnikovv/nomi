/**
 * iOS Contacts client plugin: executes iOS Contacts tool actions via Contacts Framework.
 */

import type { ClientPluginHandler } from '@nomi/front/plugins/clientRegistry';
import { IOSContactsClient } from '@nomi/front/services/integrations/clients/IOSContactsClient';

export const iosContactsPlugin: ClientPluginHandler = {
    async execute(method: string, params: Record<string, any>): Promise<string> {
        const client = new IOSContactsClient();

        // Check permissions before executing any method
        const permissionStatus = await client.checkPermissionStatus();

        if (permissionStatus === 'notDetermined') {
            // Request permission
            const granted = await client.requestPermission();
            if (!granted) {
                return 'Please grant access to Contacts in the system settings to use this feature.';
            }
        } else if (permissionStatus === 'denied') {
            return 'Contacts access is denied. Please enable it in iOS Settings > Nomi > Contacts.';
        }

        // Permission granted, proceed with the method
        switch (method) {
            case 'search_contacts':
                const contacts = await client.searchContacts(
                    params.query,
                    params.limit
                );
                return `<details><summary>Contacts matching "${params.query}"</summary>\n\n\`\`\`json\n${JSON.stringify(contacts, null, 2)}\n\`\`\`\n</details>`;

            case 'get_contact':
                const contact = await client.getContact(params.id);
                return `<details><summary>Contact Details</summary>\n\n\`\`\`json\n${JSON.stringify(contact, null, 2)}\n\`\`\`\n</details>`;

            case 'create_contact':
                const created = await client.createContact({
                    givenName: params.given_name,
                    familyName: params.family_name,
                    middleName: params.middle_name,
                    nickname: params.nickname,
                    organization: params.organization,
                    jobTitle: params.job_title,
                    phoneNumbers: params.phone_numbers,
                    emailAddresses: params.email_addresses,
                    postalAddresses: params.postal_addresses,
                    notes: params.notes,
                    url: params.url,
                    birthday: params.birthday,
                    imageData: params.image_data
                });
                return `Contact created: ${created.givenName} ${created.familyName}`;

            case 'update_contact':
                const updated = await client.updateContact(
                    params.id,
                    {
                        givenName: params.given_name,
                        familyName: params.family_name,
                        middleName: params.middle_name,
                        nickname: params.nickname,
                        organization: params.organization,
                        jobTitle: params.job_title,
                        phoneNumbers: params.phone_numbers,
                        emailAddresses: params.email_addresses,
                        postalAddresses: params.postal_addresses,
                        notes: params.notes,
                        url: params.url,
                        birthday: params.birthday,
                        imageData: params.image_data
                    }
                );
                return `Contact updated: ${updated.givenName} ${updated.familyName}`;

            case 'delete_contact':
                await client.deleteContact(params.id);
                return `Contact deleted: ${params.id}`;

            case 'get_groups':
                const groups = await client.getGroups();
                return `<details><summary>Contact Groups</summary>\n\n\`\`\`json\n${JSON.stringify(groups, null, 2)}\n\`\`\`\n</details>`;

            default:
                throw new Error(`Unknown iOS Contacts method: ${method}`);
        }
    },
};
