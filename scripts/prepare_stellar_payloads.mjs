import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const keysDir = path.join(root, "keys");
const vkPath = path.join(keysDir, "verification_key.json");
const fixturePath = path.join(root, "test", "fixtures", "valid_proof.json");

if (!fs.existsSync(vkPath)) {
  console.error(`Missing verification key at ${path.relative(root, vkPath)}.`);
  process.exit(1);
}

if (!fs.existsSync(fixturePath)) {
  console.error(
    `Missing proof fixture at ${path.relative(root, fixturePath)}.\n` +
      "Generate it first with:\n" +
      "  npx tsx prover/src/generate_test_fixture.ts",
  );
  process.exit(1);
}

// generate_test_fixture.ts emits { proof, publicSignals, rawPublicSignals, salt }.
const vk = JSON.parse(fs.readFileSync(vkPath, "utf8"));
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const proof = fixture.proof;
const publicSignals = fixture.rawPublicSignals;

function decToHex32(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function g1ToHex(point) {
  return decToHex32(point[0]) + decToHex32(point[1]);
}

function g2ToHex(point) {
  // Soroban BN254 Fp2 encoding: x.c1 || x.c0 || y.c1 || y.c0.
  return (
    decToHex32(point[0][1]) +
    decToHex32(point[0][0]) +
    decToHex32(point[1][1]) +
    decToHex32(point[1][0])
  );
}

const configurePayload = {
  alpha: g1ToHex(vk.vk_alpha_1),
  beta: g2ToHex(vk.vk_beta_2),
  gamma: g2ToHex(vk.vk_gamma_2),
  delta: g2ToHex(vk.vk_delta_2),
  ic: vk.IC.map(g1ToHex),
};

const settleProofPayload = {
  a: g1ToHex(proof.pi_a),
  b: g2ToHex(proof.pi_b),
  c: g1ToHex(proof.pi_c),
};

const settleSignalsPayload = {
  lo_bound: Number(publicSignals[0]),
  hi_bound: Number(publicSignals[1]),
  commitment: decToHex32(publicSignals[2]),
};

const verifierInputsPayload = {
  inputs: publicSignals,
};

fs.writeFileSync(path.join(keysDir, "configure_vk_payload.json"), JSON.stringify(configurePayload, null, 2));
fs.writeFileSync(path.join(keysDir, "settle_proof_payload.json"), JSON.stringify(settleProofPayload, null, 2));
fs.writeFileSync(path.join(keysDir, "settle_signals_payload.json"), JSON.stringify(settleSignalsPayload, null, 2));
fs.writeFileSync(path.join(keysDir, "settle_verifier_inputs_payload.json"), JSON.stringify(verifierInputsPayload, null, 2));

console.log("Wrote Stellar payload files to keys/.");
