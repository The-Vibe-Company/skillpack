ALTER TABLE "skill_installs" ADD COLUMN "installed_checksum" text;--> statement-breakpoint
UPDATE "skill_installs" AS i
SET "installed_checksum" = v."checksum"
FROM "skills" AS s, "skill_versions" AS v
WHERE s."id" = i."skill_id" AND s."org_id" = i."org_id"
  AND v."skill_id" = s."id" AND v."org_id" = i."org_id"
  AND ((i."installed_version" IS NOT NULL AND v."version" = i."installed_version")
    OR (i."installed_version" IS NULL AND v."id" = s."current_version_id"));
