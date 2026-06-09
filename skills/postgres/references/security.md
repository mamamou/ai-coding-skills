---
title: Security Best Practices
description: Roles, permissions, row-level security, pg_hba.conf, SSL/TLS, and audit logging
tags: postgres, security, roles, rls, pg_hba, ssl, audit, permissions
---

# Security Best Practices

## Roles and Permissions

PostgreSQL uses a role-based access control model. Roles can be users (with LOGIN) or groups (without LOGIN).

### Principle of Least Privilege

```sql
-- Create an application role with minimal permissions
CREATE ROLE app_user LOGIN PASSWORD 'strong_password';
GRANT CONNECT ON DATABASE mydb TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

-- Read-only role for reporting
CREATE ROLE readonly LOGIN PASSWORD 'strong_password';
GRANT CONNECT ON DATABASE mydb TO readonly;
GRANT USAGE ON SCHEMA public TO readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly;
```

### Role Hierarchy

```sql
-- Group roles (no LOGIN)
CREATE ROLE writers;
CREATE ROLE readers;
GRANT readers TO writers;  -- writers inherit reader permissions

-- Assign users to groups
GRANT writers TO app_user;
GRANT readers TO readonly;
```

### Key Rules

- Never use the `postgres` superuser for application connections
- One role per application/service
- Use `ALTER DEFAULT PRIVILEGES` so new objects inherit grants
- Revoke `CREATE` on `public` schema: `REVOKE CREATE ON SCHEMA public FROM PUBLIC;`
- Revoke default connect: `REVOKE CONNECT ON DATABASE mydb FROM PUBLIC;`

## Row-Level Security (RLS)

Controls which rows a user can see or modify. Essential for multi-tenant applications.

```sql
ALTER TABLE tenant_data ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policy
CREATE POLICY tenant_isolation ON tenant_data
  USING (tenant_id = current_setting('app.tenant_id')::bigint);

-- Set tenant context per request (in application code)
SET app.tenant_id = '42';
SELECT * FROM tenant_data;  -- only sees tenant 42's rows
```

### RLS Guidelines

- Table owners bypass RLS by default — use `ALTER TABLE ... FORCE ROW LEVEL SECURITY` to enforce on owners too
- Always test with the actual application role, not superuser
- RLS adds a filter to every query — index the policy columns
- A table with RLS enabled but no policies denies all access (fail-closed)
- Use `USING` for SELECT/UPDATE/DELETE visibility; `WITH CHECK` for INSERT/UPDATE validation

## pg_hba.conf (Client Authentication)

Controls who can connect from where and how they authenticate. Evaluated top-to-bottom; first match wins.

```
# TYPE  DATABASE    USER        ADDRESS         METHOD
local   all         postgres                    peer
host    mydb        app_user    10.0.0.0/8      scram-sha-256
host    all         all         0.0.0.0/0       reject
```

### Authentication Methods

| Method | Use Case |
|--------|----------|
| `scram-sha-256` | **Recommended** for password auth (PG 10+) |
| `md5` | Legacy password auth — migrate to scram-sha-256 |
| `peer` | Local connections; OS user = PG role |
| `cert` | Client certificate authentication |
| `reject` | Explicit deny |
| `trust` | **Never use in production** — no authentication |

### Rules

- Always end with a `reject` rule as a catch-all
- Use `scram-sha-256` over `md5` — set `password_encryption = 'scram-sha-256'`
- Restrict `host` entries to specific subnets, not `0.0.0.0/0`
- Reload after changes: `SELECT pg_reload_conf();`

## SSL/TLS

```
# postgresql.conf
ssl = on
ssl_cert_file = '/path/to/server.crt'
ssl_key_file = '/path/to/server.key'
ssl_ca_file = '/path/to/ca.crt'         # for client cert verification
ssl_min_protocol_version = 'TLSv1.2'    # PG 12+
```

### Client Connection

```bash
psql "host=db.example.com dbname=mydb user=app sslmode=verify-full sslrootcert=/path/to/ca.crt"
```

| sslmode | Encryption | Server Cert Verified | Use Case |
|---------|-----------|---------------------|----------|
| `disable` | No | No | Never in production |
| `require` | Yes | No | Encryption only, no identity verification |
| `verify-ca` | Yes | CA only | Trusted CA environments |
| `verify-full` | Yes | CA + hostname | **Recommended for production** |

## Audit Logging

### Built-in Logging

```
# postgresql.conf
log_connections = on
log_disconnections = on
log_statement = 'ddl'           # log DDL statements (or 'all' for full audit)
log_line_prefix = '%m [%p] %u@%d '
```

### pgAudit Extension

For compliance-grade audit logging (SOC2, HIPAA, PCI-DSS):

```sql
-- postgresql.conf: shared_preload_libraries = 'pgaudit'
CREATE EXTENSION pgaudit;
SET pgaudit.log = 'write, ddl';        -- log data modifications and schema changes
SET pgaudit.log_relation = on;          -- log table names
```

pgAudit logs structured entries for SELECT, INSERT, UPDATE, DELETE, and DDL, with the specific objects accessed.

## Network Hardening

### listen_addresses

```
# postgresql.conf — NEVER use '*' in production without firewall rules
listen_addresses = '10.0.1.5'            # bind to specific interface only
```

- Bind to specific IPs, not `*` (all interfaces)
- Change the default port (5432) to reduce exposure to automated scans
- Use VPN or SSH tunnels for remote administrative access — never expose PostgreSQL directly to the public internet
- Use firewall rules (iptables, security groups) to allow only trusted IP ranges

### SCRAM Channel Binding (PG 11+)

SCRAM-SHA-256 with channel binding (`scram-sha-256-plus`) ties authentication to the TLS session, preventing MITM attacks even if an attacker has valid credentials:

```
# pg_hba.conf — require channel binding
hostssl mydb app_user 10.0.0.0/8 scram-sha-256  # channel binding used automatically when available over SSL
```

Ensure `password_encryption = 'scram-sha-256'` and that all client drivers support SCRAM. Migrate from `md5` by resetting passwords after changing the encryption setting.

## OS-Level Hardening

- **SELinux / AppArmor:** Restrict PostgreSQL process capabilities — prevent the postgres process from accessing files or network resources beyond what's needed
- **File permissions:** Ensure `PGDATA` is owned by the `postgres` user with `700` permissions
- **Kernel parameters:** Set `vm.overcommit_memory = 2` to prevent OOM killer from targeting PostgreSQL (pair with proper `shared_buffers` sizing)
- **Updates:** Subscribe to PostgreSQL security announcements and apply minor version updates promptly — they contain security patches

## Additional Hardening

- Set `statement_timeout` to prevent long-running queries from holding resources
- Use `idle_in_transaction_session_timeout` to kill abandoned transactions
- Regularly rotate credentials and use short-lived tokens where possible
- Restrict `pg_execute_server_program` and file-access roles
- Monitor `pg_stat_activity` for unexpected connections or users
- Back up `pg_hba.conf` and role definitions as part of disaster recovery
- Consider `pgcrypto` for column-level encryption of sensitive data (PII, tokens)
- Evaluate Transparent Data Encryption (TDE) solutions if compliance requires encryption at rest beyond filesystem-level encryption
