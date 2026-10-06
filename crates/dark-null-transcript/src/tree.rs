//! Depth-32 Poseidon Merkle tree: zero values, the on-chain pair-insertion algorithm, the root
//! history ring, and client-side path recomputation (V2_SPEC section 6).

use crate::error::Error;
use crate::fr::{Fr32, ZERO};
use crate::hash::PoseidonHasher;

/// Tree depth (2^32 leaves).
pub const DEPTH: usize = 32;
/// Root history ring size.
pub const ROOT_HISTORY: usize = 256;

/// `ZEROS[0] = 0` (empty leaf); `ZEROS[i+1] = Poseidon(ZEROS[i], ZEROS[i])`; `ZEROS[32]` is the empty root.
/// Pinned by vector V-E2E `tree.zeros`; the `zeros_match_poseidon` test recomputes them.
pub const ZEROS: [Fr32; DEPTH + 1] = include!("zeros.in");

/// Insert `cm0` at leaf `next_index` and `cm1` at `next_index + 1` (an aligned depth-1 subtree) and
/// return the new root. `filled[level]` (levels 1..31) holds the last left node seen at that level;
/// index 0 is unused. Exactly 32 Poseidon(2) calls.
pub fn insert_pair<H: PoseidonHasher>(h: &H, filled: &mut [Fr32; DEPTH], next_index: u64, cm0: &Fr32, cm1: &Fr32) -> Result<Fr32, Error> {
    if next_index % 2 != 0 || next_index > (1u64 << DEPTH) - 2 {
        return Err(Error::TreeFull);
    }
    let mut node = h.poseidon(&[*cm0, *cm1])?;
    let mut idx = next_index >> 1;
    for level in 1..DEPTH {
        node = if idx & 1 == 0 {
            filled[level] = node;
            h.poseidon(&[node, ZEROS[level]])?
        } else {
            h.poseidon(&[filled[level], node])?
        };
        idx >>= 1;
    }
    Ok(node)
}

/// Root of a leaf from its authentication path (`siblings[0]` is the leaf's sibling).
pub fn root_from_path<H: PoseidonHasher>(h: &H, leaf: &Fr32, index: u64, siblings: &[Fr32; DEPTH]) -> Result<Fr32, Error> {
    if index >= 1u64 << DEPTH {
        return Err(Error::LeafIndex);
    }
    let mut node = *leaf;
    for (level, sib) in siblings.iter().enumerate() {
        node = if (index >> level) & 1 == 0 { h.poseidon(&[node, *sib])? } else { h.poseidon(&[*sib, node])? };
    }
    Ok(node)
}

/// Root history: `roots[head]` is the current root. Slot 0 starts as the empty root.
#[derive(Clone, Debug)]
pub struct RootRing {
    pub roots: [Fr32; ROOT_HISTORY],
    pub head: u16,
}

impl Default for RootRing {
    fn default() -> Self {
        let mut roots = [ZERO; ROOT_HISTORY];
        roots[0] = ZEROS[DEPTH];
        Self { roots, head: 0 }
    }
}

impl RootRing {
    /// Append a new root; returns its slot (the next root hint).
    pub fn push(&mut self, root: Fr32) -> u16 {
        self.head = ((self.head as usize + 1) % ROOT_HISTORY) as u16;
        self.roots[self.head as usize] = root;
        self.head
    }

    /// O(1) membership check used by the program: `root != 0 && roots[hint] == root`.
    pub fn check(&self, hint: u16, root: &Fr32) -> Result<(), Error> {
        if hint as usize >= ROOT_HISTORY || *root == ZERO || self.roots[hint as usize] != *root {
            return Err(Error::RootHint);
        }
        Ok(())
    }
}
