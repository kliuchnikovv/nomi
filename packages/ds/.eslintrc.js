module.exports = {
    root: true,
    extends: '@react-native',
    ignorePatterns: ['node_modules', 'storybook-static', '.storybook'],
    rules: {
        'no-restricted-imports': [
            'error',
            {
                patterns: [
                    {
                        group: [
                            '**/screens/**',
                            '**/context/**',
                            '**/navigation/**',
                            '**/store/**',
                            '**/services/**',
                            '@nomi/front/screens/**',
                            '@nomi/front/context/**',
                            '@nomi/front/navigation/**',
                            '@nomi/front/store/**',
                            '@nomi/front/services/**',
                            '@react-navigation/*',
                        ],
                        message:
                            'DS primitives must not depend on app state, navigation, or services. Keep them props-only.',
                    },
                ],
            },
        ],
        'no-restricted-syntax': [
            'error',
            {
                selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
                message:
                    'Do not hardcode hex colors in DS components. Use theme.colors.* tokens.',
            },
        ],
    },
    overrides: [
        {
            files: ['*.stories.@(ts|tsx)'],
            rules: {
                'no-restricted-syntax': 'off',
            },
        },
    ],
};
