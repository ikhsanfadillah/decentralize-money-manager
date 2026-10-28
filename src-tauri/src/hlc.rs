use crate::error::{AppError, AppResult};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fmt;
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_WALL_MS: u64 = 9_999_999_999_999;
pub const MAX_COUNTER: u32 = 99_999;
pub const MAX_DRIFT_MS: u64 = 24 * 60 * 60 * 1_000; // 24 hours in milliseconds

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HlcTimestamp {
    pub wall_ms: u64,
    pub counter: u32,
    pub device_id: String,
}

impl HlcTimestamp {
    pub fn new(wall_ms: u64, counter: u32, device_id: impl Into<String>) -> AppResult<Self> {
        let device_id = device_id.into();
        Self::validate_parts(wall_ms, counter, &device_id)?;
        Ok(Self {
            wall_ms,
            counter,
            device_id,
        })
    }

    pub fn zero(device_id: impl Into<String>) -> AppResult<Self> {
        Self::new(0, 0, device_id)
    }

    fn validate_parts(wall_ms: u64, counter: u32, device_id: &str) -> AppResult<()> {
        if wall_ms > MAX_WALL_MS {
            return Err(AppError::InvalidHlc(format!(
                "wall_ms {} exceeds maximum 13-digit limit",
                wall_ms
            )));
        }
        if counter > MAX_COUNTER {
            return Err(AppError::InvalidHlc(format!(
                "counter {} exceeds maximum 5-digit limit",
                counter
            )));
        }
        if device_id.is_empty()
            || device_id.len() > 32
            || !device_id.chars().all(|c| c.is_ascii_alphanumeric())
        {
            return Err(AppError::InvalidHlc(format!(
                "invalid device_id '{}' in HLC",
                device_id
            )));
        }
        Ok(())
    }

    pub fn verify_drift(&self, now_ms: u64) -> AppResult<()> {
        let max_allowed = now_ms.saturating_add(MAX_DRIFT_MS);
        if self.wall_ms > max_allowed {
            return Err(AppError::ClockDriftExceeded(format!(
                "remote wall_ms {} exceeds now_ms {} + 24h ({})",
                self.wall_ms, now_ms, max_allowed
            )));
        }
        Ok(())
    }
}

impl fmt::Display for HlcTimestamp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{:013}-{:05}-{}",
            self.wall_ms, self.counter, self.device_id
        )
    }
}

impl FromStr for HlcTimestamp {
    type Err = AppError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let mut parts = s.splitn(3, '-');
        let wall_str = parts
            .next()
            .ok_or_else(|| AppError::InvalidHlc(format!("missing wall_ms in '{}'", s)))?;
        let counter_str = parts
            .next()
            .ok_or_else(|| AppError::InvalidHlc(format!("missing counter in '{}'", s)))?;
        let device_id = parts
            .next()
            .ok_or_else(|| AppError::InvalidHlc(format!("missing device_id in '{}'", s)))?;

        if wall_str.len() != 13 || !wall_str.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::InvalidHlc(format!(
                "wall_ms must be 13 decimal digits in '{}'",
                s
            )));
        }
        if counter_str.len() != 5 || !counter_str.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::InvalidHlc(format!(
                "counter must be 5 decimal digits in '{}'",
                s
            )));
        }

        let wall_ms = wall_str
            .parse::<u64>()
            .map_err(|_| AppError::InvalidHlc(format!("invalid wall_ms in '{}'", s)))?;
        let counter = counter_str
            .parse::<u32>()
            .map_err(|_| AppError::InvalidHlc(format!("invalid counter in '{}'", s)))?;

        Self::new(wall_ms, counter, device_id.to_string())
    }
}

impl Ord for HlcTimestamp {
    fn cmp(&self, other: &Self) -> Ordering {
        self.wall_ms
            .cmp(&other.wall_ms)
            .then_with(|| self.counter.cmp(&other.counter))
            .then_with(|| self.device_id.cmp(&other.device_id))
    }
}

impl PartialOrd for HlcTimestamp {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, Clone)]
pub struct HlcClock {
    last: HlcTimestamp,
}

impl HlcClock {
    pub fn new(last: HlcTimestamp) -> Self {
        Self { last }
    }

    pub fn from_device_id(device_id: impl Into<String>) -> AppResult<Self> {
        Ok(Self {
            last: HlcTimestamp::zero(device_id)?,
        })
    }

    pub fn last(&self) -> &HlcTimestamp {
        &self.last
    }

    pub fn device_id(&self) -> &str {
        &self.last.device_id
    }

    pub fn tick(&mut self, now_ms: u64) -> AppResult<HlcTimestamp> {
        if now_ms > MAX_WALL_MS {
            return Err(AppError::InvalidHlc("now_ms exceeds 13-digit limit".into()));
        }
        if now_ms > self.last.wall_ms {
            self.last.wall_ms = now_ms;
            self.last.counter = 0;
        } else {
            if self.last.counter >= MAX_COUNTER {
                self.last.wall_ms = self
                    .last
                    .wall_ms
                    .checked_add(1)
                    .ok_or(AppError::ArithmeticOverflow)?;
                if self.last.wall_ms > MAX_WALL_MS {
                    return Err(AppError::InvalidHlc("HLC wall_ms overflow".into()));
                }
                self.last.counter = 0;
            } else {
                self.last.counter += 1;
            }
        }
        Ok(self.last.clone())
    }

