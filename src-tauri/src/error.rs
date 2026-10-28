use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Invalid book ID format: {0}")]
    InvalidBookId(String),

    #[error("Book not found: {0}")]
    BookNotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Entity not found: {0}")]
    NotFound(String),

    #[error("Clock drift exceeded maximum allowed threshold (+24h): {0}")]
    ClockDriftExceeded(String),

    #[error("Invalid HLC timestamp: {0}")]
    InvalidHlc(String),

    #[error("Arithmetic overflow occurred during calculation")]
    ArithmeticOverflow,

    #[error("Account merge conflict: {0}")]
    MergeConflict(String),

    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Cryptography error: {0}")]
    Crypto(String),

    #[error("Task join error: {0}")]
    TaskJoin(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::InvalidBookId(_) => "INVALID_BOOK_ID",
            AppError::BookNotFound(_) => "BOOK_NOT_FOUND",
            AppError::Validation(_) => "VALIDATION_ERROR",
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::ClockDriftExceeded(_) => "CLOCK_DRIFT_EXCEEDED",
            AppError::InvalidHlc(_) => "INVALID_HLC",
            AppError::ArithmeticOverflow => "ARITHMETIC_OVERFLOW",
            AppError::MergeConflict(_) => "MERGE_CONFLICT",
            AppError::Database(_) => "DATABASE_ERROR",
            AppError::Serialization(_) => "SERIALIZATION_ERROR",
            AppError::Io(_) => "IO_ERROR",
            AppError::Crypto(_) => "CRYPTO_ERROR",
            AppError::TaskJoin(_) => "TASK_JOIN_ERROR",
            AppError::Internal(_) => "INTERNAL_ERROR",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

