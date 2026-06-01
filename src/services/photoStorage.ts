import * as FileSystem from 'expo-file-system/legacy';

import { MAX_PHOTOS_PER_DISCOVERY } from '../constants';
import { makeId } from '../utils/id';

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

export function canAddPhoto(currentCount: number): boolean {
  return currentCount < MAX_PHOTOS_PER_DISCOVERY;
}

function getExtension(uri: string): string {
  const match = uri.split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? 'jpg';
}
