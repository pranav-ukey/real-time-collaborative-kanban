# Database assets

The canonical database definition is `../backend/prisma/schema.prisma` and contains the eight tables named in the assignment. Use Prisma migrations to create/update the PostgreSQL schema:

```bash
cd ../backend
npx prisma migrate dev --name init
```

The ER diagram is in `../docs/ERD.md`. Seed data is in `../backend/prisma/seed.js` and includes two organizations, three tenants, five demo users, boards, columns, and tasks.
