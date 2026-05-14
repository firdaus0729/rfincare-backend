## Supabase → MySQL migration notes

### 1) Create schema in MySQL

Set `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_PORT` and run:

```bash
npm run db:migrate
```

### 2) Export from Supabase

- Export each table you need as CSV from Supabase.\n+
### 3) Import into MySQL

- Import CSVs into matching MySQL tables.\n+
### 4) Password migration

Supabase Auth password hashes typically aren’t exportable in a usable way.\n+
Recommended approach:\n+
- Create users in `auth_users` with a temporary password\n+- Set `user_profiles.password_change_required = 1`\n+- Force password change after first login\n+
