// Read-only DB introspection — lists public tables, plus columns + row counts
// for the Better Auth tables and entries. Used to diagnose whether this DB is
// shared with another app. Run: pnpm db:introspect
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const tables = await pool.query(
  `select table_name from information_schema.tables
   where table_schema='public' order by table_name`,
);
console.log("PUBLIC TABLES:", tables.rows.map((r) => r.table_name).join(", "));

for (const t of ["user", "session", "account", "verification", "entries"]) {
  try {
    const c = await pool.query(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name=$1 order by ordinal_position`,
      [t],
    );
    if (!c.rows.length) {
      console.log(`\n${t}: (absent)`);
      continue;
    }
    const n = await pool.query(`select count(*)::int as n from "${t}"`);
    console.log(`\n${t} (${n.rows[0].n} rows):\n  ${c.rows.map((r) => r.column_name).join(", ")}`);
  } catch (e) {
    console.log(`\n${t}: error ${e.message}`);
  }
}
await pool.end();
