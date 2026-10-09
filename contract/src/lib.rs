#![no_std]

mod invoice;
mod types;
mod verifier;

use invoice::{empty_commitment, load_invoice, save_invoice};
use soroban_sdk::{contract, contractimpl, crypto::bn254::Fr, Address, Env, Symbol, U256};
use types::{DataKey, Invoice, InvoiceStatus, Proof, PublicSignals, VerificationKey, VerifierInputs};
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};
use soroban_sdk::{contract, contractevent, contractimpl, Address, BytesN, Env};
use types::{
    DataKey, Invoice, InvoiceStatus, Proof, PublicSignals, VerificationKey, VerifierInputs,
};
use verifier::verify_groth16;

// Storage TTL policy, expressed in ledgers. Stellar closes a ledger roughly
// every 5 seconds, so a day is 24 * 60 * 60 / 5 = 17,280 ledgers.
const DAY_IN_LEDGERS: u32 = 17_280;

/// Bump a persistent entry's TTL only once it has dropped below ~30 days.
pub(crate) const PERSISTENT_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
/// Extend persistent entries back out to ~60 days on every write.
pub(crate) const PERSISTENT_TTL_EXTEND_TO: u32 = 60 * DAY_IN_LEDGERS;
/// Bump the contract instance's TTL only once it has dropped below ~30 days.
pub(crate) const INSTANCE_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
/// Extend the contract instance (which holds `Admin`, `VerificationKey` and
/// `NextId`) back out to ~60 days on every instance write. Without this the
/// verification key can archive and `verification_key` then panics, making
/// settlement impossible.
pub(crate) const INSTANCE_TTL_EXTEND_TO: u32 = 60 * DAY_IN_LEDGERS;
/// Emitted when a payer registers a new invoice with public bounds.
#[contractevent(topics = ["InvoiceRegistered"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InvoiceRegistered {
    pub id: u64,
    pub lo_bound: u64,
    pub hi_bound: u64,
}

/// Emitted when an invoice is settled with a valid Groth16 proof.
#[contractevent(topics = ["InvoiceSettled"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InvoiceSettled {
    pub id: u64,
    pub commitment: BytesN<32>,
}

/// Emitted when a pending invoice is cancelled by its payer.
#[contractevent(topics = ["InvoiceCancelled"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InvoiceCancelled {
    pub id: u64,
}

#[contract]
pub struct InvoiceVeilContract;

