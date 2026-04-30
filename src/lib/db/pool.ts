import pg from 'pg';

const { Pool } = pg;

// Use DATABASE_URL if provided, otherwise fallback to components
const connectionString = process.env.DATABASE_URL || import.meta.env.DATABASE_URL;

export const pool = new Pool({
  connectionString,
  // High concurrency for production VPS
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000, // Reasonable timeout for internal network
  keepAlive: true,
  application_name: 'musiki-framework'
});

// Log when a new client is connected to the pool
pool.on('connect', (client) => {
  if (import.meta.env.DEV) {
    console.log('[DB-POOL] New client connected to pool');
  }
});

// Handle pool errors globally to prevent process crashes
pool.on('error', (err) => {
  // ECONNRESET is common on tunnels, we log but don't crash
  if ((err as any).code === 'ECONNRESET') {
    console.warn('[DB-POOL] Connection reset (tunnel drop). Pool will recover on next query.');
  } else {
    console.error('[DB-POOL] Unexpected error on idle client', err.message);
  }
});

/**
 * Standard query helper with aggressive retry logic for SSH tunnels.
 */
export async function query<T = any>(text: string, params?: any[], retries = 3) {
  const start = Date.now();
  let attempt = 0;

  while (attempt <= retries) {
    try {
      // Monitor pool health
      if (import.meta.env.DEV && attempt > 0) {
        console.log(`[DB-POOL] Retry ${attempt}/${retries}. Pool: total=${pool.totalCount}, idle=${pool.idleCount}, waiting=${pool.waitingCount}`);
      }

      const res = await pool.query(text, params);
      
      if (import.meta.env.DEV && attempt > 0) {
        console.log(`[DB-QUERY] Recovered after ${attempt} retries.`);
      }
      
      return { data: res.rows as T[], error: null, count: res.rowCount };
    } catch (err: any) {
      const duration = Date.now() - start;
      const isTransient = ['ECONNRESET', 'ETIMEDOUT', '57P01', '08006', 'ECONNREFUSED'].includes(err.code) 
        || err.message.includes('terminated unexpectedly')
        || err.message.includes('Connection terminated')
        || err.message.includes('read ECONNRESET');

      if (isTransient && attempt < retries) {
        attempt++;
        const delay = attempt <= 5 ? Math.pow(2, attempt) * 50 : 2000; 
        
        if (attempt === 1) {
          console.warn(`[DB-QUERY] Transient ${err.code || 'ERR'} on: ${text.slice(0, 80)}... [${err.message}]`);
        } else if (attempt > 3) {
          console.warn(`[DB-QUERY] Still failing (${attempt}/${retries}). Delay ${delay}ms. Error: ${err.message}`);
        }
        
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // If we reach here, it's either not transient or we ran out of retries
      const fatalType = attempt >= retries ? 'RETRY_EXHAUSTED' : 'NON_TRANSIENT';
      console.error(`[DB-QUERY] Fatal Error (${fatalType})`, { 
        text: text.slice(0, 120), 
        duration, 
        error: err.message, 
        code: err.code,
        attempts: attempt
      });
      return { data: null, error: err, count: 0 };
    }
  }

  return { data: null, error: new Error('Maximum retries exceeded'), count: 0 };
}

export async function getClient() {
  const client = await pool.connect();
  return client;
}
