import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useAuth } from './context.tsx';
import { styles } from './styles.tsx';

export function AuthScreen() {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [focusedInput, setFocusedInput] = useState<string | null>(null);
    const { login, register, signInWithGoogle } = useAuth();

    const handleAuth = () => {
        if (isLogin) {
            login(email, password);
        } else {
            register(email, name, password);
        }
    };

    return (
        <View style={styles.container}>
            <Text style={styles.logo}>Genie</Text>
            <Text style={styles.subtitle}>Your AI Assistant</Text>

            <View style={styles.formContainer}>
                {/* Tab Selector */}
                <View style={styles.tabContainer}>
                    <Pressable
                        style={[styles.tab, isLogin && styles.tabActive]}
                        onPress={() => setIsLogin(true)}
                    >
                        <Text style={[styles.tabText, isLogin && styles.tabTextActive]}>
                            Login
                        </Text>
                    </Pressable>
                    <Pressable
                        style={[styles.tab, !isLogin && styles.tabActive]}
                        onPress={() => setIsLogin(false)}
                    >
                        <Text style={[styles.tabText, !isLogin && styles.tabTextActive]}>
                            Register
                        </Text>
                    </Pressable>
                </View>

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
                            onFocus={() => setFocusedInput('name')}
                            onBlur={() => setFocusedInput(null)}
                        />
                    </View>
                )}

                {/* Email Input */}
                <View style={styles.inputContainer}>
                    <Text style={styles.label}>Email</Text>
                    <TextInput
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
                        onFocus={() => setFocusedInput('email')}
                        onBlur={() => setFocusedInput(null)}
                    />
                </View>

                {/* Password Input */}
                <View style={styles.inputContainer}>
                    <Text style={styles.label}>Password</Text>
                    <TextInput
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
                        autoComplete="password"
                        onFocus={() => setFocusedInput('password')}
                        onBlur={() => setFocusedInput(null)}
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

                {/* Divider */}
                <View style={styles.divider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>or</Text>
                    <View style={styles.dividerLine} />
                </View>

                {/* Google Sign-In Button */}
                <Pressable
                    style={({ pressed }) => [
                        styles.googleButton,
                        pressed && styles.googleButtonPressed,
                    ]}
                    onPress={signInWithGoogle}
                >
                    <Text style={styles.googleButtonText}>
                        Continue with Google
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}
