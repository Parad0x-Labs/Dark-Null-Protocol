use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};
use base64::{Engine as _, engine::general_purpose};

// ZK Proof Imports
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

declare_id!("2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF");

// OFFICIAL VK (generated via official_parse_vk_to_rust.js)
pub const VERIFYING_KEY: Groth16Verifyingkey = Groth16Verifyingkey {
    nr_pubinputs: 3,
    vk_alpha_g1: [
        5, 163, 150, 102, 204, 152, 38, 76, 219, 236, 73, 101, 157, 226, 27, 181, 21, 169, 252, 103, 130, 225, 64, 167, 111, 29, 14, 2, 204, 64, 101, 77, 7, 196, 84, 49, 164, 20, 210, 2, 224, 217, 232, 136, 156, 100, 153, 209, 5, 15, 237, 180, 250, 43, 185, 50, 9, 199, 178, 221, 228, 50, 26, 211
    ],
    vk_beta_g2: [
        7, 30, 252, 205, 156, 13, 44, 180, 173, 99, 74, 199, 254, 62, 249, 209, 197, 242, 52, 99, 195, 102, 87, 115, 205, 41, 208, 185, 86, 134, 151, 237, 8, 47, 64, 43, 129, 58, 146, 65, 165, 54, 119, 56, 93, 219, 116, 185, 48, 103, 40, 49, 214, 5, 191, 203, 99, 79, 25, 87, 20, 12, 165, 207, 46, 40, 50, 111, 248, 5, 99, 187, 169, 200, 229, 195, 169, 207, 180, 74, 6, 160, 174, 30, 133, 170, 137, 69, 127, 126, 249, 190, 186, 133, 254, 77, 14, 47, 234, 10, 119, 78, 244, 40, 150, 166, 132, 29, 237, 227, 158, 196, 172, 49, 39, 217, 197, 153, 69, 145, 65, 27, 243, 43, 221, 19, 140, 36
    ],
    vk_gamme_g2: [
        24, 0, 222, 239, 18, 31, 30, 118, 66, 106, 0, 102, 94, 92, 68, 121, 103, 67, 34, 212, 247, 94, 218, 221, 70, 222, 189, 92, 217, 146, 246, 237, 25, 142, 147, 147, 146, 13, 72, 58, 114, 96, 191, 183, 49, 251, 93, 37, 241, 170, 73, 51, 53, 169, 231, 18, 151, 228, 133, 183, 174, 243, 18, 194, 18, 200, 94, 165, 219, 140, 109, 235, 74, 171, 113, 128, 141, 203, 64, 143, 227, 209, 231, 105, 12, 67, 211, 123, 76, 230, 204, 1, 102, 250, 125, 170, 9, 6, 137, 208, 88, 95, 240, 117, 236, 158, 153, 173, 105, 12, 51, 149, 188, 75, 49, 51, 112, 179, 142, 243, 85, 172, 218, 220, 209, 34, 151, 91
    ],
    vk_delta_g2: [
        24, 0, 222, 239, 18, 31, 30, 118, 66, 106, 0, 102, 94, 92, 68, 121, 103, 67, 34, 212, 247, 94, 218, 221, 70, 222, 189, 92, 217, 146, 246, 237, 25, 142, 147, 147, 146, 13, 72, 58, 114, 96, 191, 183, 49, 251, 93, 37, 241, 170, 73, 51, 53, 169, 231, 18, 151, 228, 133, 183, 174, 243, 18, 194, 18, 200, 94, 165, 219, 140, 109, 235, 74, 171, 113, 128, 141, 203, 64, 143, 227, 209, 231, 105, 12, 67, 211, 123, 76, 230, 204, 1, 102, 250, 125, 170, 9, 6, 137, 208, 88, 95, 240, 117, 236, 158, 153, 173, 105, 12, 51, 149, 188, 75, 49, 51, 112, 179, 142, 243, 85, 172, 218, 220, 209, 34, 151, 91
    ],
    vk_ic: &[
        [45, 54, 30, 0, 250, 128, 0, 208, 138, 101, 242, 206, 45, 255, 220, 249, 92, 166, 193, 179, 4, 135, 84, 2, 172, 25, 97, 113, 136, 17, 116, 127, 34, 179, 152, 208, 42, 154, 147, 26, 196, 91, 94, 126, 119, 180, 44, 159, 6, 243, 167, 11, 83, 72, 32, 135, 55, 38, 131, 241, 205, 55, 187, 30],
        [1, 110, 116, 91, 151, 115, 90, 149, 47, 49, 234, 85, 136, 185, 245, 49, 226, 158, 42, 136, 215, 139, 55, 157, 75, 65, 144, 142, 40, 224, 28, 154, 8, 77, 201, 140, 63, 2, 179, 124, 243, 226, 5, 250, 135, 116, 82, 28, 33, 86, 124, 165, 217, 1, 0, 102, 230, 109, 170, 71, 49, 236, 70, 190],
        [27, 225, 62, 74, 90, 112, 169, 135, 57, 102, 216, 81, 49, 139, 198, 34, 118, 21, 89, 134, 43, 1, 92, 82, 255, 7, 143, 130, 183, 105, 12, 159, 39, 213, 55, 200, 150, 219, 188, 82, 25, 117, 161, 243, 29, 173, 2, 126, 41, 28, 9, 228, 45, 163, 180, 190, 66, 200, 144, 254, 81, 177, 253, 233],
        [25, 226, 224, 80, 73, 254, 174, 29, 162, 146, 109, 180, 139, 28, 101, 0, 239, 150, 111, 13, 64, 156, 219, 111, 168, 158, 18, 63, 57, 92, 251, 104, 16, 78, 141, 95, 50, 245, 112, 245, 209, 68, 66, 121, 39, 185, 23, 38, 78, 101, 43, 205, 114, 34, 238, 104, 73, 147, 36, 62, 137, 217, 3, 172],
    ]
};


