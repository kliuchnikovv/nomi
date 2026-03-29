import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaultThemeName, themes, ThemeName, ThemeColors, ThemeEffects, ThemePalette } from '../themes';

interface ThemeContextType {
    theme: ThemeColors;
    palette: ThemePalette;
    effects: ThemeEffects | undefined;
    themeName: ThemeName;
    setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [themeName, setThemeName] = useState<ThemeName>(defaultThemeName);

    useEffect(() => {
        const loadTheme = async () => {
            try {
                const storedTheme = await AsyncStorage.getItem('app_theme');
                if (storedTheme && themes[storedTheme as ThemeName]) {
                    setThemeName(storedTheme as ThemeName);
                }
            } catch (error) {
                console.error('Failed to load theme', error);
            }
        };
        loadTheme();
    }, []);

    const setTheme = async (name: ThemeName) => {
        try {
            setThemeName(name);
            await AsyncStorage.setItem('app_theme', name);
        } catch (error) {
            console.error('Failed to save theme', error);
        }
    };

    const value = {
        theme: themes[themeName].colors,
        palette: themes[themeName].palette,
        effects: themes[themeName].effects,
        themeName,
        setTheme,
    };

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
