import * as SecureStore from 'expo-secure-store';
import { secureTokenStorage } from '../../src/services/auth/SecureTokenStorage';

beforeEach(() => jest.clearAllMocks());

const TOKENS = { accessToken: 'acc', refreshToken: 'ref', expiry: 9999999 };

describe('secureTokenStorage', () => {
    describe('saveToken', () => {
        it('calls SecureStore.setItemAsync with key and serialised tokens', async () => {
            await secureTokenStorage.saveToken('gmail', TOKENS);
            expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
                'integration_token_gmail',
                JSON.stringify(TOKENS),
                expect.objectContaining({ keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK })
            );
        });
    });

    describe('getToken', () => {
        it('returns null when nothing is stored', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
            const result = await secureTokenStorage.getToken('gmail');
            expect(result).toBeNull();
        });

        it('returns parsed tokens when stored', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify(TOKENS));
            const result = await secureTokenStorage.getToken('gmail');
            expect(result).toEqual(TOKENS);
        });

        it('returns null when stored value is invalid JSON', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('NOT_JSON');
            const result = await secureTokenStorage.getToken('gmail');
            expect(result).toBeNull();
        });

        it('uses the correct key prefix', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
            await secureTokenStorage.getToken('calendar');
            expect(SecureStore.getItemAsync).toHaveBeenCalledWith('integration_token_calendar');
        });
    });

    describe('deleteToken', () => {
        it('calls SecureStore.deleteItemAsync with the correct key', async () => {
            await secureTokenStorage.deleteToken('github');
            expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('integration_token_github');
        });
    });
});