#[program]
pub mod paradox {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let mut vault = ctx.accounts.vault.load_init()?;
        vault.roots = [[0; 32]; 20];
        vault.root_index = 0;
        vault.next_index = 0;
        vault.leaf_count = 0;
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
        let idx = (vault.next_index as usize) * 32;
        if idx + 32 <= vault.leaves.len() {
            vault.leaves[idx..idx+32].copy_from_slice(&commitment);
        }
        
        vault.next_index = (vault.next_index + 1) % 128; 
        vault.leaf_count += 1;

        msg!("PDX_WHISPER:{}", general_purpose::STANDARD.encode(&encrypted_note));
        msg!("PDX_EPHEMERAL:{}", general_purpose::STANDARD.encode(&ephemeral_pubkey));
        msg!("PDX_TAG:{}", view_tag);
        msg!("LEAF_INDEX:{}", vault.leaf_count - 1);
        Ok(())
    }

    pub fn update_root(
        ctx: Context<UpdateRoot>,
        new_root: [u8; 32]
    ) -> Result<()> {
        let mut vault = ctx.accounts.vault.load_mut()?;
        let idx = vault.root_index as usize;
        vault.roots[idx] = new_root;
        vault.root_index = (vault.root_index + 1) % 20;
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
        let mut vault = ctx.accounts.vault.load_mut()?;

        // 1. Root Check
        let mut root_found = false;
        for i in 0..20 {
            if vault.roots[i] == root {
                root_found = true;
                break;
            }
        }
        if !root_found {
            return err!(ErrorCode::InvalidRoot);
        }

        // 2. Double Spend Check
        for i in 0..128 {
            let start = i * 32;
            if vault.nullifiers[start..start+32] == nullifier_hash {
                return err!(ErrorCode::DoubleSpend);
            }
        }

        // 3. Record Nullifier
        let n_idx = (vault.leaf_count % 128) as usize; 
        vault.nullifiers[n_idx*32..(n_idx+1)*32].copy_from_slice(&nullifier_hash);

        // 4. GROTH16-SOLANA VERIFICATION
        if public_inputs.len() < 3 {
            return err!(ErrorCode::InvalidProof);
        }

        // Consistency checks: ensure public inputs match instruction arguments
        // Order: [Commitment, Nullifier, Root]
        require!(public_inputs[1] == nullifier_hash, ErrorCode::InvalidProof);
        require!(public_inputs[2] == root, ErrorCode::InvalidProof);

        msg!("ZK_VERIFY: Received {} public inputs", public_inputs.len());
        
        // Expected order: Commitment, Nullifier, Root
        let p_inputs: [[u8; 32]; 3] = public_inputs;

        // WORKING FIX: The groth16-solana library expects A, B, C order
        let mut verifier = Groth16Verifier::new(
            &proof_a,
            &proof_b,
            &proof_c,
            &p_inputs,
            &VERIFYING_KEY
        ).map_err(|_| ErrorCode::InvalidProof)?;

        verifier.verify().map_err(|_| ErrorCode::InvalidProof)?;

        // 5. MINT NEW TOKENS TO BOB (PDA as mint authority)
        let seeds = &[b"merkle_vault".as_ref(), &[ctx.bumps.vault]];
        let signer = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.receiver_token.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        msg!("Minted {} fresh pSOL to Bob. Bob is now the Vault Commander.", amount);
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
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
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
    pub signer: Signer<'info>,
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
    pub roots: [[u8; 32]; 20],  
    pub root_index: u32,        
    pub _padding1: [u8; 4],     
    pub leaf_count: u64,        
    pub next_index: u32,        
    pub _padding2: [u8; 4],     
    pub leaves: [u8; 4096],     
    pub nullifiers: [u8; 4096], 
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
}
