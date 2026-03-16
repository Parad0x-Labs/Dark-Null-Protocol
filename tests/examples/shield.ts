/**
 * Dark Null Protocol - Shield Example
 * 
 * This example demonstrates how to shield (deposit) funds into the privacy pool.
 * 
 * @example
 * ```bash
 * npx ts-node shield.ts
 * ```
 */

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import * as crypto from 'crypto';

// Configuration
const CONFIG = {
  RPC_URL: 'https://api.devnet.solana.com',
  PROGRAM_ID: '7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w',
};

async function main() {
  console.log('🌑 Dark Null Protocol - Shield Example\n');

  // Connect to devnet
  const connection = new Connection(CONFIG.RPC_URL, 'confirmed');
  console.log('Connected to:', CONFIG.RPC_URL);

  // Generate a test wallet (in production, use your own keypair)
  const wallet = Keypair.generate();
  console.log('Test wallet:', wallet.publicKey.toBase58());

  // Request airdrop for testing
  console.log('\nRequesting airdrop...');
  try {
    const sig = await connection.requestAirdrop(wallet.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
    console.log('✅ Airdrop received: 2 SOL');
  } catch (e) {
    console.log('⚠️ Airdrop failed (rate limited). Fund wallet manually.');
    return;
  }

  // Generate commitment (hash of secret)
  const secret = crypto.randomBytes(32);
  const commitment = crypto.createHash('sha256').update(secret).digest();
  
  console.log('\n📝 Generated commitment:');
  console.log('  Secret (SAVE THIS!):', secret.toString('hex'));
  console.log('  Commitment:', commitment.toString('hex'));

  // In production, you would:
  // 1. Load the IDL
  // 2. Create program instance
  // 3. Call shieldV18 instruction
  
  console.log('\n📋 To complete shield:');
  console.log('  1. Load program IDL from target/idl/dark_null_v1.json');
  console.log('  2. Derive PDAs (state_v18, vault_v18, deposit)');
  console.log('  3. Call program.methods.shieldV18(amount, commitment, auditTag)');
  console.log('  4. Store secret securely for later unshield');

  console.log('\n✅ Example complete. See LIVE_TEST_RESULTS.md for real transactions.');
}

main().catch(console.error);

