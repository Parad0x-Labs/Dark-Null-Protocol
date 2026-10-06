//! Errors. Each maps to a program error code or a core API error (V2_SPEC sections 8.9 and 12.6).

/// Transcript and encoding errors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// A field element is `>= r` (`E_NONCANONICAL_FIELD`).
    NonCanonicalField,
    /// Poseidon called with 0 or more than 12 inputs.
    PoseidonArity,
    /// The Poseidon backend failed.
    PoseidonBackend,
    /// Both `deposit_amount` and `withdraw_amount` are non-zero (`E_BAD_PUBLIC_AMOUNT`).
    BothLegsNonZero,
    /// Wrong byte length for a fixed-size structure.
    Length,
    /// Unknown structure version byte.
    Version,
    /// Leaf index outside the depth-32 tree.
    LeafIndex,
    /// Tree insertion at an odd index or past 2^32 leaves (`E_TREE_FULL`).
    TreeFull,
    /// Root hint outside the 256-entry history (`E_UNKNOWN_ROOT`).
    RootHint,
    /// The two nullifiers of one transact are equal (`E_DUPLICATE_NULLIFIER`).
    DuplicateNullifier,
    /// A derived scalar is zero (abort key generation).
    ZeroScalar,
    /// bech32m: bad character, checksum, case, HRP or length.
    Address,
    /// A string field is longer than 65,535 bytes.
    StringTooLong,
    /// Output buffer too small.
    Buffer,
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        core::fmt::Debug::fmt(self, f)
    }
}

#[cfg(feature = "std")]
impl std::error::Error for Error {}
