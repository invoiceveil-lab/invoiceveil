#![no_std]

mod invoice;
mod types;
mod verifier;

use invoice::{empty_commitment, load_invoice, save_invoice};
use soroban_sdk::{contract, contractimpl, crypto::bn254::Fr, Address, Env, Symbol, U256};
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
    use super::invoice::empty_commitment;
    use super::*;
    use soroban_sdk::crypto::bn254::{Bn254G1Affine, Bn254G2Affine};
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

    #[test]
    fn empty_commitment_is_zeroed_bytes() {
        let env = Env::default();
        let empty = empty_commitment(&env);
        assert_eq!(empty.to_array(), [0u8; 32]);
    }

    #[test]
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
            &zero_proof(&env),
            &public_signals,
            &verifier_inputs,
        );

        let invoice = client.get_invoice(&id);
        assert_eq!(invoice.commitment, public_signals.commitment);
        assert!(matches!(invoice.status, InvoiceStatus::Settled));
    }
}
