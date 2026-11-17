//! Taşıma katmanı: GMP-3 paketlerini bayt olarak gönderip alır.
//!
//! Neden trait: seri, USB (sanal seri) ve TCP aynı paket sözleşmesini taşır;
//! simülatör de aynı arayüzü uygular. Oturum katmanı hangi kanalın kullanıldığını
//! bilmez. Belge §2.6: yalnız kablolu iletişim (RS232, USB, Ethernet) kullanılır;
//! burada Bluetooth veya Wi-Fi taşıması bilerek yoktur.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use super::frame::{serial_wrap, ACK, ETX, MAX_PACKET, NAK, STX};
use super::types::{OkcError, OkcResult};

/// Belge §2.6: bekleme zaman aşımı 3000 ms, deneme sayısı 3.
pub const SERIAL_ACK_TIMEOUT: Duration = Duration::from_millis(3000);
pub const SERIAL_ATTEMPTS: usize = 3;

pub trait Transport: Send {
    /// Tam bir GMP-3 paketini (uzunluk dahil, STX/ETX hariç) gönderir.
    fn send(&mut self, packet: &[u8]) -> OkcResult<()>;
    /// Bir sonraki tam paketi alır.
    fn recv(&mut self, timeout: Duration) -> OkcResult<Vec<u8>>;
}

fn io_error(error: &std::io::Error) -> OkcError {
    match error.kind() {
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => OkcError::Timeout,
        _ => OkcError::Transport(error.to_string()),
    }
}

/// Ethernet: STX/ETX/ACK/NAK kullanılmaz (belge §2.7); paket uzunluk alanıyla ayrılır.
pub struct TcpTransport {
    stream: TcpStream,
}

impl TcpTransport {
    pub fn connect(address: SocketAddr, timeout: Duration) -> OkcResult<Self> {
        let stream = TcpStream::connect_timeout(&address, timeout)
            .map_err(|e| OkcError::NotConnected(format!("{address}: {e}")))?;
        stream
            .set_nodelay(true)
            .map_err(|e| OkcError::Transport(e.to_string()))?;
        Ok(Self { stream })
    }
}

fn read_exact_from(reader: &mut impl Read, buffer: &mut [u8]) -> OkcResult<()> {
    reader.read_exact(buffer).map_err(|e| io_error(&e))
}

/// Uzunluk önekli paketi okur. Uzunluk sınırı aşılırsa bellek şişirilmez, reddedilir.
fn read_length_prefixed(reader: &mut impl Read) -> OkcResult<Vec<u8>> {
    let mut prefix = [0u8; 2];
    read_exact_from(reader, &mut prefix)?;
    let len = usize::from(u16::from_be_bytes(prefix));
    if len == 0 || len + 2 > MAX_PACKET {
        return Err(OkcError::Protocol(format!(
            "paket uzunluğu geçersiz: {len}"
        )));
    }
    let mut packet = prefix.to_vec();
    packet.resize(2 + len, 0);
    read_exact_from(reader, &mut packet[2..])?;
    Ok(packet)
}

impl Transport for TcpTransport {
    fn send(&mut self, packet: &[u8]) -> OkcResult<()> {
        self.stream.write_all(packet).map_err(|e| io_error(&e))?;
        self.stream.flush().map_err(|e| io_error(&e))
    }

    fn recv(&mut self, timeout: Duration) -> OkcResult<Vec<u8>> {
        self.stream
            .set_read_timeout(Some(timeout))
            .map_err(|e| OkcError::Transport(e.to_string()))?;
        read_length_prefixed(&mut self.stream)
    }
}

/// Seri veya USB (sanal seri) bağlantı noktası. Somut açıcı (işletim sistemi
/// portu) yoktur: üretici kütüphanesi veya seri port bağımlılığı seçildiğinde
/// bu trait'i sağlayan bir sarmalayıcı yazılır.
pub trait SerialIo: Read + Write + Send {}
impl<T: Read + Write + Send> SerialIo for T {}

/// STX/ETX çerçevesi ve ACK/NAK onayı olan seri taşıma (belge §2.6).
pub struct SerialTransport<P: SerialIo> {
    port: P,
}

impl<P: SerialIo> SerialTransport<P> {
    pub fn new(port: P) -> Self {
        Self { port }
    }

    fn read_byte(&mut self) -> OkcResult<u8> {
        let mut byte = [0u8; 1];
        read_exact_from(&mut self.port, &mut byte)?;
        Ok(byte[0])
    }
}

