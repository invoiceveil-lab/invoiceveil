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
    use soroban_sdk::testutils::{Address as _, Events};
    use soroban_sdk::{vec, IntoVal, Symbol, Val, Vec};

    #[test]
    fn empty_commitment_is_zeroed_bytes() {
        let env = Env::default();
        let empty = empty_commitment(&env);
        assert_eq!(empty.to_array(), [0u8; 32]);
    }

    #[test]
    fn register_invoice_stores_pending_invoice_and_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(InvoiceVeilContract, ());
        let client = InvoiceVeilContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let id = client.register_invoice(&payer, &payee, &10_000u64, &50_000u64);
        assert_eq!(id, 0);

        // Read the emitted event before any later invocation, because
        // `env.events().all()` only returns events from the last call.
        let topics: Vec<Val> = (Symbol::new(&env, "InvoiceRegistered"),).into_val(&env);
        let data: Val = (id, 10_000u64, 50_000u64).into_val(&env);
        assert_eq!(
            env.events().all(),
            vec![&env, (contract_id.clone(), topics, data)]
        );

        let invoice = client.get_invoice(&id);
        assert_eq!(invoice.id, 0);
        assert_eq!(invoice.payer, payer);
        assert_eq!(invoice.payee, payee);
        assert_eq!(invoice.lo_bound, 10_000);
        assert_eq!(invoice.hi_bound, 50_000);
        assert_eq!(invoice.commitment, empty_commitment(&env));
        assert!(matches!(invoice.status, InvoiceStatus::Pending));
    }

    #[test]
    #[should_panic(expected = "invalid bounds")]
    fn register_invoice_rejects_equal_bounds() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(InvoiceVeilContract, ());
        let client = InvoiceVeilContractClient::new(&env, &contract_id);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        client.register_invoice(&payer, &payee, &1_000u64, &1_000u64);
    }

    #[test]
    #[should_panic(expected = "invalid bounds")]
    fn register_invoice_rejects_inverted_bounds() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(InvoiceVeilContract, ());
        let client = InvoiceVeilContractClient::new(&env, &contract_id);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        client.register_invoice(&payer, &payee, &5_000u64, &1_000u64);
    }
}
