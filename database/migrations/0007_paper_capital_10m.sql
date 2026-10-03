-- Profile accounts now start with Rp10.000.000 (was Rp1.000.000). Restart them so every number is on the new base;
-- the single-account V2 history ('V2') and the signal log are kept. Accounts are recreated on the next scan.
DELETE FROM "paper_positions" WHERE "profile" IN ('AMAN', 'MENENGAH', 'AGRESIF');--> statement-breakpoint
DELETE FROM "paper_trades" WHERE "profile" IN ('AMAN', 'MENENGAH', 'AGRESIF');--> statement-breakpoint
DELETE FROM "paper_ledger" WHERE "profile" IN ('AMAN', 'MENENGAH', 'AGRESIF');--> statement-breakpoint
DELETE FROM "paper_state" WHERE "profile" IN ('AMAN', 'MENENGAH', 'AGRESIF');