    pub fn receive(&mut self, remote: &HlcTimestamp, now_ms: u64) -> AppResult<HlcTimestamp> {
        remote.verify_drift(now_ms)?;

        if now_ms > self.last.wall_ms && now_ms > remote.wall_ms {
            self.last.wall_ms = now_ms;
            self.last.counter = 0;
        } else if self.last.wall_ms == remote.wall_ms {
            let next_counter = self.last.counter.max(remote.counter) + 1;
            if next_counter > MAX_COUNTER {
                self.last.wall_ms += 1;
                self.last.counter = 0;
            } else {
                self.last.counter = next_counter;
            }
        } else if remote.wall_ms > self.last.wall_ms {
            self.last.wall_ms = remote.wall_ms;
            let next_counter = remote.counter + 1;
            if next_counter > MAX_COUNTER {
                self.last.wall_ms += 1;
                self.last.counter = 0;
            } else {
                self.last.counter = next_counter;
            }
        } else {
            let next_counter = self.last.counter + 1;
            if next_counter > MAX_COUNTER {
                self.last.wall_ms += 1;
                self.last.counter = 0;
            } else {
                self.last.counter = next_counter;
            }
        }

        Ok(self.last.clone())
    }
}

pub fn system_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn load_clock_from_tx(tx: &Transaction<'_>) -> AppResult<HlcClock> {
    let device_id: String = tx
        .query_row(
            "SELECT value FROM meta WHERE key = 'device_id'",
            [],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_else(|| "00000000".to_string());

    let hlc_last_opt: Option<String> = tx
        .query_row("SELECT value FROM meta WHERE key = 'hlc_last'", [], |row| {
            row.get(0)
        })
        .optional()?;

    match hlc_last_opt {
        Some(raw) => {
            let parsed = HlcTimestamp::from_str(&raw)?;
            Ok(HlcClock::new(HlcTimestamp {
                wall_ms: parsed.wall_ms,
                counter: parsed.counter,
                device_id,
            }))
        }
        None => HlcClock::from_device_id(device_id),
    }
}

pub fn save_clock_to_tx(tx: &Transaction<'_>, clock: &HlcClock) -> AppResult<()> {
    tx.execute(
        "INSERT INTO meta (key, value) VALUES ('hlc_last', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![clock.last().to_string()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hlc_monotonicity_and_lexicographical_order() {
        let mut clock = HlcClock::from_device_id("dev00001").unwrap();
        let mut generated = Vec::new();

        // Multiple ticks at the same wall clock millisecond
        for _ in 0..10 {
            generated.push(clock.tick(1_700_000_000_000).unwrap());
        }
        // Ticks when physical clock goes backwards slightly
        for _ in 0..5 {
            generated.push(clock.tick(1_699_999_999_500).unwrap());
        }
        // Ticks when physical clock advances
        for i in 1..=5 {
            generated.push(clock.tick(1_700_000_000_000 + i * 100).unwrap());
        }

        for pair in generated.windows(2) {
            let a = &pair[0];
            let b = &pair[1];
            assert!(a < b, "Expected {:?} < {:?}", a, b);
            assert!(
                a.to_string() < b.to_string(),
                "Lexicographical order failed: {} vs {}",
                a,
                b
            );
        }
    }

    #[test]
    fn test_hlc_receive_shifts_clock() {
        let mut local = HlcClock::from_device_id("aaaa1111").unwrap();
        let t1 = local.tick(1_000_000).unwrap();
        assert_eq!(t1.to_string(), "0000001000000-00000-aaaa1111");

        // Remote is ahead of local and now_ms
        let remote = HlcTimestamp::new(1_005_000, 7, "bbbb2222").unwrap();
        let after_recv = local.receive(&remote, 1_000_100).unwrap();
        assert_eq!(after_recv.wall_ms, 1_005_000);
        assert_eq!(after_recv.counter, 8);
        assert_eq!(after_recv.device_id, "aaaa1111");
        assert!(after_recv.to_string() > remote.to_string());
    }

    #[test]
    fn test_hlc_drift_guard_rejects_beyond_24h() {
        let mut local = HlcClock::from_device_id("aaaa1111").unwrap();
        let now_ms = 1_700_000_000_000;

        // Exactly +24h is allowed
        let exact_limit = HlcTimestamp::new(now_ms + MAX_DRIFT_MS, 0, "bbbb2222").unwrap();
        assert!(local.receive(&exact_limit, now_ms).is_ok());

        // +24h + 1ms is rejected
        let over_limit = HlcTimestamp::new(now_ms + MAX_DRIFT_MS + 1, 0, "bbbb2222").unwrap();
        let err = local.receive(&over_limit, now_ms).unwrap_err();
        assert_eq!(err.code(), "CLOCK_DRIFT_EXCEEDED");
    }
}

