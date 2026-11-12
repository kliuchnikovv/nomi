import * as SecureStore from 'expo-secure-store';
import { encrypt, decrypt, clearEncryptionKey } from '../../src/services/security/encryptionService';

beforeEach(() => jest.clearAllMocks());

describe('encrypt / decrypt', () => {
    it('returns empty string for empty input', async () => {
        expect(await encrypt('')).toBe('');
        expect(await decrypt('')).toBe('');
    });

    it('round-trips: decrypt(encrypt(text)) === text', async () => {
        const original = 'super secret token 123!';
        const ciphertext = await encrypt(original);
        expect(ciphertext).not.toBe(original);
        const recovered = await decrypt(ciphertext);
        expect(recovered).toBe(original);
    });

    it('produces different ciphertext for different plaintexts', async () => {
        const c1 = await encrypt('hello world padded text');
        const c2 = await encrypt('different message here');
        expect(c1).not.toBe(c2);
    });

    it('ciphertext is base64-encoded (no raw binary chars)', async () => {
        const ct = await encrypt('test value');
        expect(ct).toMatch(/^[A-Za-z0-9+/=]+$/);
    });
});

describe('clearEncryptionKey', () => {
    it('calls SecureStore.deleteItemAsync with the key alias', async () => {
        await clearEncryptionKey();
        expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('nomi_encryption_key');
    });
});
