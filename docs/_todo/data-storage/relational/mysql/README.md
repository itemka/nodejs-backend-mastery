# MySQL (comparison)

**Category:** data-storage/relational · **Primary app:** — · **Prereqs:** postgresql · **Status:** todo

## Scope
- InnoDB transaction model vs Postgres MVCC.
- Clustered primary key storage (vs Postgres heap).
- Default isolation Repeatable Read (vs Postgres Read Committed).
- Replication: async / semi-sync / group replication.

## Sub-tasks
- [ ] Write a short comparison note: clustered index implications, JSON support, replication.
- [ ] Note migration gotchas if ever moving Postgres → MySQL or vice versa.

## Concepts to know
- Clustered PK means row data is physically ordered by the PK — pick it carefully.
- InnoDB row locks use next-key locking; behavior differs from Postgres.
- MySQL's JSON functions lag Postgres JSONB performance.

## Interview questions
- Where does MySQL meaningfully differ from Postgres?
- Clustered vs heap storage — implications for queries and writes?
- When would you pick MySQL over Postgres today?
