# PostgreSQL

**Category:** data-storage/relational · **Primary app:** [shop-mvc-express](../../../../../workspaces/apps/shop-mvc-express/), [shop-feature-fastify](../../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** — · **Status:** todo

## Scope
- Schema design, normalization (1NF–3NF), targeted denormalization.
- Indexes: B-tree, partial, composite, covering; cost on writes.
- Transactions and isolation levels (Read Committed, Repeatable Read, Serializable).
- Query optimization, `EXPLAIN ANALYZE`, N+1 problem.
- Migrations (Drizzle or Prisma); forward-only vs reversible; online vs lock-taking.
- Connection pooling; RDS Proxy for Lambda.
- Cursor vs offset pagination.

## Sub-tasks
- [ ] Design schema for `users`, `products`, `orders`, `order_items`; document 1-to-many and many-to-many.
- [ ] Pick Drizzle or Prisma; write initial migration and seed script.
- [ ] Add indexes `products(category_id)`, `orders(user_id, created_at)`; verify with `EXPLAIN ANALYZE`.
- [ ] Implement order creation inside a transaction (reserve stock, insert `order_items`).
- [ ] Add cursor-based pagination for product listing; reject invalid cursors.
- [ ] Configure a `pg` connection pool; pick sizes per environment.
- [ ] Enable `pg_stat_statements`; record a baseline of top-N slow queries.

## Concepts to know
- Foreign keys + referential integrity prevent orphan rows; they also acquire locks.
- Each index costs on every INSERT/UPDATE on that table.
- Default isolation is Read Committed; pick Repeatable Read only when you need stable snapshots.
- Long-running transactions block vacuum and bloat the table.
- Connection count is a hard resource — pool per service, and use RDS Proxy for Lambda.

## Interview questions
- Walk through the schema of your shop. Justify each index.
- `SELECT … ORDER BY created_at DESC LIMIT 20 OFFSET 1000000` is slow — why, and how do you fix it?
- Explain `REPEATABLE READ` vs `READ COMMITTED` with a concrete anomaly.
- Describe the N+1 problem and three ways to fix it.
- How do you safely add a NOT NULL column to a 50M-row table in production?
