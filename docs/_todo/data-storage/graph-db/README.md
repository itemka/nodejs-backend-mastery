# Graph DB

**Category:** data-storage · **Primary app:** — · **Prereqs:** — · **Status:** todo

## Scope

- Labeled-property graph model (Neo4j) vs RDF triple stores.
- When to reach for a graph DB: relationship-heavy queries (social, knowledge, recommendations).
- Cypher query language basics.

## Sub-tasks

- [ ] Write a note on when graph beats SQL — recursive / variable-depth traversals.
- [ ] Sketch a "followers of followers" query in Cypher vs SQL.

## Concepts to know

- SQL recursive CTEs cover some graph cases but scale poorly past a few levels.
- Graph DBs are not a general-purpose DB — pick per use-case.
- Operational story is heavier than Postgres for most teams.

## Interview questions

- When would you pick Neo4j over Postgres?
- What queries are painful in SQL but easy in a graph DB?
