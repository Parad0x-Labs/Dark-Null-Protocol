use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    hash::hashv,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    secp256k1_recover::secp256k1_recover,
    system_instruction,
    sysvar::rent::Rent,
    sysvar::Sysvar,
};

solana_program::declare_id!("6h4yKZGFYHAVkctUVqD4wrXCYeostHBhG6T3FCVAqr3f");

// ---------------------------------------------------------------------------
// Instruction discriminants
// ---------------------------------------------------------------------------

const IX_REGISTER_MODEL: u8 = 0;
const IX_RECORD_INFERENCE: u8 = 1;

// ---------------------------------------------------------------------------
// On-chain account data structures
// ---------------------------------------------------------------------------

/// ModelConfig — 129 bytes: 32 + 32 + 64 + 1
/// Stores the model identity and the secp256k1 oracle pubkey that signs
/// every inference receipt for this model.
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ModelConfig {
    /// Solana authority that registered the model (can be used for upgrades).
    pub authority: Pubkey,
    /// SHA256 of model weights / config — the model's content commitment.
    pub model_hash: [u8; 32],
    /// Uncompressed secp256k1 oracle pubkey WITHOUT the 0x04 prefix (64 bytes).
    pub oracle_pubkey: [u8; 64],
    /// PDA bump stored for convenience.
    pub bump: u8,
}

