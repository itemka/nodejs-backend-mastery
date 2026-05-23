export const SEED_DOCUMENTS: Readonly<Record<string, string>> = Object.freeze({
  'deposition.md':
    '# Deposition Notes\n\nWitness: Jane Doe.\nDate: 2026-04-12.\nSummary: The witness stated that she observed the delivery truck enter the loading dock at 09:14.\nFollow-up: Confirm the timestamp on the dock camera footage and cross-reference with the visitor log.',
  'financials.docx':
    '# Q1 Financial Summary\n\nRevenue: $4.8M (+12% YoY).\nGross margin: 61%.\nOperating expenses: $2.1M.\nNotes: Marketing spend exceeded plan by $180k due to the spring campaign extension.',
  'outlook.pdf':
    '# Forward-Looking Outlook\n\nWe expect modest growth in the second half of 2026 driven by enterprise renewals.\nDownside risk: hiring delays in the platform team push the launch of feature X to Q1 2027.',
  'plan.md':
    '# Project Plan\n\n## Milestones\n\n- Milestone A: scope locked by 2026-05-15.\n- Milestone B: prototype demo on 2026-06-01.\n- Milestone C: GA candidate by 2026-08-15.\n\n## Owners\n\n- Platform: A. Engineer.\n- Product: B. Owner.',
  'report.pdf':
    '# Quarterly Report\n\n## Highlights\n\n- Shipped two major features.\n- Reduced p95 latency on the search endpoint from 480ms to 210ms.\n\n## Concerns\n\n- Onboarding completion rate is flat versus last quarter.',
  'spec.txt':
    'Specification: document-mcp-server\n--------------------------------\nThe server exposes read_doc_contents and edit_document tools backed by an in-memory store.\nResources: docs://documents and docs://documents/{doc_id}.\nPrompts: format.',
});
