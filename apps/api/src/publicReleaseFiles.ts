import { extractArchiveFiles, zipToTar } from "@skillpack/skills";
import { SkillPublicReleaseValidationError } from "@skillpack/core/services";

/** Extract only paths and byte lengths from a safe, pinned public ZIP. */
export async function publicReleaseFileList(zip: Buffer): Promise<Array<{ path: string; size_bytes: number }>> {
  const extracted = await extractArchiveFiles(await zipToTar(zip));
  if (extracted.violations.length > 0) {
    throw new SkillPublicReleaseValidationError("the public release file list is invalid");
  }
  return extracted.files.map((file) => ({ path: file.path, size_bytes: file.size }));
}
