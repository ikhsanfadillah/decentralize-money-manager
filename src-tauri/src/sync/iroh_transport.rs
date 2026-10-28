use crate::error::{AppError, AppResult};
use crate::sync::transport::{
    BoxFuture, NodeTicketAddr, PeerSession, Transport, MAX_WIRE_FRAME_BYTES, SYNC_ALPN,
};
use iroh::endpoint::{presets, Connection, RecvStream, SendStream};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayUrl, SecretKey, TransportAddr};
use std::net::SocketAddr;
use std::str::FromStr;

pub struct IrohPeerSession {
    conn: Connection,
    remote_id: String,
    streams: Option<(SendStream, RecvStream)>,
    is_initiator: bool,
}

impl IrohPeerSession {
    pub fn new(conn: Connection, is_initiator: bool) -> Self {
        let remote_id = conn.remote_id().to_string();
        Self {
            conn,
            remote_id,
            streams: None,
            is_initiator,
        }
    }

    async fn ensure_streams(&mut self) -> AppResult<&mut (SendStream, RecvStream)> {
        if self.streams.is_none() {
            let pair = if self.is_initiator {
                self.conn.open_bi().await.map_err(|e| {
                    AppError::Io(std::io::Error::new(
                        std::io::ErrorKind::ConnectionAborted,
                        format!("iroh open_bi failed: {}", e),
                    ))
                })?
            } else {
                self.conn.accept_bi().await.map_err(|e| {
                    AppError::Io(std::io::Error::new(
                        std::io::ErrorKind::ConnectionAborted,
                        format!("iroh accept_bi failed: {}", e),
                    ))
                })?
            };
            self.streams = Some(pair);
        }
        self.streams
            .as_mut()
            .ok_or_else(|| AppError::Internal("QUIC streams missing after initialization".into()))
    }
}

impl PeerSession for IrohPeerSession {
    fn remote_node_id(&self) -> &str {
        &self.remote_id
    }

    fn send_frame<'a>(&'a mut self, data: &'a [u8]) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(async move {
            if data.len() > MAX_WIRE_FRAME_BYTES {
                return Err(AppError::Validation(format!(
                    "Wire frame length {} exceeds limit {}",
                    data.len(),
                    MAX_WIRE_FRAME_BYTES
                )));
            }
            let (send, _) = self.ensure_streams().await?;
            let len_prefix = (data.len() as u32).to_be_bytes();
            send.write_all(&len_prefix).await.map_err(|e| {
                AppError::Io(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    format!("iroh write len failed: {}", e),
                ))
            })?;
            send.write_all(data).await.map_err(|e| {
                AppError::Io(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    format!("iroh write payload failed: {}", e),
                ))
            })?;
            Ok(())
        })
    }

    fn recv_frame<'a>(&'a mut self) -> BoxFuture<'a, AppResult<Vec<u8>>> {
        Box::pin(async move {
            let (_, recv) = self.ensure_streams().await?;
            let mut len_buf = [0u8; 4];
            recv.read_exact(&mut len_buf).await.map_err(|e| {
                AppError::Io(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    format!("iroh read len failed: {}", e),
                ))
            })?;
            let frame_len = u32::from_be_bytes(len_buf) as usize;
            if frame_len > MAX_WIRE_FRAME_BYTES {
                return Err(AppError::Validation(format!(
                    "Incoming wire frame {} exceeds limit {}",
                    frame_len, MAX_WIRE_FRAME_BYTES
                )));
            }
            let mut payload = vec![0u8; frame_len];
            if frame_len > 0 {
                recv.read_exact(&mut payload).await.map_err(|e| {
                    AppError::Io(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        format!("iroh read payload failed: {}", e),
                    ))
                })?;
            }
            Ok(payload)
        })
    }

    fn close<'a>(&'a mut self) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            if let Some((mut send, _)) = self.streams.take() {
                let _ = send.finish();
                let _ = tokio::time::timeout(
                    std::time::Duration::from_millis(250),
                    send.stopped(),
                )
                .await;
            }
            self.conn.close(0u8.into(), b"sync_done");
        })
    }
}

/// Single `iroh` QUIC endpoint per device (Section 2 & Section 6.1).
pub struct IrohTransport {
    endpoint: Endpoint,
}

impl IrohTransport {
    pub async fn bind_with_secret(secret_bytes: [u8; 32]) -> AppResult<Self> {
        let secret_key = SecretKey::from_bytes(&secret_bytes);
        let mut builder = Endpoint::builder(presets::N0)
            .secret_key(secret_key)
            .alpns(vec![SYNC_ALPN.to_vec()]);

        // Support optional preferred port from DMM_P2P_PORT (e.g. 11204 for peer1, 11205 for peer2)
        let preferred_port: Option<u16> = std::env::var("DMM_P2P_PORT")
            .ok()
            .and_then(|s| s.trim().parse().ok());

        if let Some(port) = preferred_port {
            builder = match builder.bind_addr_with_opts(
                SocketAddr::from(([0, 0, 0, 0], port)),
                iroh::endpoint::BindOpts::default().set_is_required(false),
            ) {
                Ok(b) => b,
                Err(_) => Endpoint::builder(presets::N0)
                    .secret_key(SecretKey::from_bytes(&secret_bytes))
                    .alpns(vec![SYNC_ALPN.to_vec()]),
            };
        }

        let endpoint = builder
            .bind()
            .await
            .map_err(|e| {
                AppError::Io(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("Failed to bind iroh Endpoint: {}", e),
                ))
            })?;

        // Give iroh up to 1.5s to establish home relay / local interface discovery (non-fatal if offline)
        let _ = tokio::time::timeout(
            std::time::Duration::from_millis(1500),
            endpoint.online(),
        )
        .await;

