//! Events (V2_SPEC 8.10). The program writes nothing else to the log: no `msg!`, no instruction-name log. Every
//! logged value is already in the instruction data or in account state.

use solana_program::log::sol_log_data;

/// Tag of the per-transact event.
pub const TAG_TX: &[u8] = b"dnull-v2-tx";
/// Tag of the deposit event.
pub const TAG_DEP: &[u8] = b"dnull-v2-dep";

/// `["dnull-v2-tx", LE64(leaf_index_of_cm0), LE16(root_head), new_root[32]]`
pub fn emit_tx(leaf_index_cm0: u64, root_head: u16, new_root: &[u8; 32]) {
    sol_log_data(&[TAG_TX, &leaf_index_cm0.to_le_bytes(), &root_head.to_le_bytes(), new_root]);
}

/// `["dnull-v2-dep", deposit_label[32], submitter[32], mint[32], LE64(deposit_amount)]`
pub fn emit_deposit(deposit_label: &[u8; 32], submitter: &[u8; 32], mint: &[u8; 32], amount: u64) {
    sol_log_data(&[TAG_DEP, deposit_label, submitter, mint, &amount.to_le_bytes()]);
}
