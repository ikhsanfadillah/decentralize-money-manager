use crate::error::{AppError, AppResult};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::de::DeserializeOwned;
use serde::Serialize;
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop};

type HmacSha256 = Hmac<Sha256>;

pub const CONTEXT_TOPIC_ID: &str = "DecentralizeMoneyManager v1 book topic_id";
pub const CONTEXT_AUTH_KEY: &str = "DecentralizeMoneyManager v1 book auth_key";
pub const CONTEXT_ENC_KEY: &str = "DecentralizeMoneyManager v1 book enc_key";

pub const ROLE_SERVER_AUTH: &[u8] = b"DMM-AUTH-SERVER-V1";
pub const ROLE_CLIENT_AUTH: &[u8] = b"DMM-AUTH-CLIENT-V1";
pub const XCHACHA_NONCE_LEN: usize = 24;

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct BookMasterKey(pub [u8; 32]);

impl BookMasterKey {
    pub fn generate() -> Self {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        Self(bytes)
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct DerivedBookKeys {
    pub topic_id: [u8; 32],
    pub auth_key: [u8; 32],
    pub enc_key: [u8; 32],
}

impl DerivedBookKeys {
    pub fn derive(book_key: &[u8; 32]) -> Self {
        let topic_id = blake3::derive_key(CONTEXT_TOPIC_ID, book_key);
        let auth_key = blake3::derive_key(CONTEXT_AUTH_KEY, book_key);
        let enc_key = blake3::derive_key(CONTEXT_ENC_KEY, book_key);
        Self {
            topic_id,
            auth_key,
            enc_key,
        }
    }

    pub fn topic_hex(&self) -> String {
        hex::encode(self.topic_id)
    }
}

pub fn random_nonce_32() -> [u8; 32] {
    let mut nonce = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut nonce);
    nonce
}

pub fn compute_auth_mac(
    auth_key: &[u8; 32],
    role_tag: &[u8],
    topic_id: &[u8; 32],
    client_nonce: &[u8; 32],
    server_nonce: &[u8; 32],
    device_id: &str,
) -> AppResult<[u8; 32]> {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(auth_key)
        .map_err(|_| AppError::Crypto("Invalid HMAC key length".into()))?;
    mac.update(role_tag);
    mac.update(topic_id);
    mac.update(client_nonce);
    mac.update(server_nonce);
    mac.update(device_id.as_bytes());
    let result = mac.finalize().into_bytes();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    Ok(out)
}

pub fn verify_auth_mac(
    auth_key: &[u8; 32],
    role_tag: &[u8],
    topic_id: &[u8; 32],
    client_nonce: &[u8; 32],
    server_nonce: &[u8; 32],
    device_id: &str,
    expected_mac: &[u8; 32],
) -> AppResult<()> {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(auth_key)
        .map_err(|_| AppError::Crypto("Invalid HMAC key length".into()))?;
    mac.update(role_tag);
    mac.update(topic_id);
    mac.update(client_nonce);
    mac.update(server_nonce);
    mac.update(device_id.as_bytes());
    mac.verify_slice(expected_mac)
        .map_err(|_| AppError::Crypto("Peer HMAC authentication verification failed".into()))
}

pub fn encrypt_wire_payload<T: Serialize>(enc_key: &[u8; 32], payload: &T) -> AppResult<Vec<u8>> {
    let mut plaintext = postcard::to_allocvec(payload)
        .map_err(|e| AppError::Crypto(format!("Wire serialization failed: {}", e)))?;

    let mut nonce_bytes = [0u8; XCHACHA_NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let cipher = XChaCha20Poly1305::new(Key::from_slice(enc_key));
    let ciphertext_res = cipher.encrypt(XNonce::from_slice(&nonce_bytes), plaintext.as_ref());
    plaintext.zeroize();

    let ciphertext = ciphertext_res
        .map_err(|_| AppError::Crypto("XChaCha20-Poly1305 encryption failed".into()))?;

    let mut frame = Vec::with_capacity(XCHACHA_NONCE_LEN + ciphertext.len());
    frame.extend_from_slice(&nonce_bytes);
    frame.extend_from_slice(&ciphertext);
    Ok(frame)
}

pub fn decrypt_wire_payload<T: DeserializeOwned>(
    enc_key: &[u8; 32],
    frame: &[u8],
) -> AppResult<T> {
    if frame.len() < XCHACHA_NONCE_LEN + 16 {
        return Err(AppError::Crypto(
            "Encrypted wire frame is shorter than minimum nonce + tag length".into(),
        ));
    }

    let (nonce_bytes, ciphertext) = frame.split_at(XCHACHA_NONCE_LEN);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(enc_key));
    let mut plaintext = cipher
        .decrypt(XNonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|_| {
            AppError::Crypto(
                "XChaCha20-Poly1305 decryption failed (invalid key or tampered batch)".into(),
            )
        })?;

    let decoded = postcard::from_bytes::<T>(&plaintext)
        .map_err(|e| AppError::Crypto(format!("Wire deserialization failed: {}", e)));
    plaintext.zeroize();
    decoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_derivation_separation() {
        let master = BookMasterKey::generate();
        let derived = DerivedBookKeys::derive(master.as_bytes());

        assert_ne!(&derived.topic_id, master.as_bytes());
        assert_ne!(&derived.auth_key, master.as_bytes());
        assert_ne!(&derived.enc_key, master.as_bytes());
        assert_ne!(derived.topic_id, derived.auth_key);
        assert_ne!(derived.auth_key, derived.enc_key);
        assert_ne!(derived.topic_id, derived.enc_key);
    }

    #[test]
    fn test_hmac_challenge_and_tamper_rejection() {
        let master = BookMasterKey::generate();
        let keys = DerivedBookKeys::derive(master.as_bytes());
        let wrong_keys = DerivedBookKeys::derive(&[0x42u8; 32]);

        let c_nonce = random_nonce_32();
        let s_nonce = random_nonce_32();

        let mac = compute_auth_mac(
            &keys.auth_key,
            ROLE_SERVER_AUTH,
            &keys.topic_id,
            &c_nonce,
            &s_nonce,
            "dev12345",
        )
        .unwrap();

        assert!(verify_auth_mac(
            &keys.auth_key,
            ROLE_SERVER_AUTH,
            &keys.topic_id,
            &c_nonce,
            &s_nonce,
            "dev12345",
            &mac
        )
        .is_ok());

        // Wrong auth_key must fail
        assert!(verify_auth_mac(
            &wrong_keys.auth_key,
            ROLE_SERVER_AUTH,
            &keys.topic_id,
            &c_nonce,
            &s_nonce,
            "dev12345",
            &mac
        )
        .is_err());
    }

    #[test]
    fn test_encrypt_decrypt_and_tamper_detection() {
        let master = BookMasterKey::generate();
        let keys = DerivedBookKeys::derive(master.as_bytes());

        let sample = vec!["op-1".to_string(), "op-2".to_string()];
        let mut frame = encrypt_wire_payload(&keys.enc_key, &sample).unwrap();

        let recovered: Vec<String> = decrypt_wire_payload(&keys.enc_key, &frame).unwrap();
        assert_eq!(recovered, sample);

        // Flip a bit in the ciphertext
        let last_idx = frame.len() - 1;
        frame[last_idx] ^= 0x01;
        let tampered_res: AppResult<Vec<String>> = decrypt_wire_payload(&keys.enc_key, &frame);
        assert!(tampered_res.is_err());
    }
}

