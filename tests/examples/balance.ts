/**
 * Dark Null Protocol - Balance Check Example
 * 
 * Check your shielded balance without revealing it publicly.
 * 
 * @example
 * ```bash
 * npx ts-node balance.ts
 * ```
 */

import { Connection, PublicKey } from '@solana/web3.js';

// Configuration
const CONFIG = {
  RPC_URL: 'https://api.devnet.solana.com',
  PROGRAM_ID: '7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w',
};

async function main() {
  console.log('🌑 Dark Null Protocol - Balance Example\n');

  const connection = new Connection(CONFIG.RPC_URL, 'confirmed');
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  // Derive vault PDA
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_v18')],
    programId
  );

  // Derive global state PDA
  const [globalState] = PublicKey.findProgramAddressSync(
    [Buffer.from('state_v18')],
    programId
  );

  console.log('Program ID:', CONFIG.PROGRAM_ID);
  console.log('Vault PDA:', vault.toBase58());
  console.log('Global State:', globalState.toBase58());

  // Check vault balance (total shielded)
  const vaultBalance = await connection.getBalance(vault);
  console.log('\n💰 Total Shielded in Vault:', vaultBalance / 1e9, 'SOL');

  // Check global state
  const stateInfo = await connection.getAccountInfo(globalState);
  if (stateInfo) {
    console.log('📊 Global State Size:', stateInfo.data.length, 'bytes');
    console.log('✅ Protocol is initialized');
  } else {
    console.log('⚠️ Protocol not initialized on this cluster');
  }

  console.log('\n📋 Your Private Balance:');
  console.log('  → Only YOU can calculate your shielded balance');
  console.log('  → Sum up all your unspent commitments locally');
  console.log('  → Nobody else can see what you hold!');

  console.log('\n✅ Example complete.');
}

main().catch(console.error);

