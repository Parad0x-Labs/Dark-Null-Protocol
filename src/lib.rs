use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};
use base64::{Engine as _, engine::general_purpose};
use groth16_solana::groth16::Groth16Verifier;

pub mod verifying_key;
pub use verifying_key::VERIFYING_KEY;

declare_id!("35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV");
pub const ROOT_WINDOW: usize = 20;
pub const LEAF_WINDOW: usize = 128;
pub const WITHDRAW_V2_PUBLIC_INPUTS: usize = 8;
pub const BN254_FR_BYTES: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91,
    0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

fn is_fr_scalar(input: &[u8; 32]) -> bool {
    input.as_slice() < BN254_FR_BYTES.as_slice()
}

fn require_fr_public_inputs<const N: usize>(public_inputs: &[[u8; 32]; N]) -> Result<()> {
    for input in public_inputs.iter() {
        require!(is_fr_scalar(input), ErrorCode::InvalidProof);
    }
    Ok(())
}

fn verify_withdraw_v2_public_inputs(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]; WITHDRAW_V2_PUBLIC_INPUTS],
) -> Result<()> {
    require!(
        verifying_key::NR_PUBINPUTS == WITHDRAW_V2_PUBLIC_INPUTS,
        ErrorCode::InvalidProof
    );
    require_fr_public_inputs(public_inputs)?;

    let mut verifier = Groth16Verifier::new(
        proof_a,
        proof_b,
        proof_c,
        public_inputs,
        &VERIFYING_KEY,
    ).map_err(|_| ErrorCode::InvalidProof)?;

    verifier.verify().map_err(|_| ErrorCode::InvalidProof.into())
}

fn encode_u64_public_input(value: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..32].copy_from_slice(&value.to_be_bytes());
    out
}

fn split_pubkey_public_inputs(pubkey: &Pubkey) -> ([u8; 32], [u8; 32]) {
    let bytes = pubkey.as_ref();
    let mut part_0 = [0u8; 32];
    let mut part_1 = [0u8; 32];
    part_0[16..32].copy_from_slice(&bytes[0..16]);
    part_1[16..32].copy_from_slice(&bytes[16..32]);
    (part_0, part_1)
}