#[contractimpl]
impl InvoiceVeilContract {
    pub fn configure(env: Env, admin: Address, verification_key: VerificationKey) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::VerificationKey, &verification_key);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }

    pub fn update_verification_key(env: Env, verification_key: VerificationKey) {
        let admin = Self::admin(&env);
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::VerificationKey, &verification_key);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }

    pub fn register_invoice(
        env: Env,
        payer: Address,
        payee: Address,
        lo_bound: u64,
        hi_bound: u64,
    ) -> u64 {
        payer.require_auth();
        // Self-referential invoices are intentionally unsupported: a payer that
        // pays itself has no distinct counterparty to verify against.
        assert!(payee != payer, "payee cannot be the payer");
        assert!(lo_bound < hi_bound, "invalid bounds");

        let id = Self::next_id(&env);
        let invoice = Invoice {
            id,
            payer,
            payee,
            lo_bound,
            hi_bound,
            commitment: empty_commitment(&env),
            status: InvoiceStatus::Pending,
        };

        save_invoice(&env, &invoice);
        env.events().publish(
            (Symbol::new(&env, "InvoiceRegistered"),),
            (id, lo_bound, hi_bound),
        );
        InvoiceRegistered {
            id,
            lo_bound,
            hi_bound,
        }
        .publish(&env);
        id
    }

    pub fn settle_invoice(
        env: Env,
        payer: Address,
        id: u64,
        proof: Proof,
        signals: PublicSignals,
        verifier_inputs: VerifierInputs,
    ) {
        payer.require_auth();

        let mut invoice = load_invoice(&env, id);
        let verification_key = Self::verification_key(&env);
        assert!(invoice.payer == payer, "payer mismatch");
        assert!(
            matches!(invoice.status, InvoiceStatus::Pending),
            "invoice not pending"
        );
        assert!(
            signals.commitment != empty_commitment(&env),
            "commitment cannot be zero"
        );
        assert!(signals.lo_bound == invoice.lo_bound, "lo_bound mismatch");
        assert!(signals.hi_bound == invoice.hi_bound, "hi_bound mismatch");

        // The Groth16 proof is verified against caller-supplied `verifier_inputs`,
        // so those inputs must be bound to the public `signals` we store. The
        // circuit publishes its public signals in the order
        // `[lo_bound, hi_bound, commitment]`; require an exact match so a proof
        // over commitment A can never settle an invoice that stores commitment B.
        assert!(
            verifier_inputs.inputs.len() == 3,
            "unexpected number of public inputs"
        );
        assert!(
            verifier_inputs.inputs.get(0).unwrap()
                == Fr::from_u256(U256::from_u128(&env, signals.lo_bound as u128)),
            "verifier input lo_bound mismatch"
        );
        assert!(
            verifier_inputs.inputs.get(1).unwrap()
                == Fr::from_u256(U256::from_u128(&env, signals.hi_bound as u128)),
            "verifier input hi_bound mismatch"
        );
        assert!(
            verifier_inputs.inputs.get(2).unwrap() == Fr::from_bytes(signals.commitment.clone()),
            "verifier input commitment mismatch"
        );

        assert!(
            verify_groth16(&env, &verification_key, &proof, &verifier_inputs).unwrap_or(false),
            "invalid zk proof"
        );

        invoice.commitment = signals.commitment;
        invoice.status = InvoiceStatus::Settled;
        save_invoice(&env, &invoice);

        env.events().publish(
            (Symbol::new(&env, "InvoiceSettled"),),
            (id, invoice.commitment),
        );
        InvoiceSettled {
            id,
            commitment: invoice.commitment,
        }
        .publish(&env);
    }

    // NOTE: the always-false `verify_disclosure` stub was removed. Selective
    // disclosure is verified off-chain (see README "Current Scope"): the client
    // recomputes Poseidon over the disclosed `(amount, salt)` and compares it
    // with the invoice's stored commitment. Re-introduce an on-chain variant only
    // once the BN254 Poseidon parameters are wired through the hazmat host API.

    pub fn get_invoice(env: Env, id: u64) -> Invoice {
        load_invoice(&env, id)
    }

    pub fn cancel_invoice(env: Env, payer: Address, id: u64) {
        payer.require_auth();

        let mut invoice = load_invoice(&env, id);
        assert!(invoice.payer == payer, "payer mismatch");
        assert!(
            matches!(invoice.status, InvoiceStatus::Pending),
            "invoice not pending"
        );

        invoice.status = InvoiceStatus::Cancelled;
        save_invoice(&env, &invoice);

        InvoiceCancelled { id }.publish(&env);
    }

    /// Invoice IDs are 1-based: the first invoice registered is `#1`.
    ///
    /// The counter is incremented before it is returned so live contract IDs
    /// match the demo/local fallback (`currentMax + 1n`) used by the frontend
    /// and prover clients.
    fn next_id(env: &Env) -> u64 {
        let next: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0) + 1;
        env.storage().instance().set(&DataKey::NextId, &next);
        next
        let current: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
        env.storage().instance().set(&DataKey::NextId, &(current + 1));
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
        env.storage()
            .instance()
            .set(&DataKey::NextId, &(current + 1));
        current
    }

    fn admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not configured")
    }

    fn verification_key(env: &Env) -> VerificationKey {
        env.storage()
            .instance()
            .get(&DataKey::VerificationKey)
            .expect("verification key not configured")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{vec, BytesN, Env};
    use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
    use soroban_sdk::{vec, BytesN, Env, IntoVal};

    use soroban_sdk::crypto::bn254::{Bn254G1Affine, Bn254G2Affine};

    // alt_bn128 G1 generator (X = 1, Y = 2), big-endian uncompressed encoding.
    const G1_GEN: [u8; 64] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2];
    // alt_bn128 G2 generator, uncompressed be(c1) || be(c0) per Fp2 coordinate.
    const G2_GEN: [u8; 128] = [25, 142, 147, 147, 146, 13, 72, 58, 114, 96, 191, 183, 49, 251, 93, 37, 241, 170, 73, 51, 53, 169, 231, 18, 151, 228, 133, 183, 174, 243, 18, 194, 24, 0, 222, 239, 18, 31, 30, 118, 66, 106, 0, 102, 94, 92, 68, 121, 103, 67, 34, 212, 247, 94, 218, 221, 70, 222, 189, 92, 217, 146, 246, 237, 9, 6, 137, 208, 88, 95, 240, 117, 236, 158, 153, 173, 105, 12, 51, 149, 188, 75, 49, 51, 112, 179, 142, 243, 85, 172, 218, 220, 209, 34, 151, 91, 18, 200, 94, 165, 219, 140, 109, 235, 74, 171, 113, 128, 141, 203, 64, 143, 227, 209, 231, 105, 12, 67, 211, 123, 76, 230, 204, 1, 102, 250, 125, 170];

    fn g1(env: &Env, bytes: &[u8; 64]) -> Bn254G1Affine {
        Bn254G1Affine::from_array(env, bytes)
    }

    fn g2(env: &Env, bytes: &[u8; 128]) -> Bn254G2Affine {
        Bn254G2Affine::from_array(env, bytes)
    }

    fn infinity(env: &Env) -> Bn254G1Affine {
        g1(env, &[0u8; 64])
    }

    // A self-consistent Groth16 fixture: the pairing product
    // e(-A, B) * e(alpha, beta) * e(C, delta) collapses to one identity, so
    // `verify_groth16` returns `Ok(true)` for a well-formed VK/proof pair.
    fn fixture_vk(env: &Env) -> VerificationKey {
        let g1_gen = g1(env, &G1_GEN);
        let g2_gen = g2(env, &G2_GEN);
        VerificationKey {
            alpha: g1_gen.clone(),
            beta: g2_gen.clone(),
            gamma: g2_gen.clone(),
            delta: g2_gen.clone(),
            ic: vec![env, infinity(env)],
        }
    }

    fn fixture_proof(env: &Env) -> Proof {
        Proof {
            a: g1(env, &G1_GEN),
            b: g2(env, &G2_GEN),
            c: infinity(env),
        }
    }

    fn fixture_inputs(env: &Env) -> VerifierInputs {
        VerifierInputs { inputs: vec![env] }
    }

    fn signals(env: &Env, lo_bound: u64, hi_bound: u64) -> PublicSignals {
        PublicSignals {
            commitment: BytesN::from_array(env, &[7u8; 32]),
            lo_bound,
            hi_bound,
    use super::invoice::empty_commitment;
    use super::*;
    use soroban_sdk::crypto::bn254::{Bn254G1Affine, Bn254G2Affine};
    use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{vec, Env};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{vec, BytesN};

    // The BN254 host functions treat a zeroed point as the identity, so a VK and
    // proof built from zeroed points exercise the pairing path without needing a
    // real trusted-setup fixture.
    fn g1_zero(env: &Env) -> Bn254G1Affine {
        Bn254G1Affine::from_array(env, &[0u8; 64])
    }

    fn g2_zero(env: &Env) -> Bn254G2Affine {
        Bn254G2Affine::from_array(env, &[0u8; 128])
    }

    fn zero_proof(env: &Env) -> Proof {
        Proof {
            a: g1_zero(env),
            b: g2_zero(env),
            c: g1_zero(env),
        }
    }

    fn zero_vk(env: &Env, ic_len: u32) -> VerificationKey {
        let mut ic = soroban_sdk::Vec::new(env);
        for _ in 0..ic_len {
            ic.push_back(Bn254G1Affine::from_array(env, &[0u8; 64]));
        }
        VerificationKey {
            alpha: Bn254G1Affine::from_array(env, &[0u8; 64]),
            beta: Bn254G2Affine::from_array(env, &[0u8; 128]),
            gamma: Bn254G2Affine::from_array(env, &[0u8; 128]),
            delta: Bn254G2Affine::from_array(env, &[0u8; 128]),
            ic,
        }
    }
            ic.push_back(g1_zero(env));
        }
        VerificationKey {
            alpha: g1_zero(env),
            beta: g2_zero(env),
            gamma: g2_zero(env),
            delta: g2_zero(env),
            ic,
        }
    }

    fn commitment(env: &Env, byte: u8) -> BytesN<32> {
        BytesN::from_array(env, &[byte; 32])
    }

    fn signals(env: &Env, commitment_byte: u8) -> PublicSignals {
        PublicSignals {
            commitment: commitment(env, commitment_byte),
            lo_bound: 100,
            hi_bound: 200,
        }
    }

    fn fr(env: &Env, value: u128) -> Fr {
        Fr::from_u256(U256::from_u128(env, value))
    }
    use super::{InvoiceVeilContract, InvoiceVeilContractClient};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env};

    #[test]
    fn empty_commitment_is_zeroed_bytes() {
        let env = Env::default();
        let empty = empty_commitment(&env);
        assert_eq!(empty.to_array(), [0u8; 32]);
    }

    #[test]
    fn end_to_end_register_settle_get() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(InvoiceVeilContract, ());
        let client = InvoiceVeilContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.configure(&admin, &fixture_vk(&env));

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let id = client.register_invoice(&payer, &payee, &10_000u64, &50_000u64);
        assert_eq!(id, 0);

        let commitment = BytesN::from_array(&env, &[7u8; 32]);
    fn updated_vk(env: &Env) -> VerificationKey {
        let mut vk = fixture_vk(env);
        vk.ic = vec![env, infinity(env), g1(env, &G1_GEN)];
        vk
    }

    #[test]
    fn admin_can_update_verification_key() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(InvoiceVeilContract, ());
        let client = InvoiceVeilContractClient::new(&env, &contract_id);

        env.mock_all_auths();
        client.configure(&admin, &fixture_vk(&env));

        let updated = updated_vk(&env);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_verification_key",
                args: (updated.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.update_verification_key(&updated);

        let stored: VerificationKey = env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .get(&DataKey::VerificationKey)
                .unwrap()
        });
        assert_eq!(stored, updated);
    }

    #[test]
    #[should_panic(expected = "Auth")]
    fn non_admin_cannot_update_verification_key() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let contract_id = env.register(InvoiceVeilContract, ());
        let client = InvoiceVeilContractClient::new(&env, &contract_id);

        env.mock_all_auths();
        client.configure(&admin, &fixture_vk(&env));

        let updated = updated_vk(&env);
        env.mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_verification_key",
                args: (updated.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.update_verification_key(&updated);
    }

    #[test]
    #[should_panic(expected = "admin not configured")]
    fn update_verification_key_before_configure_panics() {
        let env = Env::default();
        let contract_id = env.register(InvoiceVeilContract, ());
        let client = InvoiceVeilContractClient::new(&env, &contract_id);
        client.update_verification_key(&fixture_vk(&env));
    }

    #[test]
    #[should_panic(expected = "verification key not configured")]
    fn settle_invoice_without_verification_key_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(InvoiceVeilContract, ());
        let client = InvoiceVeilContractClient::new(&env, &contract_id);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let id = client.register_invoice(&payer, &payee, &10_000u64, &50_000u64);
    fn settle_rejects_verifier_inputs_that_do_not_match_signals() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(InvoiceVeilContract, ());
        let client = InvoiceVeilContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        client.configure(&admin, &zero_vk(&env, 4));
        let id = client.register_invoice(&payer, &payee, &100, &200);

        // The stored commitment (byte 7) differs from the commitment the proof
        // inputs cover (byte 9), so the payload must be rejected before the
        // expensive pairing check runs.
        let public_signals = signals(&env, 7);
        let verifier_inputs = VerifierInputs {
            inputs: vec![&env, fr(&env, 100), fr(&env, 200), fr(&env, 9)],
        };

        let result = client.try_settle_invoice(
            &payer,
            &id,
            &zero_proof(&env),
            &public_signals,
            &verifier_inputs,
        );
        assert!(
            result.is_err(),
            "a proof over a different commitment must not settle the invoice"
        );
    }

    #[test]
    fn settle_accepts_verifier_inputs_that_match_signals() {
    fn register_invoice_accepts_distinct_payee() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(InvoiceVeilContract, ());
        let client = InvoiceVeilContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        let id = client.register_invoice(&payer, &payee, &100, &500);
        assert_eq!(id, 0);

        let invoice = client.get_invoice(&id);
        assert_eq!(invoice.payer, payer);
        assert_eq!(invoice.payee, payee);
    }

    #[test]
    #[should_panic(expected = "payee cannot be the payer")]
    fn register_invoice_rejects_self_payee() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(InvoiceVeilContract, ());
        let client = InvoiceVeilContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        client.configure(&admin, &zero_vk(&env, 4));
        let id = client.register_invoice(&payer, &payee, &100, &200);

        let public_signals = signals(&env, 7);
        let verifier_inputs = VerifierInputs {
            inputs: vec![
                &env,
                fr(&env, 100),
                fr(&env, 200),
                Fr::from_bytes(commitment(&env, 7)),
            ],
        };

        client.settle_invoice(
            &payer,
            &id,
            &fixture_proof(&env),
            &signals(&env, 10_000, 50_000),
            &fixture_inputs(&env),
        );

        let invoice = client.get_invoice(&id);
        assert!(matches!(invoice.status, InvoiceStatus::Settled));
        assert_eq!(invoice.commitment, commitment);
    fn storage_writes_extend_ttl() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(InvoiceVeilContract, ());
        let client = InvoiceVeilContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        // `configure` writes Admin/VerificationKey and `register_invoice` writes
        // NextId plus the new invoice.
        client.configure(&admin, &zero_vk(&env, 4));
        let id = client.register_invoice(&payer, &payee, &100, &200);

        env.as_contract(&contract_id, || {
            assert_eq!(
                env.storage().instance().get_ttl(),
                INSTANCE_TTL_EXTEND_TO,
                "instance TTL should be extended after a write"
            );
            assert_eq!(
                env.storage()
                    .persistent()
                    .get_ttl(&DataKey::Invoice(id)),
                PERSISTENT_TTL_EXTEND_TO,
                "invoice TTL should be extended after a write"
            );
        });
            &zero_proof(&env),
            &public_signals,
            &verifier_inputs,
        );

        let invoice = client.get_invoice(&id);
        assert_eq!(invoice.commitment, public_signals.commitment);
        assert!(matches!(invoice.status, InvoiceStatus::Settled));
        let payer = Address::generate(&env);

        client.register_invoice(&payer, &payer, &100, &500);
    }
}