        Ok(Self { endpoint })
    }

    pub fn endpoint_id_str(&self) -> String {
        self.endpoint.id().to_string()
    }
}

pub fn ticket_to_endpoint_addr(ticket: &NodeTicketAddr) -> AppResult<EndpointAddr> {
    let endpoint_id = EndpointId::from_str(ticket.node_id.trim()).map_err(|e| {
        AppError::Validation(format!(
            "Invalid peer iroh EndpointId '{}': {}",
            ticket.node_id, e
        ))
    })?;

    let mut transport_addrs = Vec::new();

    // 1. Prioritize direct local and LAN socket addresses first for sub-millisecond connection
    for ip_str in &ticket.direct_addrs {
        if let Ok(sock) = SocketAddr::from_str(ip_str.trim()) {
            transport_addrs.push(TransportAddr::Ip(sock));
        }
    }

    // 2. Add relay address as fallback for NAT traversal across different networks
    if let Some(ref relay_str) = ticket.relay_url {
        if !relay_str.trim().is_empty() {
            let relay_url = RelayUrl::from_str(relay_str.trim()).map_err(|e| {
                AppError::Validation(format!("Invalid iroh RelayUrl '{}': {}", relay_str, e))
            })?;
            transport_addrs.push(TransportAddr::Relay(relay_url));
        }
    }

    Ok(EndpointAddr::from_parts(endpoint_id, transport_addrs))
}

pub fn endpoint_addr_to_ticket_with_bound(
    addr: &EndpointAddr,
    bound_sockets: &[SocketAddr],
) -> NodeTicketAddr {
    let relay_url = addr.relay_urls().next().map(|u| u.to_string());
    let mut direct_addrs: Vec<String> = Vec::new();

    let mut push_unique = |s: String| {
        if !direct_addrs.contains(&s) {
            direct_addrs.push(s);
        }
    };

    // Include loopback 127.0.0.1:<port> first for instant same-PC multi-instance sync,
    // followed by all discovered LAN / interface socket addresses.
    for sock in bound_sockets.iter().chain(addr.ip_addrs()) {
        let port = sock.port();
        if port > 0 {
            push_unique(format!("127.0.0.1:{}", port));
        }
        if !sock.ip().is_unspecified() {
            push_unique(sock.to_string());
        }
    }

    NodeTicketAddr {
        node_id: addr.id.to_string(),
        relay_url,
        direct_addrs,
    }
}

impl Transport for IrohTransport {
    fn local_node_addr(&self) -> AppResult<NodeTicketAddr> {
        let addr = self.endpoint.addr();
        let bound = self.endpoint.bound_sockets();
        Ok(endpoint_addr_to_ticket_with_bound(&addr, &bound))
    }

    fn connect<'a>(
        &'a self,
        target: &'a NodeTicketAddr,
    ) -> BoxFuture<'a, AppResult<Box<dyn PeerSession>>> {
        Box::pin(async move {
            let ep_addr = ticket_to_endpoint_addr(target)?;
            let conn = tokio::time::timeout(
                std::time::Duration::from_millis(2500),
                self.endpoint.connect(ep_addr, SYNC_ALPN),
            )
            .await
            .map_err(|_| {
                AppError::Io(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    format!("Connection to peer {} timed out after 2.5s", target.node_id),
                ))
            })?
            .map_err(|e| {
                AppError::Io(std::io::Error::new(
                    std::io::ErrorKind::ConnectionRefused,
                    format!("iroh connect failed: {}", e),
                ))
            })?;
            Ok(Box::new(IrohPeerSession::new(conn, true)) as Box<dyn PeerSession>)
        })
    }

    fn accept<'a>(&'a self) -> BoxFuture<'a, AppResult<Option<Box<dyn PeerSession>>>> {
        Box::pin(async move {
            let Some(incoming) = self.endpoint.accept().await else {
                return Ok(None);
            };
            let connecting = incoming.accept().map_err(|e| {
                AppError::Io(std::io::Error::new(
                    std::io::ErrorKind::ConnectionAborted,
                    format!("iroh incoming accept failed: {}", e),
                ))
            })?;
            let conn = connecting.await.map_err(|e| {
                AppError::Io(std::io::Error::new(
                    std::io::ErrorKind::ConnectionAborted,
                    format!("iroh incoming handshake failed: {}", e),
                ))
            })?;
            Ok(Some(
                Box::new(IrohPeerSession::new(conn, false)) as Box<dyn PeerSession>
            ))
        })
    }

    fn shutdown<'a>(&'a self) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            self.endpoint.close().await;
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_iroh_transport_bidirectional_exchange_and_direct_connect() {
        let sk1 = [1u8; 32];
        let sk2 = [2u8; 32];
        let t1 = IrohTransport::bind_with_secret(sk1).await.unwrap();
        let t2 = IrohTransport::bind_with_secret(sk2).await.unwrap();

        println!("t1 bound: {:?}", t1.endpoint.bound_sockets());
        println!("t2 bound: {:?}", t2.endpoint.bound_sockets());
        println!("t2 addr: {:?}", t2.endpoint.addr());

        let addr2 = t2.local_node_addr().unwrap();
        println!("addr2: {:?}", addr2);
        assert!(!addr2.direct_addrs.is_empty());

        let accept_handle = tokio::spawn(async move {
            let mut session = t2.accept().await.unwrap().unwrap();
            let frame = session.recv_frame().await.unwrap();
            session.send_frame(&frame).await.unwrap();
            session.close().await;
        });

        let mut s1 = t1.connect(&addr2).await.unwrap();
        s1.send_frame(b"ping").await.unwrap();
        let reply = s1.recv_frame().await.unwrap();
        assert_eq!(reply, b"ping");
        s1.close().await;

        accept_handle.await.unwrap();
    }
}
