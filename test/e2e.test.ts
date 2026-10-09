import assert from "node:assert/strict";

import { generateInvoiceProof } from "../prover/src/generate_proof.js";
import { getInvoice, registerInvoice, submitProofToStellar, verifyDisclosure } from "../prover/src/stellar_submit.js";

async function runE2E() {
  console.log("=== InvoiceVeil E2E Test ===\n");

  const payee = "GCFX7C4T74DUMMYINVOICEVEILWALLETDEMOADDRESSXXXX";
  const payer = "GDEMOINVOICEVEILPAYER000000000000000000000000000000000";
  const id = await registerInvoice(payee, 10000n, 50000n, { payer });
  assert(id === 1n, "The first invoice ID should be 1");
  console.log("✓ Invoice registered, ID:", id.toString());

  const proofResult = await generateInvoiceProof({ amount: 25000n, loBound: 10000n, hiBound: 50000n });
  console.log("✓ Proof generated, size:", JSON.stringify(proofResult.proof).length, "bytes");

  const txHash = await submitProofToStellar(
    id,
    proofResult.proof,
    proofResult.publicSignals,
    proofResult.rawPublicSignals,
    {
      payer,
    },
  );
  console.log("✓ Proof verified on Stellar, tx:", txHash);

  const invoice = await getInvoice(id);
  assert(invoice?.status === "Settled", "Should be Settled");
  assert(invoice.commitment !== "0x0000000000000000000000000000000000000000000000000000000000000000");
  console.log("✓ Invoice status: Settled");
  console.log("✓ On-chain amount: [ZK Protected]");

  const valid = await verifyDisclosure(id, 25000n, proofResult.salt);
  assert(valid === true, "Valid disclosure should return true");
  console.log("✓ Auditor disclosure verified: amount=$250.00 confirmed");

  const invalid = await verifyDisclosure(id, 30000n, proofResult.salt);
  assert(invalid === false, "Wrong disclosure should return false");
  console.log("✓ Wrong amount correctly rejected");

  console.log("\n✅ All tests passed!");
}

runE2E().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
