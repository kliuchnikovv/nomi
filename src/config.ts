import AsyncStorage from '@react-native-async-storage/async-storage';

export const PROD_API_ENDPOINT = 'https://disciplined-quietude-production-f4b1.up.railway.app';
export const DEV_API_ENDPOINT = 'http://localhost:3000'; // Or your local dev endpoint

export const getApiEndpoint = async (): Promise<string> => {
  try {
    const isProd = await AsyncStorage.getItem('isProd');
    return isProd === 'true' ? PROD_API_ENDPOINT : DEV_API_ENDPOINT;
  } catch (e) {
    // Handle error
    return DEV_API_ENDPOINT;
  }
};
