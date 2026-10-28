use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

pub const SYNC_ALPN: &[u8] = b"fmm/sync/1";
pub const MAX_WIRE_FRAME_BYTES: usize = 512 * 1024; // 512 KiB hard wire frame limit

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Transport-agnostic peer addressing metadata (serializable in QR invites and sync_peers).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeTicketAddr {
    pub node_id: String,
    pub relay_url: Option<String>,
    pub direct_addrs: Vec<String>,
}

/// Active bidirectional session between two peers.
pub trait PeerSession: Send + Sync {
    fn remote_node_id(&self) -> &str;
    fn send_frame<'a>(&'a mut self, data: &'a [u8]) -> BoxFuture<'a, AppResult<()>>;
    fn recv_frame<'a>(&'a mut self) -> BoxFuture<'a, AppResult<Vec<u8>>>;
    fn close<'a>(&'a mut self) -> BoxFuture<'a, ()>;
}

/// Network abstraction shielding the sync protocol from direct `iroh` types (Section 6.1).
pub trait Transport: Send + Sync {
    fn local_node_addr(&self) -> AppResult<NodeTicketAddr>;
    fn connect<'a>(
        &'a self,
        target: &'a NodeTicketAddr,
    ) -> BoxFuture<'a, AppResult<Box<dyn PeerSession>>>;
    fn accept<'a>(&'a self) -> BoxFuture<'a, AppResult<Option<Box<dyn PeerSession>>>>;

    fn send_batch<'a>(
        &'a self,
        session: &'a mut dyn PeerSession,
        payload: &'a [u8],
    ) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(async move {
            if payload.len() > MAX_WIRE_FRAME_BYTES {
                return Err(AppError::Validation(format!(
                    "Wire batch size {} exceeds maximum {}",
                    payload.len(),
                    MAX_WIRE_FRAME_BYTES
                )));
            }
            session.send_frame(payload).await
        })
    }

    fn recv_batch<'a>(
        &'a self,
        session: &'a mut dyn PeerSession,
    ) -> BoxFuture<'a, AppResult<Vec<u8>>> {
        Box::pin(async move {
            let bytes = session.recv_frame().await?;
            if bytes.len() > MAX_WIRE_FRAME_BYTES {
                return Err(AppError::Validation(format!(
                    "Received wire frame {} exceeds maximum {}",
                    bytes.len(),
                    MAX_WIRE_FRAME_BYTES
                )));
            }
            Ok(bytes)
        })
    }

    fn shutdown<'a>(&'a self) -> BoxFuture<'a, ()>;
}

// ============================================================================
// In-Memory Transport (for deterministic protocol unit & integration tests)
// ============================================================================

pub struct ChannelPeerSession {
    remote_id: String,
    tx: mpsc::Sender<Vec<u8>>,
    rx: mpsc::Receiver<Vec<u8>>,
}

impl ChannelPeerSession {
    pub fn pair(node_a: String, node_b: String) -> (Self, Self) {
        let (tx_a_to_b, rx_b_from_a) = mpsc::channel(64);
        let (tx_b_to_a, rx_a_from_b) = mpsc::channel(64);
        (
            Self {
                remote_id: node_b,
                tx: tx_a_to_b,
                rx: rx_a_from_b,
            },
            Self {
                remote_id: node_a,
                tx: tx_b_to_a,
                rx: rx_b_from_a,
            },
        )
    }
}

impl PeerSession for ChannelPeerSession {
    fn remote_node_id(&self) -> &str {
        &self.remote_id
    }

    fn send_frame<'a>(&'a mut self, data: &'a [u8]) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(async move {
            if data.len() > MAX_WIRE_FRAME_BYTES {
                return Err(AppError::Validation("Frame exceeds maximum size".into()));
            }
            self.tx
                .send(data.to_vec())
                .await
                .map_err(|_| AppError::Io(std::io::Error::from(std::io::ErrorKind::BrokenPipe)))
        })
    }

    fn recv_frame<'a>(&'a mut self) -> BoxFuture<'a, AppResult<Vec<u8>>> {
        Box::pin(async move {
            self.rx
                .recv()
                .await
                .ok_or_else(|| AppError::Io(std::io::Error::from(std::io::ErrorKind::UnexpectedEof)))
        })
    }

    fn close<'a>(&'a mut self) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            self.rx.close();
        })
    }
}

