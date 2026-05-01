# PCI-DSS

**Category:** compliance-governance · **Primary app:** [orders-event-driven](../../../../workspaces/apps/orders-event-driven/) · **Prereqs:** — · **Status:** todo

## Scope

- Cardholder Data Environment (CDE) scope minimization.
- Tokenization via a payment provider (Stripe, Adyen) to stay out of scope.
- SAQ levels; what each requires.
- Network segmentation, logging, and change control.

## Sub-tasks

- [ ] Decide: full CDE or tokenized (via provider). Default: tokenized.
- [ ] Document what data touches your systems and what stays with the provider.
- [ ] Ensure no PAN or CVV ever hits your logs or DB.

## Concepts to know

- Holding PANs pulls you into the full PCI scope — avoid when possible.
- Tokens from providers map to PAN only inside the provider's vault.
- Logs are in scope if they _could_ contain PAN — redact aggressively.

## Interview questions

- How do you stay out of PCI scope while still processing payments?
- What's tokenization and where does it happen?
- What goes wrong if PAN appears in a log?
