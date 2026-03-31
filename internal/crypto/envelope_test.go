package crypto

import (
	"bytes"
	"testing"
)

func newTestCrypto(t *testing.T) *EnvelopeCrypto {
	t.Helper()
	mekHex, err := GenerateMEK()
	if err != nil {
		t.Fatalf("GenerateMEK: %v", err)
	}
	ec, err := New(mekHex)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return ec
}

func TestGenerateMEK(t *testing.T) {
	mek1, _ := GenerateMEK()
	mek2, _ := GenerateMEK()
	if mek1 == mek2 {
		t.Fatal("GenerateMEK returned identical keys")
	}
	if len(mek1) != 64 {
		t.Fatalf("expected 64 hex chars, got %d", len(mek1))
	}
}

func TestNewBadMEK(t *testing.T) {
	if _, err := New("tooshort"); err == nil {
		t.Fatal("expected error for short MEK")
	}
	if _, err := New("not-valid-hex!!!" + "0000000000000000000000000000000000000000000000000000000000000000"); err == nil {
		t.Fatal("expected error for non-hex MEK")
	}
}

func TestDEKRoundtrip(t *testing.T) {
	ec := newTestCrypto(t)

	plainDEK, encDEK, nonce, err := ec.GenerateDEK()
	if err != nil {
		t.Fatalf("GenerateDEK: %v", err)
	}

	decrypted, err := ec.DecryptDEK(encDEK, nonce)
	if err != nil {
		t.Fatalf("DecryptDEK: %v", err)
	}
	if !bytes.Equal(plainDEK, decrypted) {
		t.Fatal("decrypted DEK does not match original")
	}
}

func TestEncryptDecryptRoundtrip(t *testing.T) {
	ec := newTestCrypto(t)
	plainDEK, _, _, _ := ec.GenerateDEK()

	plaintext := []byte("super secret starbucks password")
	ciphertext, nonce, err := ec.Encrypt(plainDEK, plaintext)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if bytes.Equal(ciphertext, plaintext) {
		t.Fatal("ciphertext matches plaintext")
	}

	decrypted, err := ec.Decrypt(plainDEK, ciphertext, nonce)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if !bytes.Equal(decrypted, plaintext) {
		t.Fatal("decrypted does not match original plaintext")
	}
}

func TestUniqueNonces(t *testing.T) {
	ec := newTestCrypto(t)
	plainDEK, _, _, _ := ec.GenerateDEK()

	_, n1, _ := ec.Encrypt(plainDEK, []byte("same plaintext"))
	_, n2, _ := ec.Encrypt(plainDEK, []byte("same plaintext"))
	if bytes.Equal(n1, n2) {
		t.Fatal("two encryptions produced identical nonces")
	}
}

func TestWrongKeyFails(t *testing.T) {
	ec := newTestCrypto(t)
	plainDEK, _, _, _ := ec.GenerateDEK()

	ciphertext, nonce, _ := ec.Encrypt(plainDEK, []byte("secret"))

	wrongDEK := make([]byte, 32)
	if _, err := ec.Decrypt(wrongDEK, ciphertext, nonce); err == nil {
		t.Fatal("expected error decrypting with wrong key")
	}
}

func TestWrongKeyDEKFails(t *testing.T) {
	ec1 := newTestCrypto(t)
	ec2 := newTestCrypto(t)

	_, encDEK, nonce, _ := ec1.GenerateDEK()

	if _, err := ec2.DecryptDEK(encDEK, nonce); err == nil {
		t.Fatal("expected error decrypting DEK with wrong MEK")
	}
}
