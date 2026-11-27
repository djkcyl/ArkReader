export function idbResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function openResourceDatabase(): Promise<IDBDatabase> {
  const opening = indexedDB.open('arkreader-resources-v1', 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore('files', { keyPath: 'path' });
  return idbResult(opening);
}
export async function hasCachedLibrary(): Promise<boolean> {
  const database = await openResourceDatabase();
  try {
    return (
      (await idbResult(
        database.transaction('files').objectStore('files').getKey('/library/index.json'),
      )) !== undefined
    );
  } finally {
    database.close();
  }
}
