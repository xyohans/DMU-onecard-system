# Meal Card API

## Database setup

Back up the existing `meal_card` database. For a database that already has the original `staff` table, run `sql/auth_migration.sql` once. For a new database, use `sql/schema.sql` instead. The migration adds role/station fields and the one-phone session table shared by staff and admins.

Install API dependencies with `npm install --prefix api` and set the database variables in the repository's `.env`.

## Administrator website

The admin console is served by the API at `http://<server-address>:3000/admin/`.

Create the first administrator from the repository root:

```sh
node api/scripts/create-admin.js --email admin@example.edu --name "Admin Name"
```

The command generates a random initial password and prints it once. Keep it private. Sign in at `/admin/`.

The administrator can create staff accounts (with one-time temporary passwords), edit their name, email and station, disable accounts, reset passwords and revoke active phone sessions. Changing a staff member's station or disabling the account automatically ends their current session. Admin accounts are provisioned from the command line; the website manages staff accounts only.

## Staff account setup

Staff accounts may also be created from the command line:

```sh
node api/scripts/create-staff.js --email staff@example.edu --name "Staff Name" --cafeteria 1 --gate 1
```

The command generates a random initial password and prints it once. Give it to the staff member securely. To revoke any account's active session from the command line:

```sh
node api/scripts/revoke-staff-session.js staff@example.edu
```

The API requires staff authorization for scans and sync operations. Deploy the site and API behind HTTPS before using them outside a trusted development network.
