//! x402 quote binding for `dark-null-exact` (V2_SPEC 11.1). Goes into `ext_data.memo_binding`.

use crate::ds::TAG_QUOTE;
use crate::error::Error;
use crate::hash::sha256;
use sha2::{Digest, Sha256};

/// The DNA x402 quote fields that the payment binds.
#[derive(Clone, Copy, Debug)]
pub struct QuoteFields<'a> {
    pub quote_id: &'a str,
    pub resource: &'a str,
    pub amount_atomic: u64,
    pub total_atomic: u64,
    pub mint: [u8; 32],
    /// The merchant's shielded address string (`dnull1...`).
    pub pay_to: &'a str,
    /// `expiresAt` as Unix seconds.
    pub expires_at_unix: i64,
}

/// `SHA256(TAG_QUOTE || LP16(quoteId) || SHA256(resource) || LE64(amountAtomic) || LE64(totalAtomic)
///  || mint || LP16(payTo) || LE64(expiresAt))`, LP16 = u16 little-endian byte length prefix.
pub fn quote_binding(q: &QuoteFields<'_>) -> Result<[u8; 32], Error> {
    let qid = q.quote_id.as_bytes();
    let pay = q.pay_to.as_bytes();
    if qid.len() > u16::MAX as usize || pay.len() > u16::MAX as usize {
        return Err(Error::StringTooLong);
    }
    let mut h = Sha256::new();
    h.update(TAG_QUOTE);
    h.update((qid.len() as u16).to_le_bytes());
    h.update(qid);
    h.update(sha256(&[q.resource.as_bytes()]));
    h.update(q.amount_atomic.to_le_bytes());
    h.update(q.total_atomic.to_le_bytes());
    h.update(q.mint);
    h.update((pay.len() as u16).to_le_bytes());
    h.update(pay);
    h.update(q.expires_at_unix.to_le_bytes());
    Ok(h.finalize().into())
}
