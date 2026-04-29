import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL not found in .env');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });

async function check() {
  try {
    console.log('Checking database connection...');
    const now = await pool.query('SELECT NOW()');
    console.log('Connection OK:', now.rows[0].now);

    console.log('\n--- Recent Users ---');
    const users = await pool.query('SELECT id, email, name, role, "updatedAt" FROM "User" ORDER BY "updatedAt" DESC LIMIT 5');
    console.table(users.rows);

    console.log('\n--- UserEmail entries ---');
    const userEmails = await pool.query('SELECT * FROM "UserEmail" LIMIT 10');
    console.table(userEmails.rows);

    console.log('\n--- Checking for specific email (if provided) ---');
    const emailToSearch = process.argv[2];
    if (emailToSearch) {
      console.log(`Searching for: ${emailToSearch}`);
      const specificUser = await pool.query('SELECT * FROM "User" WHERE "email" ILIKE $1', [emailToSearch]);
      console.log('Direct User hit:', specificUser.rows);
      
      const specificUE = await pool.query('SELECT * FROM "UserEmail" WHERE "email" = $1', [emailToSearch.toLowerCase().trim()]);
      console.log('UserEmail hit:', specificUE.rows);
    }

  } catch (err) {
    console.error('Database check failed:', err);
  } finally {
    await pool.end();
  }
}

check();
