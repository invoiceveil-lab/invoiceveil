export interface InvoiceInput {
  amount: bigint;
  loBound: bigint;
  hiBound: bigint;
}

export interface CircuitInput {
  amount: string;
  salt: string;
  lo_bound: string;
  hi_bound: string;
  commitment: string;
}

export function toCircuitInput(input: InvoiceInput, salt: bigint, commitment: string): CircuitInput {
  return {
    amount: input.amount.toString(),
    salt: salt.toString(),
    lo_bound: input.loBound.toString(),
    hi_bound: input.hiBound.toString(),
    commitment,
  };
}
