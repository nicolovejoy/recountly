// Page-photo storage (physical-journal archive, issue #16). Photos are PRIVATE
// blobs keyed by photo id, served only through the auth-gated GET /api/photo/[id]
// proxy — the photos table stores no URL; the path derives from the id.
//
// ⚠️ NOT best-effort, unlike audio: uploadPhoto never swallows errors, and
// callers must let a throw fail the whole save. Issue #10 (weeks of silently
// lost audio) is the reason — a lost page photo is unrecoverable.

import { put } from "@vercel/blob";
import { toIso, type SqlQuery } from "./entry-sql";
import type { PutFn } from "./blob";

export function imageExtension(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  switch (base) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

export function photoBlobPath(id: string, mime: string): string {
  return `photos/${id}.${imageExtension(mime)}`;
}

export function photoProxyPath(id: string): string {
  return `/api/photo/${id}`;
}

export interface PhotoRecord {
  id: string;
  entryId: string;
  mime: string;
  bytes: number;
  createdAt: string;
}

const COLUMNS = "id, entry_id, mime, bytes, created_at";

export function insertPhotoSql(p: PhotoRecord): SqlQuery {
  return {
    text: `INSERT INTO photos (${COLUMNS}) VALUES ($1, $2, $3, $4, $5)`,
    values: [p.id, p.entryId, p.mime, p.bytes, p.createdAt],
  };
}

// ULIDs sort by mint time, so ordering by id is capture order.
export function listPhotosByEntrySql(entryId: string): SqlQuery {
  return {
    text: `SELECT ${COLUMNS} FROM photos WHERE entry_id = $1 ORDER BY id`,
    values: [entryId],
  };
}

export function getPhotoSql(id: string): SqlQuery {
  return {
    text: `SELECT ${COLUMNS} FROM photos WHERE id = $1`,
    values: [id],
  };
}

// Issue #9 delete: photos.entry_id has no ON DELETE CASCADE (db/schema.sql),
// so callers must run this before deleteEntrySql.
export function deletePhotosByEntrySql(entryId: string): SqlQuery {
  return {
    text: `DELETE FROM photos WHERE entry_id = $1`,
    values: [entryId],
  };
}

export function rowToPhoto(row: Record<string, unknown>): PhotoRecord {
  return {
    id: String(row.id),
    entryId: String(row.entry_id),
    mime: String(row.mime),
    bytes: Number(row.bytes),
    createdAt: toIso(row.created_at),
  };
}

export interface UploadedPhoto {
  pathname: string;
  bytes: number;
  mime: string;
}

export async function uploadPhoto(
  id: string,
  body: Blob | ArrayBuffer | Buffer,
  mime: string,
  bytes: number,
  putFn: PutFn = put as unknown as PutFn,
): Promise<UploadedPhoto> {
  const pathname = photoBlobPath(id, mime);
  await putFn(pathname, body, { access: "private", contentType: mime });
  return { pathname, bytes, mime };
}
