//! Error codes (V2_SPEC 8.9). Anchor-style custom codes 6000-6023; the order is normative.

use solana_program::program_error::ProgramError;

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PoolError {
    /// Pool paused.
    Paused = 6000,
    /// Wrong length or discriminator.
    BadIx = 6001,
    /// A field element `>= r`.
    NonCanonicalField = 6002,
    /// Both public legs non-zero.
    BadPublicAmount = 6003,
    /// `ext_data` length or version.
    BadExtData = 6004,
    /// `ext_data.pool_id` mismatch.
    WrongPool = 6005,
    /// `assoc_root != 0` in Phase 1.
    AssocDisabled = 6006,
    /// Root not at `root_hint`, or zero.
    UnknownRoot = 6007,
    /// `claimed_epoch` outside the window.
    EpochWindow = 6008,
    /// `nf0 == nf1`.
    DuplicateNullifier = 6009,
    /// Record account not the canonical PDA, or in a foreign state.
    NullifierAccount = 6010,
    /// Nullifier already recorded.
    NullifierSpent = 6011,
    /// Groth16 verification failed.
    ProofInvalid = 6012,
    /// An account of 8.4 does not match.
    AccountMismatch = 6013,
    /// Public or relayer account is not a token account of `mint`.
    TokenAccountInvalid = 6014,
    /// Fee rule of 8.5 step 4.
    BadFee = 6015,
    /// Withdraw above `supply`.
    Supply = 6016,
    /// `vault.amount < supply` after the transact.
    Solvency = 6017,
    /// Beta outflow cap reached.
    OutflowCap = 6018,
    /// `next_index > 2^32 - 2`.
    TreeFull = 6019,
    /// The vault received a different amount.
    DepositDelta = 6020,
    /// `register_mint` allowlist.
    MintExtensionRejected = 6021,
    /// Admin instruction without the authority.
    Unauthorized = 6022,
    /// Checked arithmetic overflow.
    Arithmetic = 6023,
}

impl PoolError {
    /// All codes in order (6000..=6023).
    pub const ALL: [PoolError; 24] = [
        PoolError::Paused,
        PoolError::BadIx,
        PoolError::NonCanonicalField,
        PoolError::BadPublicAmount,
        PoolError::BadExtData,
        PoolError::WrongPool,
        PoolError::AssocDisabled,
        PoolError::UnknownRoot,
        PoolError::EpochWindow,
        PoolError::DuplicateNullifier,
        PoolError::NullifierAccount,
        PoolError::NullifierSpent,
        PoolError::ProofInvalid,
        PoolError::AccountMismatch,
        PoolError::TokenAccountInvalid,
        PoolError::BadFee,
        PoolError::Supply,
        PoolError::Solvency,
        PoolError::OutflowCap,
        PoolError::TreeFull,
        PoolError::DepositDelta,
        PoolError::MintExtensionRejected,
        PoolError::Unauthorized,
        PoolError::Arithmetic,
    ];

    pub const fn code(self) -> u32 {
        self as u32
    }
}

impl From<PoolError> for ProgramError {
    fn from(e: PoolError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

/// Map a transcript-crate error onto the program code that the spec assigns to it.
pub fn from_transcript(e: dark_null_transcript::Error) -> ProgramError {
    use dark_null_transcript::Error as E;
    match e {
        E::NonCanonicalField => PoolError::NonCanonicalField.into(),
        E::BothLegsNonZero => PoolError::BadPublicAmount.into(),
        E::TreeFull => PoolError::TreeFull.into(),
        E::RootHint => PoolError::UnknownRoot.into(),
        E::DuplicateNullifier => PoolError::DuplicateNullifier.into(),
        E::Length => PoolError::BadIx.into(),
        // a Poseidon or SHA backend failure is not reachable with canonical inputs
        _ => ProgramError::InvalidArgument,
    }
}
