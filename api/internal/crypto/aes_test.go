package crypto

import (
	"encoding/hex"
	"testing"
)

func TestEncryptDecryptRoundtrip(t *testing.T) {
	// Generate a valid 32-byte key (256 bits for AES-256)
	keyHex := "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		t.Fatalf("Failed to decode key: %v", err)
	}

	plaintext := []byte("Hello, World! This is a secret message.")

	// Encrypt
	ciphertext, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// Decrypt should restore original
	decrypted, err := Decrypt(key, ciphertext)
	if err != nil {
		t.Fatalf("Decrypt failed: %v", err)
	}

	if string(decrypted) != string(plaintext) {
		t.Errorf("Decrypted message doesn't match. Got %q, want %q", decrypted, plaintext)
	}
}

func TestEncryptProducesUniqueOutput(t *testing.T) {
	keyHex := "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		t.Fatalf("Failed to decode key: %v", err)
	}

	plaintext := []byte("Same message encrypted twice")

	ciphertext1, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("First Encrypt failed: %v", err)
	}

	ciphertext2, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Second Encrypt failed: %v", err)
	}

	// GCM uses a random nonce, so outputs should differ
	if string(ciphertext1) == string(ciphertext2) {
		t.Error("Encrypt produced identical output twice - nonce may not be random")
	}

	// But both should decrypt to the same plaintext
	decrypted1, err := Decrypt(key, ciphertext1)
	if err != nil {
		t.Fatalf("Decrypt of ciphertext1 failed: %v", err)
	}

	decrypted2, err := Decrypt(key, ciphertext2)
	if err != nil {
		t.Fatalf("Decrypt of ciphertext2 failed: %v", err)
	}

	if string(decrypted1) != string(plaintext) || string(decrypted2) != string(plaintext) {
		t.Error("Decrypted outputs don't match original plaintext")
	}
}

func TestDecryptBadKey(t *testing.T) {
	key1Hex := "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
	key2Hex := "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100"

	key1, err := hex.DecodeString(key1Hex)
	if err != nil {
		t.Fatalf("Failed to decode key1: %v", err)
	}

	key2, err := hex.DecodeString(key2Hex)
	if err != nil {
		t.Fatalf("Failed to decode key2: %v", err)
	}

	plaintext := []byte("Secret message")

	ciphertext, err := Encrypt(key1, plaintext)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// Decrypting with wrong key should fail
	_, err = Decrypt(key2, ciphertext)
	if err == nil {
		t.Error("Decrypt with wrong key succeeded, should have failed")
	}
}

func TestDecryptInvalidCiphertext(t *testing.T) {
	keyHex := "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		t.Fatalf("Failed to decode key: %v", err)
	}

	// Invalid ciphertext - too short
	shortCiphertext := []byte("too short")

	_, err = Decrypt(key, shortCiphertext)
	if err == nil {
		t.Error("Decrypt with invalid ciphertext succeeded, should have failed")
	}
}

func TestEncryptInvalidKeyLength(t *testing.T) {
	// AES-256 requires 32-byte key
	shortKey := []byte("short")

	plaintext := []byte("message")

	_, err := Encrypt(shortKey, plaintext)
	if err == nil {
		t.Error("Encrypt with short key succeeded, should have failed")
	}
}
