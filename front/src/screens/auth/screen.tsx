import React, { useState, useRef } from 'react';
import { View, Text, TextInput, Pressable, Keyboard, KeyboardAvoidingView, ScrollView, Platform } from 'react-native';
import { useAuth } from './context.tsx';
import { styles } from './styles.tsx';

export function AuthScreen() {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [focusedInput, setFocusedInput] = useState<string | null>(null);
    const { login, register, signInWithGoogle } = useAuth();

    const emailInputRef = useRef<TextInput>(null);
    const passwordInputRef = useRef<TextInput>(null);

    const handleAuth = () => {
        Keyboard.dismiss();
        if (isLogin) {
            login(email, password);
        } else {
            register(email, password, name);
        }
    };

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
            <ScrollView
                contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <Text style={styles.logo}>Genie</Text>
                <Text style={styles.subtitle}>Your AI Assistant</Text>

                <View style={styles.formContainer}>
                    {/* Name Input (Register only) */}
                    {!isLogin && (
                        <View style={styles.inputContainer}>
                            <Text style={styles.label}>Name</Text>
                            <TextInput
                                style={[
                                    styles.input,
                                    focusedInput === 'name' && styles.inputFocused,
                                ]}
                                placeholder="Enter your name"
                                placeholderTextColor="rgba(192, 202, 245, 0.4)"
                                value={name}
                                onChangeText={setName}
                                textContentType="name"
                                autoComplete="name"
                                onFocus={() => setFocusedInput('name')}
                                onBlur={() => setFocusedInput(null)}
                                returnKeyType="next"
                                onSubmitEditing={() => emailInputRef.current?.focus()}
                                blurOnSubmit={false}
                            />
                        </View>
                    )}

                    {/* Email Input */}
                    <View style={styles.inputContainer}>
                        <Text style={styles.label}>Email</Text>
                        <TextInput
                            ref={emailInputRef}
                            style={[
                                styles.input,
                                focusedInput === 'email' && styles.inputFocused,
                            ]}
                            placeholder="Enter your email"
                            placeholderTextColor="rgba(192, 202, 245, 0.4)"
                            value={email}
                            onChangeText={setEmail}
                            autoCapitalize="none"
                            keyboardType="email-address"
                            textContentType="username"
                            autoComplete="username"
                            importantForAutofill="yes"
                            onFocus={() => setFocusedInput('email')}
                            onBlur={() => setFocusedInput(null)}
                            returnKeyType="next"
                            onSubmitEditing={() => passwordInputRef.current?.focus()}
                            blurOnSubmit={false}
                        />
                    </View>

                    {/* Password Input */}
                    <View style={styles.inputContainer}>
                        <Text style={styles.label}>Password</Text>
                        <TextInput
                            ref={passwordInputRef}
                            style={[
                                styles.input,
                                focusedInput === 'password' && styles.inputFocused,
                            ]}
                            placeholder="Enter your password"
                            placeholderTextColor="rgba(192, 202, 245, 0.4)"
                            value={password}
                            onChangeText={setPassword}
                            secureTextEntry
                            textContentType={isLogin ? 'password' : 'newPassword'}
                            autoComplete={isLogin ? 'password' : 'password-new'}
                            importantForAutofill="yes"
                            passwordRules="minlength: 8; required: lower; required: upper; required: digit; required: [-];"
                            onFocus={() => setFocusedInput('password')}
                            onBlur={() => setFocusedInput(null)}
                            returnKeyType="done"
                            onSubmitEditing={handleAuth}
                        />
                    </View>

                    {/* Submit Button */}
                    <Pressable
                        style={({ pressed }) => [
                            styles.button,
                            pressed && styles.buttonPressed,
                        ]}
                        onPress={handleAuth}
                    >
                        <Text style={styles.buttonText}>
                            {isLogin ? 'Login' : 'Create Account'}
                        </Text>
                    </Pressable>

                    {/* Google Sign-In Button */}
                    <Pressable
                        style={({ pressed }) => [
                            styles.googleButton,
                            pressed && styles.googleButtonPressed,
                        ]}
                        onPress={async () => {
                            Keyboard.dismiss();
                            try {
                                await signInWithGoogle();
                            } catch (error) {
                                console.error("Google sign-in error:", error);
                                // Optionally, display an error message to the user
                            }
                        }}
                    >
                        <Text style={styles.googleButtonText}>
                            Continue with Google
                        </Text>
                    </Pressable>

                    {/* Toggle Login/Register Mode */}
                    <Pressable
                        style={styles.switchButton}
                        onPress={() => setIsLogin(!isLogin)}
                    >
                        <Text style={styles.switchButtonText}>
                            {isLogin
                                ? "Don't have an account? Register"
                                : 'Already have an account? Login'}
                        </Text>
                    </Pressable>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}
