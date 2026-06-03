import * as FileSystem from 'expo-file-system/legacy';

import { MAX_PHOTOS_PER_DISCOVERY } from '../constants';
import type { StoredPhotoInput } from '../types';
import { makeId } from '../utils/id';
import { sha256String } from './integrity';

const PHOTO_DIR = `${FileSystem.documentDirectory ?? ''}discovery-photos/`;

export async function ensurePhotoDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(PHOTO_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
  }
}

export async function persistCapturedPhoto(sourceUri: string): Promise<string> {
  await ensurePhotoDirectory();
  const extension = getExtension(sourceUri);
  const destination = `${PHOTO_DIR}${makeId('field_photo')}.${extension}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destination });
  return destination;
}

export async function buildStoredPhotoInput(uri: string): Promise<StoredPhotoInput> {
  const info = await FileSystem.getInfoAsync(uri);

  if (!info.exists) {
    throw new Error('Foto nao encontrada no armazenamento local.');
  }

  const base64 = await readPhotoAsBase64(uri);

  return {
    uri,
    optimizedUri: uri,
    mimeType: getMimeType(uri),
    byteSize: 'size' in info && typeof info.size === 'number' ? info.size : base64.length,
    sha256: await sha256String(base64)
  };
}

export async function readPhotoAsBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64
  });
}

export async function assertPhotoIntegrity(uri: string, expectedSha256: string): Promise<string> {
  const base64 = await readPhotoAsBase64(uri);
  const actualSha256 = await sha256String(base64);

  if (actualSha256 !== expectedSha256) {
    throw new Error('Hash de integridade da foto nao confere.');
  }

  return base64;
}

export function canAddPhoto(currentCount: number): boolean {
  return currentCount < MAX_PHOTOS_PER_DISCOVERY;
}

function getExtension(uri: string): string {
  const match = uri.split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? 'jpg';
}

function getMimeType(uri: string): string {
  const extension = getExtension(uri);
  const mimeTypes: Record<string, string> = {
    heic: 'image/heic',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp'
  };

  return mimeTypes[extension] ?? 'application/octet-stream';
}
