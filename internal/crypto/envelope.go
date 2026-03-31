package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
)

// aes-256-gcm envelope encryption; each user has a DEK encrypted by the MEK
type EnvelopeCrypto struct {
	mek []byte
}

// creates an EnvelopeCrypto from a hex-encoded 256-bit master key
func New(mekHex string) (*EnvelopeCrypto, error) {
	mek, err := hex.DecodeString(mekHex)
	if err != nil {
		return nil, fmt.Errorf("decode MEK: %w", err)
	}
	if len(mek) != 32 {
		return nil, fmt.Errorf("MEK must be 32 bytes (64 hex chars), got %d bytes", len(mek))
	}
	return &EnvelopeCrypto{mek: mek}, nil
}

// generates a random DEK; returns plaintext and encrypted forms
func (e *EnvelopeCrypto) GenerateDEK() (plainDEK, encryptedDEK, nonce []byte, err error) {
	plainDEK = make([]byte, 32)
	if _, err = io.ReadFull(rand.Reader, plainDEK); err != nil {
		return nil, nil, nil, fmt.Errorf("generate DEK: %w", err)
	}
	encryptedDEK, nonce, err = e.seal(e.mek, plainDEK)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("encrypt DEK: %w", err)
	}
	return plainDEK, encryptedDEK, nonce, nil
}

// decrypts a stored DEK using the MEK
func (e *EnvelopeCrypto) DecryptDEK(encryptedDEK, nonce []byte) ([]byte, error) {
	plainDEK, err := e.open(e.mek, encryptedDEK, nonce)
	if err != nil {
		return nil, fmt.Errorf("decrypt DEK: %w", err)
	}
	return plainDEK, nil
}

// encrypts plaintext with the DEK; returns ciphertext and nonce
func (e *EnvelopeCrypto) Encrypt(dek, plaintext []byte) (ciphertext, nonce []byte, err error) {
	return e.seal(dek, plaintext)
}

// decrypts ciphertext with the DEK and nonce
func (e *EnvelopeCrypto) Decrypt(dek, ciphertext, nonce []byte) ([]byte, error) {
	return e.open(dek, ciphertext, nonce)
}

// generates a random MEK as a hex string; use once during server setup
func GenerateMEK() (string, error) {
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return "", fmt.Errorf("generate MEK: %w", err)
	}
	return hex.EncodeToString(key), nil
}

func (e *EnvelopeCrypto) seal(key, plaintext []byte) (ciphertext, nonce []byte, err error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, err
	}
	ciphertext = gcm.Seal(nil, nonce, plaintext, nil)
	return ciphertext, nonce, nil
}

func (e *EnvelopeCrypto) open(key, ciphertext, nonce []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt: authentication failed")
	}
	return plaintext, nil
}