#[derive(Default)]
pub struct InMemoryNetworkHub {
    listeners: Mutex<HashMap<String, mpsc::Sender<Box<dyn PeerSession>>>>,
}

impl InMemoryNetworkHub {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            listeners: Mutex::new(HashMap::new()),
        })
    }

    pub async fn register_endpoint(&self, node_id: &str) -> Arc<InMemoryTransport> {
        let (tx, rx) = mpsc::channel(32);
        let mut guard = self.listeners.lock().await;
        guard.insert(node_id.to_string(), tx);
        Arc::new(InMemoryTransport {
            node_id: node_id.to_string(),
            hub: Arc::new(Mutex::new(Some(rx))),
            network: self.listeners_clone().await,
        })
    }

    async fn listeners_clone(
        &self,
    ) -> Arc<Mutex<HashMap<String, mpsc::Sender<Box<dyn PeerSession>>>>> {
        let guard = self.listeners.lock().await;
        Arc::new(Mutex::new(guard.clone()))
    }
}

pub struct InMemoryTransport {
    node_id: String,
    hub: Arc<Mutex<Option<mpsc::Receiver<Box<dyn PeerSession>>>>>,
    network: Arc<Mutex<HashMap<String, mpsc::Sender<Box<dyn PeerSession>>>>>,
}

impl InMemoryTransport {
    pub fn create_mesh(node_ids: &[&str]) -> HashMap<String, Arc<Self>> {
        let mut initial_map: HashMap<String, mpsc::Sender<Box<dyn PeerSession>>> = HashMap::new();
        let mut receivers: Vec<(String, mpsc::Receiver<Box<dyn PeerSession>>)> = Vec::new();

        for &id in node_ids {
            let (tx, rx) = mpsc::channel(32);
            initial_map.insert(id.to_string(), tx);
            receivers.push((id.to_string(), rx));
        }

        let shared_map = Arc::new(Mutex::new(initial_map));
        let mut transports = HashMap::new();

        for (id, rx) in receivers {
            transports.insert(
                id.clone(),
                Arc::new(InMemoryTransport {
                    node_id: id,
                    hub: Arc::new(Mutex::new(Some(rx))),
                    network: Arc::clone(&shared_map),
                }),
            );
        }
        transports
    }
}

impl Transport for InMemoryTransport {
    fn local_node_addr(&self) -> AppResult<NodeTicketAddr> {
        Ok(NodeTicketAddr {
            node_id: self.node_id.clone(),
            relay_url: None,
            direct_addrs: Vec::new(),
        })
    }

    fn connect<'a>(
        &'a self,
        target: &'a NodeTicketAddr,
    ) -> BoxFuture<'a, AppResult<Box<dyn PeerSession>>> {
        Box::pin(async move {
            let sender = {
                let guard = self.network.lock().await;
                guard.get(&target.node_id).cloned()
            }
            .ok_or_else(|| {
                AppError::Io(std::io::Error::new(
                    std::io::ErrorKind::ConnectionRefused,
                    format!("Peer {} not reachable", target.node_id),
                ))
            })?;

            let (client_sess, server_sess) =
                ChannelPeerSession::pair(self.node_id.clone(), target.node_id.clone());
            sender
                .send(Box::new(server_sess))
                .await
                .map_err(|_| AppError::Io(std::io::Error::from(std::io::ErrorKind::BrokenPipe)))?;
            Ok(Box::new(client_sess) as Box<dyn PeerSession>)
        })
    }

    fn accept<'a>(&'a self) -> BoxFuture<'a, AppResult<Option<Box<dyn PeerSession>>>> {
        Box::pin(async move {
            let mut guard = self.hub.lock().await;
            match guard.as_mut() {
                Some(rx) => Ok(rx.recv().await),
                None => Ok(None),
            }
        })
    }

    fn shutdown<'a>(&'a self) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let mut guard = self.hub.lock().await;
            *guard = None;
        })
    }
}

