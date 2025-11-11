import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import { useAuth } from './context.tsx';
import { styles } from './styles.tsx'

export function AuthScreen() {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const { login, register } = useAuth();

    const handleAuth = () => {
        if (isLogin) {
            login(email, password);
        } else {
            register(email, name, password);
        }
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>{isLogin ? 'Login' : 'Register'}</Text>
            {!isLogin && (
                <TextInput
                    style={styles.input}
                    placeholder="Name"
                    value={name}
                    onChangeText={setName}
                />
            )}
            <TextInput
                style={styles.input}
                placeholder="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                textContentType="username"        // важно для iOS
                autoComplete="username"           // RN 0.70+
            />
            <TextInput
                style={styles.input}
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"        // или "newPassword" на экране регистрации
                autoComplete="password"
            />
            <Button title={isLogin ? 'Login' : 'Register'} onPress={handleAuth} />
            <Button
                title={isLogin ? 'Switch to Register' : 'Switch to Login'}
                onPress={() => setIsLogin(!isLogin)}
            />
        </View>
    );
}