impl<P: SerialIo> Transport for SerialTransport<P> {
    fn send(&mut self, packet: &[u8]) -> OkcResult<()> {
        let framed = serial_wrap(packet);
        let mut last = OkcError::Timeout;
        for _ in 0..SERIAL_ATTEMPTS {
            self.port.write_all(&framed).map_err(|e| io_error(&e))?;
            self.port.flush().map_err(|e| io_error(&e))?;
            match self.read_byte() {
                Ok(ACK) => return Ok(()),
                Ok(NAK) => last = OkcError::Transport("alıcı paketi reddetti (NAK)".to_string()),
                Ok(other) => {
                    last = OkcError::Protocol(format!("beklenmeyen onay baytı: {other:#04x}"))
                }
                Err(OkcError::Timeout) => last = OkcError::Timeout,
                Err(error) => return Err(error),
            }
        }
        Err(last)
    }

    fn recv(&mut self, _timeout: Duration) -> OkcResult<Vec<u8>> {
        // Bağlantı noktasının okuma zaman aşımını açıcı belirler (belge: 3000 ms).
        let mut last = OkcError::Timeout;
        for _ in 0..SERIAL_ATTEMPTS {
            if self.read_byte()? != STX {
                self.port.write_all(&[NAK]).map_err(|e| io_error(&e))?;
                last = OkcError::Protocol("paket STX ile başlamıyor".to_string());
                continue;
            }
            let packet = read_length_prefixed(&mut self.port);
            let closing = self.read_byte();
            match (packet, closing) {
                (Ok(packet), Ok(ETX)) => {
                    self.port.write_all(&[ACK]).map_err(|e| io_error(&e))?;
                    return Ok(packet);
                }
                _ => {
                    self.port.write_all(&[NAK]).map_err(|e| io_error(&e))?;
                    last = OkcError::Protocol("paket ETX ile bitmiyor veya bozuk".to_string());
                }
            }
        }
        Err(last)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    /// Bellekte tek yönlü boru: boşken okuma zaman aşımı verir.
    #[derive(Clone, Default)]
    struct Pipe(Arc<Mutex<VecDeque<u8>>>);

    struct Endpoint {
        rx: Pipe,
        tx: Pipe,
    }

    impl Read for Endpoint {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            for _ in 0..200 {
                if let Ok(mut queue) = self.rx.0.lock() {
                    if let Some(byte) = queue.pop_front() {
                        buf[0] = byte;
                        return Ok(1);
                    }
                }
                std::thread::sleep(Duration::from_millis(2));
            }
            Err(std::io::ErrorKind::TimedOut.into())
        }
    }

    impl Write for Endpoint {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            if let Ok(mut queue) = self.tx.0.lock() {
                queue.extend(buf.iter().copied());
            }
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn pair() -> (Endpoint, Endpoint) {
        let (a, b) = (Pipe::default(), Pipe::default());
        (
            Endpoint {
                rx: a.clone(),
                tx: b.clone(),
            },
            Endpoint { rx: b, tx: a },
        )
    }

    fn packet(payload: &[u8]) -> Vec<u8> {
        let mut p = u16::try_from(payload.len())
            .expect("len")
            .to_be_bytes()
            .to_vec();
        p.extend_from_slice(payload);
        p
    }

    #[test]
    fn serial_delivers_packet_with_ack() {
        let (left, right) = pair();
        let sent = packet(&[1, 3, 3, 7]);
        let expected = sent.clone();
        let reader =
            std::thread::spawn(move || SerialTransport::new(right).recv(Duration::from_secs(1)));
        SerialTransport::new(left).send(&sent).expect("gönder");
        // Veri ETX değerini (0x03) taşısa da uzunluk önekiyle doğru ayrılır.
        assert_eq!(reader.join().expect("iş parçacığı").expect("al"), expected);
    }

    #[test]
    fn serial_send_fails_without_ack_after_three_attempts() {
        let (left, _right) = pair();
        let started = std::time::Instant::now();
        let result = SerialTransport::new(left).send(&packet(&[9, 9]));
        assert_eq!(result, Err(OkcError::Timeout));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn serial_rejects_garbage_with_nak() {
        let (left, right) = pair();
        let mut raw = left;
        raw.write_all(&[0x55]).expect("yaz");
        let mut receiver = SerialTransport::new(right);
        assert!(receiver.recv(Duration::from_secs(1)).is_err());
        let mut answer = [0u8; 1];
        raw.read_exact(&mut answer).expect("NAK");
        assert_eq!(answer[0], NAK);
    }

    #[test]
    fn oversized_length_is_rejected_before_allocation() {
        let mut data: &[u8] = &[0xFF, 0xFF, 1, 2];
        assert!(matches!(
            read_length_prefixed(&mut data),
            Err(OkcError::Protocol(_))
        ));
    }
}
