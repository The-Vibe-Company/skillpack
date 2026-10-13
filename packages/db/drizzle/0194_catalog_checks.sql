-- Value-free automated checks over each frozen public package. Historical proposals are not checked.
ALTER TABLE "catalog_submissions" ADD COLUMN "check_report" jsonb;--> statement-breakpoint
ALTER TABLE "catalog_submissions" ADD CONSTRAINT "catalog_submissions_check_report_check"
  CHECK ("check_report" IS NULL OR COALESCE((jsonb_typeof("check_report") = 'object'
    AND "check_report"->>'version' = '1'
    AND jsonb_typeof("check_report"->'passed') = 'boolean'
    AND jsonb_typeof("check_report"->'findings') = 'array'), false));
