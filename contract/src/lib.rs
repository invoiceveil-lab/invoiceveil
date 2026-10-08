#![no_std]

mod invoice;
mod types;
mod verifier;

use invoice::{empty_commitment, load_invoice, save_invoice};
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};
use types::{DataKey, Invoice, InvoiceStatus, Proof, PublicSignals, VerificationKey, VerifierInputs};
use verifier::verify_groth16;

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
    }

    pub fn update_verification_key(env: Env, verification_key: VerificationKey) {
        let admin = Self::admin(&env);
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::VerificationKey, &verification_key);
    }

    pub fn register_invoice(
        env: Env,
        payer: Address,
        payee: Address,
        lo_bound: u64,
        hi_bound: u64,
    ) -> u64 {
        payer.require_auth();
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
        env.events()
            .publish((Symbol::new(&env, "InvoiceRegistered"),), (id, lo_bound, hi_bound));
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
        assert!(matches!(invoice.status, InvoiceStatus::Pending), "invoice not pending");
        assert!(
            signals.commitment != empty_commitment(&env),
            "commitment cannot be zero"
        );
        assert!(signals.lo_bound == invoice.lo_bound, "lo_bound mismatch");
        assert!(signals.hi_bound == invoice.hi_bound, "hi_bound mismatch");
        assert!(
            verify_groth16(&env, &verification_key, &proof, &verifier_inputs)
                .unwrap_or(false),
            "invalid zk proof"
        );

        invoice.commitment = signals.commitment;
        invoice.status = InvoiceStatus::Settled;
        save_invoice(&env, &invoice);

        env.events()
            .publish((Symbol::new(&env, "InvoiceSettled"),), (id, invoice.commitment));
    }

    pub fn verify_disclosure(env: Env, id: u64, amount: u64, salt: u64) -> bool {
        let _invoice = load_invoice(&env, id);
        let _amount = amount;
        let _salt = salt;

        // Pending: Soroban currently exposes Poseidon through the hazmat interface.
        // Once we wire the BN254 Poseidon parameters safely, this method should
        // recompute the commitment and compare it with the stored invoice value.
        false
    }

    pub fn get_invoice(env: Env, id: u64) -> Invoice {
        load_invoice(&env, id)
    }

    pub fn cancel_invoice(env: Env, payer: Address, id: u64) {
        payer.require_auth();

        let mut invoice = load_invoice(&env, id);
        assert!(invoice.payer == payer, "payer mismatch");
        assert!(matches!(invoice.status, InvoiceStatus::Pending), "invoice not pending");

        invoice.status = InvoiceStatus::Cancelled;
        save_invoice(&env, &invoice);

        env.events()
            .publish((Symbol::new(&env, "InvoiceCancelled"),), (id,));
    }

    fn next_id(env: &Env) -> u64 {
        let current: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
        env.storage().instance().set(&DataKey::NextId, &(current + 1));
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
        }
    }

    #[test]
    fn empty_commitment_is_zeroed_bytes() {
        let env = Env::default();
        let empty = empty_commitment(&env);
        assert_eq!(empty.to_array(), [0u8; 32]);
    }

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

        client.settle_invoice(
            &payer,
            &id,
            &fixture_proof(&env),
            &signals(&env, 10_000, 50_000),
            &fixture_inputs(&env),
        );
    }
}
