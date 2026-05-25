use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};
use base64::{Engine as _, engine::general_purpose};
use groth16_solana::groth16::Groth16Verifier;

pub mod verifying_key;
pub use verifying_key::VERIFYING_KEY;

declare_id!("2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF");
pub const ROOT_WINDOW: usize = 20;
pub const LEAF_WINDOW: usize = 128;
pub const NULLIFIER_WINDOW: usize = 128;
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

fn verify_withdraw_public_inputs(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]; 3],
) -> Result<()> {
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
        let leaf_index = vault.append_leaf(commitment)?;

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
        let vault = ctx.accounts.vault.load_mut()?;
        let _ = (amount, ctx.accounts.receiver.key(), ctx.accounts.receiver_token.key());

        // 1. Root Check
        require!(vault.contains_root(&root), ErrorCode::InvalidRoot);

        // 2. Double Spend Check
        require!(
            !vault.contains_nullifier(&nullifier_hash),
            ErrorCode::DoubleSpend
        );

        // 3. GROTH16-SOLANA VERIFICATION
        // Consistency checks: ensure public inputs match instruction arguments
        // Order: [Commitment, Nullifier, Root]
        require!(
            public_inputs.len() == verifying_key::NR_PUBINPUTS,
            ErrorCode::InvalidProof
        );
        require!(public_inputs[1] == nullifier_hash, ErrorCode::InvalidProof);
        require!(public_inputs[2] == root, ErrorCode::InvalidProof);

        msg!("ZK_VERIFY: Received {} public inputs", public_inputs.len());

        // Expected order: [commitment, nullifier, root]
        verify_withdraw_public_inputs(
            &proof_a,
            &proof_b,
            &proof_c,
            &public_inputs,
        )?;

        err!(ErrorCode::UnsafePublicWithdrawPath)
    }

    pub fn prepare_phantom_withdraw_v2(
        ctx: Context<PrepareWithdraw>,
        amount: u64,
        nullifier_hash: [u8; 32],
        root: [u8; 32],
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: [[u8; 32]; 8]
    ) -> Result<()> {
        let vault = ctx.accounts.vault.load_mut()?;
        let _ = (&proof_a, &proof_b, &proof_c);

        require_fr_public_inputs(&public_inputs)?;
        require!(vault.contains_root(&root), ErrorCode::InvalidRoot);
        require!(
            !vault.contains_nullifier(&nullifier_hash),
            ErrorCode::DoubleSpend
        );

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

        msg!("ZK_VERIFY_V2: payout-bound public inputs checked; circuit promotion pending");
        err!(ErrorCode::WithdrawV2CircuitNotPromoted)
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
    pub nullifier_count: u32,
    pub leaf_count: u64,
    pub next_index: u32,
    pub _reserved: [u8; 4],
    pub leaves: [u8; LEAF_WINDOW * 32],
    pub nullifiers: [u8; NULLIFIER_WINDOW * 32],
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
        self.nullifiers = [0; NULLIFIER_WINDOW * 32];
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

    pub fn append_root(&mut self, new_root: [u8; 32]) -> Result<()> {
        require!(
            (self.root_count as usize) < ROOT_WINDOW,
            ErrorCode::RootStorageFull
        );
        self.roots[self.root_count as usize] = new_root;
        self.root_count += 1;
        Ok(())
    }

    pub fn contains_root(&self, root: &[u8; 32]) -> bool {
        self.roots[..self.root_count as usize]
            .iter()
            .any(|candidate| candidate == root)
    }

    pub fn contains_nullifier(&self, nullifier_hash: &[u8; 32]) -> bool {
        for index in 0..self.nullifier_count as usize {
            let start = index * 32;
            if self.nullifiers[start..start + 32] == nullifier_hash[..] {
                return true;
            }
        }
        false
    }

    pub fn append_nullifier(&mut self, nullifier_hash: [u8; 32]) -> Result<()> {
        require!(
            (self.nullifier_count as usize) < NULLIFIER_WINDOW,
            ErrorCode::NullifierStorageFull
        );

        let start = self.nullifier_count as usize * 32;
        self.nullifiers[start..start + 32].copy_from_slice(&nullifier_hash);
        self.nullifier_count += 1;
        Ok(())
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Nullifier already used.")]
    DoubleSpend,
    #[msg("Merkle Root invalid.")]
    InvalidRoot,
    #[msg("Nullifier storage is full.")]
    NullifierStorageFull,
    #[msg("Invalid ZK Proof.")]
    InvalidProof,
    #[msg("Leaf storage is full.")]
    LeafStorageFull,
    #[msg("Root storage is full.")]
    RootStorageFull,
    #[msg("Signer is not authorized to update roots.")]
    UnauthorizedRootUpdate,
    #[msg("Public withdraw payout path is disabled until amount and recipient are bound by the canonical proof bundle.")]
    UnsafePublicWithdrawPath,
    #[msg("Withdraw v2 payout remains disabled until the v2 circuit, proving key, verifying key, manifest, and IDL are promoted together.")]
    WithdrawV2CircuitNotPromoted,
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::error::Error;

    #[test]
    fn canonical_program_id_is_bound() {
        assert_eq!(ID.to_string(), "2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF");
    }

    #[test]
    fn verifying_key_uses_three_public_inputs() {
        assert_eq!(verifying_key::NR_PUBINPUTS, 3);
        assert_eq!(VERIFYING_KEY.nr_pubinputs, 3);
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
        assert_eq!(std::mem::size_of::<Vault>(), 8856);
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
            nullifiers: [0; NULLIFIER_WINDOW * 32],
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
            nullifiers: [0; NULLIFIER_WINDOW * 32],
        };

        assert!(matches!(vault.append_root([9; 32]), Err(Error::AnchorError(_))));
    }

    #[test]
    fn vault_rejects_duplicate_and_overflowing_nullifiers() {
        let nullifier = [5; 32];
        let mut vault = Vault {
            roots: [[0; 32]; ROOT_WINDOW],
            root_count: 0,
            nullifier_count: 0,
            leaf_count: 0,
            next_index: 0,
            _reserved: [0; 4],
            leaves: [0; LEAF_WINDOW * 32],
            nullifiers: [0; NULLIFIER_WINDOW * 32],
        };

        vault.append_nullifier(nullifier).expect("first nullifier insert");
        assert!(vault.contains_nullifier(&nullifier));

        vault.nullifier_count = NULLIFIER_WINDOW as u32;
        assert!(matches!(vault.append_nullifier([6; 32]), Err(Error::AnchorError(_))));
    }
}
