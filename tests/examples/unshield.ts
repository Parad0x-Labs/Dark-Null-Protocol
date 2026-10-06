/**
 * Dark Null Protocol - Unshield Example
 * 
 * This example demonstrates how to unshield (withdraw) funds from the privacy pool.
 * Requires a valid ZK proof generated from your secret.
 * 
 * @example
 * ```bash
 * npx ts-node unshield.ts
 * ```
 */

import { Connection, Keypair } from '@solana/web3.js';

// Configuration
const CONFIG = {
  RPC_URL: 'https://api.devnet.solana.com',
  PROGRAM_ID: '7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w',
  RELAYER_URL: 'https://relayer-falling-dust-5746.fly.dev',
};

interface UnshieldParams {
  commitment: string;    // From shield operation
  secret: string;        // Your secret (keep safe!)
  recipient: string;     // Where to receive funds
}

async function main() {
  console.log('🌑 Dark Null Protocol - Unshield Example\n');

  // Connect to devnet
  const connection = new Connection(CONFIG.RPC_URL, 'confirmed');
  console.log('Connected to:', CONFIG.RPC_URL, '(slot', await connection.getSlot(), ')');

  // Example unshield params (replace with your own)
  const params: UnshieldParams = {
    commitment: 'YOUR_COMMITMENT_HASH',
    secret: 'YOUR_SECRET',
    recipient: Keypair.generate().publicKey.toBase58(),
  };

  console.log('\n📋 Unshield Process:');
  console.log('  1. Verify maturity delay has passed');
  console.log('  2. Generate ZK proof from secret');
  console.log('  3. Submit to relayer or directly to program');
  console.log('  4. Funds arrive at recipient (unlinkable!)');

  console.log('\n🔐 ZK Proof contains:');
  console.log('  • proofA (64 bytes) - G1 point');
  console.log('  • proofB (128 bytes) - G2 point');
  console.log('  • proofC (64 bytes) - G1 point');
  console.log('  • nullifierHash - prevents double-spend');
  console.log('  • blindedRecipient - stealth address');

  // Example relayer submission (via API)
  console.log('\n📡 Via Relayer API:');
  console.log(`  POST ${CONFIG.RELAYER_URL}/unshield`);
  console.log('  Body: { commitment, secret, recipientPubkey }');
  console.log(`  commitment: ${params.commitment}`);
  console.log(`  recipientPubkey: ${params.recipient}`);
  console.log('  → Relayer generates proof & submits TX');
  console.log('  → Your wallet never appears as fee payer!');

  console.log('\n✅ Example complete. See LIVE_TEST_RESULTS.md for real transactions.');
}

main().catch(console.error);

