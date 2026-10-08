#![no_std]

mod invoice;
mod types;
mod verifier;

use invoice::{empty_commitment, load_invoice, save_invoice};
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};
use types::{DataKey, Invoice, InvoiceStatus, Proof, PublicSignals, VerificationKey, VerifierInputs};
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
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
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
    use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{vec, Env};

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

    #[test]
    fn empty_commitment_is_zeroed_bytes() {
        let env = Env::default();
        let empty = empty_commitment(&env);
        assert_eq!(empty.to_array(), [0u8; 32]);
    }

    #[test]
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
    }
}
