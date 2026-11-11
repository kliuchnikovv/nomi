import React from 'react';
import type { Preview } from '@storybook/react';

import { darkMinimalTheme } from '@nomi/front/themes/darkMinimal';
import { visualStudioLightTheme } from '@nomi/front/themes/visualStudioLight';
import { tokyoNightTheme } from '@nomi/front/themes/tokyoNight';
import { retroSunsetTheme } from '@nomi/front/themes/retroSunset';
import type { ThemeDescriptor } from '@nomi/front/themes/types';

const themes: Record<string, ThemeDescriptor> = {
    darkMinimal: darkMinimalTheme,
    visualStudioLight: visualStudioLightTheme,
    tokyoNight: tokyoNightTheme,
    retroSunset: retroSunsetTheme,
};

const preview: Preview = {
    globalTypes: {
        theme: {
            description: 'Active theme descriptor',
            defaultValue: 'darkMinimal',
            toolbar: {
                title: 'Theme',
                icon: 'paintbrush',
                items: Object.keys(themes),
            },
        },
    },
    decorators: [
        (Story, ctx) => {
            const key = (ctx.globals.theme as string) || 'darkMinimal';
            const t = themes[key] ?? darkMinimalTheme;
            return (
                <div
                    style={{
                        background: t.colors.background,
                        color: t.colors.textPrimary,
                        padding: 24,
                        minHeight: '100vh',
                        fontFamily: t.typography.body.fontFamily,
                    }}
                >
                    <Story args={{ ...ctx.args, theme: t }} />
                </div>
            );
        },
    ],
};

export default preview;