#[program]
pub mod paradox {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let mut vault = ctx.accounts.vault.load_init()?;
        vault.initialize_state();
        ctx.accounts.root_authority.authority = ctx.accounts.user.key();
        Ok(())
    }

    pub fn rotate_root_authority(
        ctx: Context<RotateRootAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        ctx.accounts.root_authority.authority = new_authority;
        Ok(())
    }

    // --- ALICE: DEPOSIT wSOL INTO THE ABYSS ---
    pub fn deposit_wsol_and_whisper(
        ctx: Context<DepositWsol>,
        amount: u64,
        commitment: [u8; 32],
        encrypted_note: Vec<u8>,
        ephemeral_pubkey: [u8; 32],
        view_tag: u8
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require_keys_eq!(
            ctx.accounts.user_wsol.mint,
            ctx.accounts.vault_wsol.mint,
            ErrorCode::InvalidPayoutAccount
        );
        require_keys_eq!(
            ctx.accounts.vault_wsol.owner,
            ctx.accounts.vault.key(),
            ErrorCode::InvalidPayoutAccount
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_wsol.to_account_info(),
                    to: ctx.accounts.vault_wsol.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let mut vault = ctx.accounts.vault.load_mut()?;
        let (leaf_index, credited) = vault.credit_deposit(commitment, amount)?;
        require!(credited > 0, ErrorCode::InvalidAmount);

        msg!("PDX_WHISPER:{}", general_purpose::STANDARD.encode(&encrypted_note));
        msg!("PDX_EPHEMERAL:{}", general_purpose::STANDARD.encode(&ephemeral_pubkey));
        msg!("PDX_TAG:{}", view_tag);
        msg!("LEAF_INDEX:{}", leaf_index);
        Ok(())
    }

    pub fn update_root(
        ctx: Context<UpdateRoot>,
        new_root: [u8; 32]
    ) -> Result<()> {
        let mut vault = ctx.accounts.vault.load_mut()?;
        vault.append_root(new_root)?;
        msg!("Abyss Root Updated: {:?}", new_root);
        Ok(())
    }

    // --- BOB: PHANTOM WITHDRAW ---
    pub fn prepare_phantom_withdraw(
        ctx: Context<PrepareWithdraw>,
        amount: u64,
        nullifier_hash: [u8; 32],
        root: [u8; 32],
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: [[u8; 32]; 3]
    ) -> Result<()> {
        let _ = (amount, ctx.accounts.receiver.key(), ctx.accounts.receiver_token.key());
        let _ = (&nullifier_hash, &root, &proof_a, &proof_b, &proof_c, &public_inputs);

        err!(ErrorCode::UnsafePublicWithdrawPath)
    }

    pub fn prepare_phantom_withdraw_v2(
        ctx: Context<PrepareWithdrawV2>,
        amount: u64,
        nullifier_hash: [u8; 32],
        root: [u8; 32],
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: [[u8; 32]; 8]
    ) -> Result<()> {
        let receiver_token_key = ctx.accounts.receiver_token.key();
        let mint_key = ctx.accounts.mint.key();
        let (receiver_token_part_0, receiver_token_part_1) =
            split_pubkey_public_inputs(&receiver_token_key);
        let (mint_part_0, mint_part_1) = split_pubkey_public_inputs(&mint_key);

        require!(public_inputs[1] == nullifier_hash, ErrorCode::InvalidProof);
        require!(public_inputs[2] == root, ErrorCode::InvalidProof);
        require!(public_inputs[3] == encode_u64_public_input(amount), ErrorCode::InvalidProof);
        require!(public_inputs[4] == receiver_token_part_0, ErrorCode::InvalidProof);
        require!(public_inputs[5] == receiver_token_part_1, ErrorCode::InvalidProof);
        require!(public_inputs[6] == mint_part_0, ErrorCode::InvalidProof);
        require!(public_inputs[7] == mint_part_1, ErrorCode::InvalidProof);

        require_keys_eq!(
            ctx.accounts.vault_token.owner,
            ctx.accounts.vault.key(),
            ErrorCode::InvalidPayoutAccount
        );
        require_keys_eq!(
            ctx.accounts.vault_token.mint,
            mint_key,
            ErrorCode::InvalidPayoutAccount
        );
        require_keys_eq!(
            ctx.accounts.receiver_token.owner,
            ctx.accounts.receiver.key(),
            ErrorCode::InvalidPayoutAccount
        );
        require_keys_eq!(
            ctx.accounts.receiver_token.mint,
            mint_key,
            ErrorCode::InvalidPayoutAccount
        );

        {
            let vault = ctx.accounts.vault.load()?;
            require!(vault.contains_root(&root), ErrorCode::InvalidRoot);
        }

        verify_withdraw_v2_public_inputs(
            &proof_a,
            &proof_b,
            &proof_c,
            &public_inputs,
        )?;

        {
            let mut vault = ctx.accounts.vault.load_mut()?;
            // Duplicate check + append happen atomically across all supplied
            // nullifier pages (audit H1 / C3-style interleaving defense).
            record_nullifier(
                &ctx.accounts.vault.key(),
                &crate::ID,
                vault.nullifier_count,
                &nullifier_hash,
                ctx.remaining_accounts,
            )?;
            vault.nullifier_count = vault
                .nullifier_count
                .checked_add(1)
                .ok_or(ErrorCode::InvalidNullifierPage)?;
            // Solvency: the paid amount must be covered by what was actually
            // deposited against this commitment (audit C1).
            vault.debit_withdrawal(public_inputs[0], amount)?;
        }

        let vault_bump = ctx.bumps.vault;
        let signer_seeds: &[&[&[u8]]] = &[&[b"merkle_vault", &[vault_bump]]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token.to_account_info(),
                    to: ctx.accounts.receiver_token.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        msg!("ZK_VERIFY_V2: payout-bound proof verified and withdrawal paid");
        Ok(())
    }

    /// Creates the next nullifier page PDA so withdrawals can proceed past the
    /// legacy fixed window (audit H1). Permissionless: any payer can fund rent,
    /// the page index is derived from on-chain state.
    pub fn init_nullifier_page(
        ctx: Context<InitNullifierPage>,
        page_index: u8,
    ) -> Result<()> {
        let vault = ctx.accounts.vault.load()?;
        let expected = (vault.nullifier_count as usize / NULLIFIER_PAGE_CAP) as u8;
        require!(page_index == expected, ErrorCode::InvalidNullifierPage);
        msg!("Nullifier page {} initialized", page_index);
        Ok(())
    }

    pub fn burn_and_whisper(ctx: Context<BurnToken>, amount: u64, _commitment: [u8; 32], encrypted_note: Vec<u8>, ephemeral_pubkey: [u8; 32], view_tag: u8) -> Result<()> {
        token::burn(CpiContext::new(ctx.accounts.token_program.to_account_info(), Burn { mint: ctx.accounts.mint.to_account_info(), from: ctx.accounts.user_token.to_account_info(), authority: ctx.accounts.user.to_account_info() }), amount)?;
        msg!("PDX_WHISPER:{}", general_purpose::STANDARD.encode(&encrypted_note));
        msg!("PDX_EPHEMERAL:{}", general_purpose::STANDARD.encode(&ephemeral_pubkey));
        msg!("PDX_TAG:{}", view_tag);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = user, space = 8 + std::mem::size_of::<Vault>(), seeds = [b"merkle_vault"], bump)]
    pub vault: AccountLoader<'info, Vault>,
    #[account(init, payer = user, space = RootAuthorityConfig::SPACE, seeds = [b"root_authority"], bump)]
    pub root_authority: Account<'info, RootAuthorityConfig>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RotateRootAuthority<'info> {
    #[account(mut, seeds = [b"root_authority"], bump, has_one = authority @ ErrorCode::UnauthorizedRootUpdate)]
    pub root_authority: Account<'info, RootAuthorityConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DepositWsol<'info> {
    #[account(mut, seeds = [b"merkle_vault"], bump)]
    pub vault: AccountLoader<'info, Vault>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_wsol: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_wsol: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateRoot<'info> {
    #[account(mut, seeds = [b"merkle_vault"], bump)]
    pub vault: AccountLoader<'info, Vault>,
    #[account(seeds = [b"root_authority"], bump, has_one = authority @ ErrorCode::UnauthorizedRootUpdate)]
    pub root_authority: Account<'info, RootAuthorityConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct PrepareWithdraw<'info> {
    #[account(mut, seeds = [b"merkle_vault"], bump)]
    pub vault: AccountLoader<'info, Vault>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub receiver_token: Account<'info, TokenAccount>, // Bob's ATA
    pub receiver: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct PrepareWithdrawV2<'info> {
    #[account(mut, seeds = [b"merkle_vault"], bump)]
    pub vault: AccountLoader<'info, Vault>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub receiver_token: Account<'info, TokenAccount>,
    pub receiver: Signer<'info>,
    pub token_program: Program<'info, Token>,
}


#[derive(Accounts)]
#[instruction(page_index: u8)]
pub struct InitNullifierPage<'info> {
    #[account(seeds = [b"merkle_vault"], bump)]
    pub vault: AccountLoader<'info, Vault>,
    #[account(
        init,
        payer = payer,
        space = NullifierPage::SPACE,
        seeds = [b"nullifier_page", vault.key().as_ref(), &[page_index]],
        bump
    )]
    pub page: Account<'info, NullifierPage>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BurnToken<'info> {
    #[account(mut, seeds = [b"merkle_vault"], bump)]
    pub vault: AccountLoader<'info, Vault>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account(zero_copy)]
#[repr(C)]
pub struct Vault {
    pub roots: [[u8; 32]; ROOT_WINDOW],
    pub root_count: u32,
    /// Total nullifiers ever recorded. The per-entry bytes live in NullifierPage
    /// PDAs so the spent-set can grow past any fixed window (audit H1).
    pub nullifier_count: u32,
    pub leaf_count: u64,
    pub next_index: u32,
    pub _reserved: [u8; 4],
    pub leaves: [u8; LEAF_WINDOW * 32],
    /// Cumulative deposited token amount per leaf slot. Withdrawals are capped by
    /// this so a commitment can never claim more than was actually deposited
    /// against it (audit C1).
    pub deposited_amounts: [u64; LEAF_WINDOW],
}

/// Number of nullifier entries stored per NullifierPage PDA.
/// Kept at 32 so Borsh derive code stays inside the SBF 4 KiB stack frame
/// (64 entries overflowed it at build time).
pub const NULLIFIER_PAGE_CAP: usize = 32;
/// Maximum number of nullifier pages addressable (page index is u8).
pub const MAX_NULLIFIER_PAGES: usize = 256;

/// Fixed-size page of spent nullifiers, addressed by PDA seeds
/// `[b"nullifier_page", vault.key(), &[page_index]]` (audit H1).
/// Serialized layout: discriminator(8) || entries[64][32] || count u32 —
/// `record_nullifier` writes raw bytes at those exact offsets.
#[account]
#[repr(C)]
pub struct NullifierPage {
    pub entries: [[u8; 32]; NULLIFIER_PAGE_CAP],
    pub count: u32,
}

#[account]
pub struct RootAuthorityConfig {
    pub authority: Pubkey,
}

impl RootAuthorityConfig {
    pub const SPACE: usize = 8 + 32;

    pub fn assert_authority(&self, signer: &Pubkey) -> Result<()> {
        require_keys_eq!(self.authority, *signer, ErrorCode::UnauthorizedRootUpdate);
        Ok(())
    }
}

impl Vault {
    pub fn initialize_state(&mut self) {
        self.roots = [[0; 32]; ROOT_WINDOW];
        self.root_count = 0;
        self.nullifier_count = 0;
        self.leaf_count = 0;
        self.next_index = 0;
        self._reserved = [0; 4];
        self.leaves = [0; LEAF_WINDOW * 32];
        self.deposited_amounts = [0; LEAF_WINDOW];
    }

    /// Returns the leaf slot holding `commitment`, appending a new slot if absent.
    /// Credits `amount` to the commitment's cumulative deposited total.
    pub fn credit_deposit(&mut self, commitment: [u8; 32], amount: u64) -> Result<(u64, u64)> {
        let mut slot: Option<usize> = None;
        for index in 0..self.next_index as usize {
            let start = index * 32;
            if self.leaves[start..start + 32] == commitment[..] {
                slot = Some(index);
                break;
            }
        }

        let index = match slot {
            Some(index) => index,
            None => self.append_leaf(commitment)? as usize,
        };

        let updated = self.deposited_amounts[index]
            .checked_add(amount)
            .ok_or(ErrorCode::DepositOverflow)?;
        self.deposited_amounts[index] = updated;
        Ok((index as u64, updated))
    }

    /// Debits up to `amount` from the commitment's deposited total. Reverts if the
    /// commitment has no recorded deposits or insufficient cumulative balance.
    pub fn debit_withdrawal(&mut self, commitment: [u8; 32], amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        let mut slot: Option<usize> = None;
        for index in 0..self.next_index as usize {
            let start = index * 32;
            if self.leaves[start..start + 32] == commitment[..] {
                slot = Some(index);
                break;
            }
        }
        let index = slot.ok_or(ErrorCode::UnknownCommitment)?;
        require!(
            self.deposited_amounts[index] >= amount,
            ErrorCode::InsufficientCommittedDeposit
        );
        self.deposited_amounts[index] -= amount;
        Ok(())
    }

    pub fn append_leaf(&mut self, commitment: [u8; 32]) -> Result<u64> {
        require!(
            (self.next_index as usize) < LEAF_WINDOW,
            ErrorCode::LeafStorageFull
        );

        let start = (self.next_index as usize) * 32;
        self.leaves[start..start + 32].copy_from_slice(&commitment);
        let leaf_index = self.leaf_count;
        self.next_index += 1;
        self.leaf_count += 1;
        Ok(leaf_index)
    }

    /// Ring-buffer root window: once full, the oldest root is evicted. Standard
    /// root-history semantics — proofs must reference a recent tree root.
    pub fn append_root(&mut self, new_root: [u8; 32]) -> Result<()> {
        // Reject duplicates so a compromised authority cannot flood the ring
        // window with a single root and evict honest history (audit H3).
        require!(!self.contains_root(&new_root), ErrorCode::DuplicateRoot);
        let slot = if (self.root_count as usize) < ROOT_WINDOW {
            self.root_count as usize
        } else {
            // Window full: evict the oldest entry.
            (self.root_count as usize) % ROOT_WINDOW
        };
        self.roots[slot] = new_root;
        self.root_count = self.root_count.checked_add(1).ok_or(ErrorCode::RootStorageFull)?;
        Ok(())
    }

    pub fn contains_root(&self, root: &[u8; 32]) -> bool {
        let populated = (self.root_count as usize).min(ROOT_WINDOW);
        self.roots[..populated]
            .iter()
            .any(|candidate| candidate == root)
    }
}

/// PDA seeds for nullifier page `page` of `vault`.
pub fn nullifier_page_seeds(vault_key: &Pubkey, page: u8) -> [Vec<u8>; 3] {
    [b"nullifier_page".to_vec(), vault_key.to_bytes().to_vec(), vec![page]]
}

pub fn derive_nullifier_page_address(vault_key: &Pubkey, page: u8, program_id: &Pubkey) -> Pubkey {
    let seeds = nullifier_page_seeds(vault_key, page);
    let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
    Pubkey::find_program_address(&seed_refs, program_id).0
}

/// Loads and validates a nullifier page account supplied by the caller.
fn load_nullifier_page(
    vault_key: &Pubkey,
    page: u8,
    program_id: &Pubkey,
    info: &AccountInfo,
) -> Result<NullifierPage> {
    let expected = derive_nullifier_page_address(vault_key, page, program_id);
    require_keys_eq!(expected, info.key(), ErrorCode::InvalidNullifierPage);
    require!(
        info.owner == &crate::ID,
        ErrorCode::InvalidNullifierPage
    );
    let data = info.try_borrow_data()?;
    require!(
        data.len() >= 8 + std::mem::size_of::<NullifierPage>(),
        ErrorCode::InvalidNullifierPage
    );
    let page_state = NullifierPage::try_from_slice(&data[8..])
        .map_err(|_| error!(ErrorCode::InvalidNullifierPage))?;
    Ok(page_state)
}

/// Appends `nullifier_hash` to the correct page among `pages` (which must cover
/// pages 0..=current), enforcing no duplicates. Returns the updated page index.
fn record_nullifier(
    vault_key: &Pubkey,
    program_id: &Pubkey,
    nullifier_count: u32,
    nullifier_hash: &[u8; 32],
    pages: &[AccountInfo],
) -> Result<()> {
    let total = nullifier_count as usize;
    let current_page = total / NULLIFIER_PAGE_CAP;
    require!(
        pages.len() == current_page + 1,
        ErrorCode::InvalidNullifierPage
    );

    for (index, info) in pages.iter().enumerate() {
        let page_state =
            load_nullifier_page(vault_key, index as u8, program_id, info)?;

        if index < current_page {
            // Fully populated historical page — must contain exactly its cap.
            require!(
                page_state.count as usize == NULLIFIER_PAGE_CAP,
                ErrorCode::InvalidNullifierPage
            );
        } else {
            require!(
                page_state.count as usize == total % NULLIFIER_PAGE_CAP,
                ErrorCode::InvalidNullifierPage
            );
        }

        for entry in page_state.entries[..page_state.count as usize].iter() {
            require!(entry != nullifier_hash, ErrorCode::DoubleSpend);
        }
    }

    // Append into the current (last) page. Zero-copy layout is declaration
    // order: entries[64][32] then count u32, after the 8-byte discriminator.
    let last = pages.last().ok_or(ErrorCode::InvalidNullifierPage)?;
    let mut data = last.try_borrow_mut_data()?;
    let entries_start = 8usize;
    let count_offset = entries_start + NULLIFIER_PAGE_CAP * 32;

    let slot = total % NULLIFIER_PAGE_CAP;
    data[entries_start + slot * 32..entries_start + (slot + 1) * 32]
        .copy_from_slice(nullifier_hash);
    let new_count = (total % NULLIFIER_PAGE_CAP) as u32 + 1;
    data[count_offset..count_offset + 4].copy_from_slice(&new_count.to_le_bytes());
    Ok(())
}

impl NullifierPage {
    pub const SPACE: usize = 8 + std::mem::size_of::<Self>();
}

#[error_code]
pub enum ErrorCode {
    #[msg("Nullifier already used.")]
    DoubleSpend,
    #[msg("Merkle Root invalid.")]
    InvalidRoot,
    #[msg("Merkle root already present in the window.")]
    DuplicateRoot,
    #[msg("Nullifier page account invalid, missing, or out of order.")]
    InvalidNullifierPage,
    #[msg("Invalid ZK Proof.")]
    InvalidProof,
    #[msg("Leaf storage is full.")]
    LeafStorageFull,
    #[msg("Root storage is full.")]
    RootStorageFull,
    #[msg("Signer is not authorized to update roots.")]
    UnauthorizedRootUpdate,
    #[msg("Legacy public withdraw payout path is disabled because its proof shape does not bind payout semantics.")]
    UnsafePublicWithdrawPath,
    #[msg("Payout token account ownership or mint binding is invalid.")]
    InvalidPayoutAccount,
    #[msg("Deposit amount must be greater than zero and cannot overflow.")]
    DepositOverflow,
    #[msg("Amount must be greater than zero.")]
    InvalidAmount,
    #[msg("Commitment has never been deposited to.")]
    UnknownCommitment,
    #[msg("Withdrawal amount exceeds what was deposited against this commitment.")]
    InsufficientCommittedDeposit,
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::error::Error;

    #[test]
    fn canonical_program_id_is_bound() {
        assert_eq!(ID.to_string(), "35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV");
    }

    #[test]
    fn verifying_key_uses_withdraw_v2_public_inputs() {
        assert_eq!(verifying_key::NR_PUBINPUTS, WITHDRAW_V2_PUBLIC_INPUTS);
        assert_eq!(VERIFYING_KEY.nr_pubinputs, WITHDRAW_V2_PUBLIC_INPUTS);
        assert_eq!(WITHDRAW_V2_PUBLIC_INPUTS, 8);
    }

    #[test]
    fn bn254_fr_scalar_range_check_is_stable() {
        assert!(is_fr_scalar(&[0u8; 32]));
        assert!(!is_fr_scalar(&BN254_FR_BYTES));

        let mut max_valid = BN254_FR_BYTES;
        max_valid[31] -= 1;
        assert!(is_fr_scalar(&max_valid));
    }

    #[test]
    fn withdraw_v2_public_input_encoding_is_stable() {
        assert_eq!(
            encode_u64_public_input(42),
            [
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 42,
            ]
        );

        let key = Pubkey::new_from_array([
            0, 1, 2, 3, 4, 5, 6, 7,
            8, 9, 10, 11, 12, 13, 14, 15,
            16, 17, 18, 19, 20, 21, 22, 23,
            24, 25, 26, 27, 28, 29, 30, 31,
        ]);
        let (part_0, part_1) = split_pubkey_public_inputs(&key);
        assert_eq!(&part_0[0..16], &[0u8; 16]);
        assert_eq!(&part_0[16..32], &key.as_ref()[0..16]);
        assert_eq!(&part_1[0..16], &[0u8; 16]);
        assert_eq!(&part_1[16..32], &key.as_ref()[16..32]);
    }

    #[test]
    fn vault_layout_still_matches_expected_window_sizes() {
        assert_eq!(std::mem::size_of::<Vault>(), 5784);
    }

    #[test]
    fn withdrawal_cannot_exceed_deposited_amount_for_commitment() {
        let commitment = [9u8; 32];
        let mut vault = Vault {
            roots: [[0; 32]; ROOT_WINDOW],
            root_count: 0,
            nullifier_count: 0,
            leaf_count: 0,
            next_index: 0,
            _reserved: [0; 4],
            leaves: [0; LEAF_WINDOW * 32],
            deposited_amounts: [0; LEAF_WINDOW],
        };

        // Deposit credits are cumulative per commitment.
        vault.credit_deposit(commitment, 100).expect("first deposit");
        let (_, total) = vault.credit_deposit(commitment, 50).expect("top-up");
        assert_eq!(total, 150);

        // Over-claiming past the deposited total must revert (audit C1).
        assert!(matches!(
            vault.debit_withdrawal(commitment, 151),
            Err(Error::AnchorError(_))
        ));

        // Exact and partial debits succeed.
        vault.debit_withdrawal(commitment, 150).expect("full debit");
        assert!(matches!(
            vault.debit_withdrawal(commitment, 1),
            Err(Error::AnchorError(_))
        ));

        // Never-deposited commitments cannot withdraw at all.
        assert!(matches!(
            vault.debit_withdrawal([8u8; 32], 1),
            Err(Error::AnchorError(_))
        ));
    }

    #[test]
    fn root_authority_rejects_unauthorized_signer() {
        let authority = Pubkey::new_unique();
        let config = RootAuthorityConfig { authority };
        let wrong_signer = Pubkey::new_unique();

        assert!(matches!(config.assert_authority(&wrong_signer), Err(Error::AnchorError(_))));
        assert!(config.assert_authority(&authority).is_ok());
    }

    #[test]
    fn vault_rejects_leaf_overflow_instead_of_wrapping() {
        let mut vault = Vault {
            roots: [[0; 32]; ROOT_WINDOW],
            root_count: 0,
            nullifier_count: 0,
            leaf_count: LEAF_WINDOW as u64,
            next_index: LEAF_WINDOW as u32,
            _reserved: [0; 4],
            leaves: [0; LEAF_WINDOW * 32],
            deposited_amounts: [0; LEAF_WINDOW],
        };

        assert!(matches!(vault.append_leaf([7; 32]), Err(Error::AnchorError(_))));
    }

    #[test]
    fn vault_rejects_root_overflow_instead_of_wrapping() {
        let mut vault = Vault {
            roots: [[1; 32]; ROOT_WINDOW],
            root_count: ROOT_WINDOW as u32,
            nullifier_count: 0,
            leaf_count: 0,
            next_index: 0,
            _reserved: [0; 4],
            leaves: [0; LEAF_WINDOW * 32],
            deposited_amounts: [0; LEAF_WINDOW],
        };

        // root_count saturating the ring must still refuse to overflow u32.
        vault.root_count = u32::MAX;
        assert!(matches!(vault.append_root([9; 32]), Err(Error::AnchorError(_))));
    }

    #[test]
    fn root_window_is_a_ring_buffer_once_full() {
        let mut vault = Vault {
            roots: [[0; 32]; ROOT_WINDOW],
            root_count: 0,
            nullifier_count: 0,
            leaf_count: 0,
            next_index: 0,
            _reserved: [0; 4],
            leaves: [0; LEAF_WINDOW * 32],
            deposited_amounts: [0; LEAF_WINDOW],
        };

        let oldest = [1u8; 32];
        vault.append_root(oldest).expect("first root");
        for i in 1..ROOT_WINDOW as u8 {
            vault.append_root([i + 1; 32]).expect("fill roots");
        }
        assert_eq!(vault.root_count, ROOT_WINDOW as u32);
        assert!(vault.contains_root(&oldest));

        // Window full: appending evicts the oldest entry instead of failing.
        let fresh = [0xAA; 32];
        vault.append_root(fresh).expect("ring append");
        assert_eq!(vault.root_count, (ROOT_WINDOW + 1) as u32);
        assert!(!vault.contains_root(&oldest), "oldest root must be evicted");
        assert!(vault.contains_root(&fresh));
    }
}
