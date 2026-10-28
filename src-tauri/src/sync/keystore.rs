use crate::error::{AppError, AppResult};
use crate::sync::crypto::{
    decrypt_wire_payload, encrypt_wire_payload, BookMasterKey, DerivedBookKeys,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use zeroize::Zeroize;

pub trait KeyStore: Send + Sync {
    fn get_or_create_node_secret_key(&self) -> AppResult<[u8; 32]>;
    fn get_book_key(&self, book_id: &str) -> AppResult<Option<[u8; 32]>>;
    fn set_book_key(&self, book_id: &str, key: &[u8; 32]) -> AppResult<()>;
    fn delete_book_key(&self, book_id: &str) -> AppResult<()>;
    fn find_book_by_topic_id(&self, topic_id: &[u8; 32]) -> AppResult<Option<(String, [u8; 32])>>;

    fn get_or_create_book_key(&self, book_id: &str) -> AppResult<[u8; 32]> {
        if let Some(existing) = self.get_book_key(book_id)? {
            return Ok(existing);
        }
        let generated = BookMasterKey::generate();
        self.set_book_key(book_id, generated.as_bytes())?;
        Ok(*generated.as_bytes())
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct VaultData {
    node_secret_key: Option<[u8; 32]>,
    book_keys: HashMap<String, [u8; 32]>,
}

impl Drop for VaultData {
    fn drop(&mut self) {
        if let Some(ref mut sk) = self.node_secret_key {
            sk.zeroize();
        }
        for (_, val) in self.book_keys.iter_mut() {
            val.zeroize();
        }
    }
}

pub struct MemoryKeyStore {
    inner: Mutex<VaultData>,
}

impl Default for MemoryKeyStore {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryKeyStore {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(VaultData::default()),
        }
    }
}

impl KeyStore for MemoryKeyStore {
    fn get_or_create_node_secret_key(&self) -> AppResult<[u8; 32]> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| AppError::Internal("MemoryKeyStore mutex poisoned".into()))?;
        if let Some(sk) = guard.node_secret_key {
            return Ok(sk);
        }
        let mut sk = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut sk);
        guard.node_secret_key = Some(sk);
        Ok(sk)
    }

    fn get_book_key(&self, book_id: &str) -> AppResult<Option<[u8; 32]>> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| AppError::Internal("MemoryKeyStore mutex poisoned".into()))?;
        Ok(guard.book_keys.get(book_id).copied())
    }

    fn set_book_key(&self, book_id: &str, key: &[u8; 32]) -> AppResult<()> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| AppError::Internal("MemoryKeyStore mutex poisoned".into()))?;
        guard.book_keys.insert(book_id.to_string(), *key);
        Ok(())
    }

    fn delete_book_key(&self, book_id: &str) -> AppResult<()> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| AppError::Internal("MemoryKeyStore mutex poisoned".into()))?;
        if let Some(mut old) = guard.book_keys.remove(book_id) {
            old.zeroize();
        }
        Ok(())
    }

    fn find_book_by_topic_id(&self, topic_id: &[u8; 32]) -> AppResult<Option<(String, [u8; 32])>> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| AppError::Internal("MemoryKeyStore mutex poisoned".into()))?;
        for (book_id, key) in &guard.book_keys {
            let derived = DerivedBookKeys::derive(key);
            if &derived.topic_id == topic_id {
                return Ok(Some((book_id.clone(), *key)));
            }
        }
        Ok(None)
    }
}

/// Persistent OS-sandboxed encrypted KeyStore that stores node & book keys outside SQLite files.
pub struct OsVaultKeyStore {
    vault_path: PathBuf,
    master_key_path: PathBuf,
    cache: Mutex<VaultData>,
}

impl OsVaultKeyStore {
    pub fn open(app_data_dir: & std::path::Path) -> AppResult<Self> {
        let keystore_dir = app_data_dir.join("keystore");
        fs::create_dir_all(&keystore_dir)?;

        let vault_path = keystore_dir.join("vault.enc");
        let master_key_path = keystore_dir.join("master.key");

        let mut master_key = Self::load_or_create_master_key(&master_key_path)?;
        let initial_data = if vault_path.exists() {
            let bytes = fs::read(&vault_path)?;
            decrypt_wire_payload::<VaultData>(&master_key, &bytes)?
        } else {
            VaultData::default()
        };
        master_key.zeroize();

        Ok(Self {
            vault_path,
            master_key_path,
            cache: Mutex::new(initial_data),
        })
    }

    fn load_or_create_master_key(path: &std::path::Path) -> AppResult<[u8; 32]> {
        if path.exists() {
            let mut raw = fs::read(path)?;
            if raw.len() != 32 {
                raw.zeroize();
                return Err(AppError::Crypto(
                    "Corrupted keystore master key length".into(),
                ));
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&raw);
            raw.zeroize();
            Ok(key)
        } else {
            let mut key = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            fs::write(path, &key)?;
            Ok(key)
        }
    }

    fn persist_locked(&self, data: &VaultData) -> AppResult<()> {
        let mut master_key = Self::load_or_create_master_key(&self.master_key_path)?;
        let encrypted_res = encrypt_wire_payload(&master_key, data);
        master_key.zeroize();
        let encrypted = encrypted_res?;
        let tmp_path = self.vault_path.with_extension("tmp");
        fs::write(&tmp_path, &encrypted)?;
        fs::rename(&tmp_path, &self.vault_path)?;
        Ok(())
    }
}

impl KeyStore for OsVaultKeyStore {
    fn get_or_create_node_secret_key(&self) -> AppResult<[u8; 32]> {
        let mut guard = self
            .cache
            .lock()
            .map_err(|_| AppError::Internal("OsVaultKeyStore mutex poisoned".into()))?;
        if let Some(sk) = guard.node_secret_key {
            return Ok(sk);
        }
        let mut sk = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut sk);
        guard.node_secret_key = Some(sk);
        self.persist_locked(&guard)?;
        Ok(sk)
    }

    fn get_book_key(&self, book_id: &str) -> AppResult<Option<[u8; 32]>> {
        let guard = self
            .cache
            .lock()
            .map_err(|_| AppError::Internal("OsVaultKeyStore mutex poisoned".into()))?;
        Ok(guard.book_keys.get(book_id).copied())
    }

    fn set_book_key(&self, book_id: &str, key: &[u8; 32]) -> AppResult<()> {
        let mut guard = self
            .cache
            .lock()
            .map_err(|_| AppError::Internal("OsVaultKeyStore mutex poisoned".into()))?;
        guard.book_keys.insert(book_id.to_string(), *key);
        self.persist_locked(&guard)?;
        Ok(())
    }

    fn delete_book_key(&self, book_id: &str) -> AppResult<()> {
        let mut guard = self
            .cache
            .lock()
            .map_err(|_| AppError::Internal("OsVaultKeyStore mutex poisoned".into()))?;
        if let Some(mut old) = guard.book_keys.remove(book_id) {
            old.zeroize();
            self.persist_locked(&guard)?;
        }
        Ok(())
    }

    fn find_book_by_topic_id(&self, topic_id: &[u8; 32]) -> AppResult<Option<(String, [u8; 32])>> {
        let guard = self
            .cache
            .lock()
            .map_err(|_| AppError::Internal("OsVaultKeyStore mutex poisoned".into()))?;
        for (book_id, key) in &guard.book_keys {
            let derived = DerivedBookKeys::derive(key);
            if &derived.topic_id == topic_id {
                return Ok(Some((book_id.clone(), *key)));
            }
        }
        Ok(None)
    }
}