/// InferenceReceipt — 97 bytes: 32 + 32 + 32 + 1
/// Immutable on-chain record that a specific (input, output) pair was
/// produced by the registered model and signed by the legitimate oracle.
/// The PDA address itself encodes (input_hash, output_hash), providing
/// O(1) existence proofs and automatic replay protection.
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct InferenceReceipt {
    pub model_hash: [u8; 32],
    pub input_hash: [u8; 32],
    pub output_hash: [u8; 32],
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Instruction payload structs (deserialized from remaining bytes after disc)
// ---------------------------------------------------------------------------

/// Payload for RegisterModel (96 bytes).
#[derive(BorshDeserialize, Debug)]
struct RegisterModelArgs {
    model_hash: [u8; 32],
    oracle_pubkey: [u8; 64],
}

/// Payload for RecordInference (161 bytes).
#[derive(BorshDeserialize, Debug)]
struct RecordInferenceArgs {
    model_hash: [u8; 32],
    input_hash: [u8; 32],
    output_hash: [u8; 32],
    oracle_sig_r: [u8; 32],
    oracle_sig_s: [u8; 32],
    recovery_id: u8,
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        msg!("Error: instruction data is empty");
        return Err(ProgramError::InvalidInstructionData);
    }

    let (discriminant, payload) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match *discriminant {
        IX_REGISTER_MODEL => {
            msg!("Instruction: RegisterModel");
            process_register_model(program_id, accounts, payload)
        }
        IX_RECORD_INFERENCE => {
            msg!("Instruction: RecordInference");
            process_record_inference(program_id, accounts, payload)
        }
        _ => {
            msg!("Error: unknown discriminant {}", discriminant);
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

// ---------------------------------------------------------------------------
// RegisterModel
//
// Registers a model oracle on-chain.  The caller supplies the SHA256
// content-hash of the model weights and the secp256k1 pubkey of the oracle
// that will sign inference receipts.
//
// Accounts (0-indexed):
//   0. authority        — signer, writable; the registrant / model owner
//   1. model_config_pda — writable; new PDA ["model-v1", model_hash]
//   2. system_program   — System program
//
// Instruction payload (96 bytes, no leading discriminant byte — already
// stripped by the router):
//   [0..32]  model_hash      [u8; 32]
//   [32..96] oracle_pubkey   [u8; 64]  (uncompressed secp256k1 sans 0x04)
// ---------------------------------------------------------------------------

fn process_register_model(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let authority = next_account_info(account_iter)?;
    let model_config_pda = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    if !authority.is_signer {
        msg!("Error: authority must be signer");
        return Err(ProgramError::MissingRequiredSignature);
    }

    let args = RegisterModelArgs::try_from_slice(payload)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    // Derive and verify the PDA.
    let seeds: &[&[u8]] = &[b"model-v1", &args.model_hash];
    let (expected_pda, bump) = Pubkey::find_program_address(seeds, program_id);
    if expected_pda != *model_config_pda.key {
        msg!("Error: model_config_pda does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Reject re-registration: the PDA must be empty.
    if !model_config_pda.data_is_empty() {
        msg!("Error: model already registered");
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    let config = ModelConfig {
        authority: *authority.key,
        model_hash: args.model_hash,
        oracle_pubkey: args.oracle_pubkey,
        bump,
    };

    // ModelConfig Borsh layout: 32 + 32 + 64 + 1 = 129 bytes.
    let data_len: usize = 129;
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(data_len);

    let signer_seeds: &[&[&[u8]]] = &[&[b"model-v1", &args.model_hash, &[bump]]];

    invoke_signed(
        &system_instruction::create_account(
            authority.key,
            model_config_pda.key,
            lamports,
            data_len as u64,
            program_id,
        ),
        &[authority.clone(), model_config_pda.clone(), system_program.clone()],
        signer_seeds,
    )?;

    let serialized = borsh::to_vec(&config).map_err(|_| ProgramError::InvalidAccountData)?;
    let mut data = model_config_pda.try_borrow_mut_data()?;
    data[..serialized.len()].copy_from_slice(&serialized);

    msg!("RegisterModel: PDA {}", model_config_pda.key);
    Ok(())
}

// ---------------------------------------------------------------------------
// RecordInference
//
// Verifies an oracle-signed inference receipt on-chain and stores it
// immutably.  The oracle signature covers SHA256(model_hash ‖ input_hash ‖
// output_hash), which is exactly what Solana's hashv produces for three
// contiguous slices.
//
// Accounts (0-indexed):
//   0. payer               — signer, writable; pays PDA rent
//   1. model_config_pda    — readable; must already exist
//   2. inference_receipt_pda — writable; new PDA ["inference-v1", input_hash, output_hash]
//   3. system_program      — System program
//
// Instruction payload (161 bytes, discriminant already stripped):
//   [0..32]    model_hash      [u8; 32]
//   [32..64]   input_hash      [u8; 32]
//   [64..96]   output_hash     [u8; 32]
//   [96..128]  oracle_sig_r    [u8; 32]
//   [128..160] oracle_sig_s    [u8; 32]
//   [160]      recovery_id     u8
// ---------------------------------------------------------------------------

fn process_record_inference(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let payer = next_account_info(account_iter)?;
    let model_config_pda = next_account_info(account_iter)?;
    let inference_receipt_pda = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    if !payer.is_signer {
        msg!("Error: payer must be signer");
        return Err(ProgramError::MissingRequiredSignature);
    }

    let args = RecordInferenceArgs::try_from_slice(payload)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    // ------------------------------------------------------------------
    // 1. Load ModelConfig and verify ownership.
    // ------------------------------------------------------------------
    if model_config_pda.owner != program_id {
        msg!("Error: model_config_pda not owned by this program");
        return Err(ProgramError::IncorrectProgramId);
    }

    let config_data = model_config_pda.try_borrow_data()?;
    let config = ModelConfig::try_from_slice(&config_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    drop(config_data);

    // ------------------------------------------------------------------
    // 2. Verify the model_config PDA address matches args.model_hash.
    //    This also confirms model_hash in args is the registered one.
    // ------------------------------------------------------------------
    let (expected_config_pda, _) =
        Pubkey::find_program_address(&[b"model-v1", &args.model_hash], program_id);
    if expected_config_pda != *model_config_pda.key {
        msg!("Error: model_config_pda does not match args.model_hash");
        return Err(ProgramError::InvalidArgument);
    }

    if config.model_hash != args.model_hash {
        msg!("Error: stored model_hash mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    // ------------------------------------------------------------------
    // 3. Reconstruct the signed message hash.
    //    msg_hash = SHA256(model_hash ‖ input_hash ‖ output_hash)
    //    Solana's hashv concatenates the slices and SHA256s the result.
    // ------------------------------------------------------------------
    let msg_hash = hashv(&[&args.model_hash, &args.input_hash, &args.output_hash]);

    // ------------------------------------------------------------------
    // 4. Verify the oracle secp256k1 signature.
    //    secp256k1_recover(hash, recovery_id, compact_sig) → pubkey (64 bytes)
    // ------------------------------------------------------------------
    let mut sig = [0u8; 64];
    sig[..32].copy_from_slice(&args.oracle_sig_r);
    sig[32..].copy_from_slice(&args.oracle_sig_s);

    let recovered = secp256k1_recover(msg_hash.as_ref(), args.recovery_id, &sig)
        .map_err(|_| {
            msg!("Error: secp256k1_recover failed");
            ProgramError::InvalidArgument
        })?;

    if recovered.0 != config.oracle_pubkey {
        msg!("Error: oracle signature verification failed");
        return Err(ProgramError::InvalidArgument);
    }

    // ------------------------------------------------------------------
    // 5. Derive and verify the inference receipt PDA.
    //    Seeds: ["inference-v1", input_hash, output_hash]
    // ------------------------------------------------------------------
    let receipt_seeds: &[&[u8]] = &[b"inference-v1", &args.input_hash, &args.output_hash];
    let (expected_receipt_pda, receipt_bump) =
        Pubkey::find_program_address(receipt_seeds, program_id);
    if expected_receipt_pda != *inference_receipt_pda.key {
        msg!("Error: inference_receipt_pda does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // ------------------------------------------------------------------
    // 6. Replay protection: reject if the receipt PDA already has data.
    // ------------------------------------------------------------------
    if !inference_receipt_pda.data_is_empty() {
        msg!("Error: inference receipt already recorded (replay)");
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    // ------------------------------------------------------------------
    // 7. Create the receipt PDA and persist the InferenceReceipt.
    //    InferenceReceipt Borsh layout: 32 + 32 + 32 + 1 = 97 bytes.
    // ------------------------------------------------------------------
    let receipt = InferenceReceipt {
        model_hash: args.model_hash,
        input_hash: args.input_hash,
        output_hash: args.output_hash,
        bump: receipt_bump,
    };

    let data_len: usize = 97;
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(data_len);

    let signer_seeds: &[&[&[u8]]] = &[&[
        b"inference-v1",
        &args.input_hash,
        &args.output_hash,
        &[receipt_bump],
    ]];

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            inference_receipt_pda.key,
            lamports,
            data_len as u64,
            program_id,
        ),
        &[payer.clone(), inference_receipt_pda.clone(), system_program.clone()],
        signer_seeds,
    )?;

    let serialized = borsh::to_vec(&receipt).map_err(|_| ProgramError::InvalidAccountData)?;
    let mut data = inference_receipt_pda.try_borrow_mut_data()?;
    data[..serialized.len()].copy_from_slice(&serialized);

    msg!("RecordInference: receipt PDA {}", inference_receipt_pda.key);
    Ok(())
}
