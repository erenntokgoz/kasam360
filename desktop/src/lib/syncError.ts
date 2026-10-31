const SYNC_FAILURE = /^(Error: )?(QUORUM_LOST|SYNC_RETRY|NO_CONNECTION|SYNC_UNSUPPORTED)/;

/** Bağlantı reddi kod olarak gösterilmez: kullanıcı neyin olmadığını bilmelidir. */
export function syncErrorText(error: unknown, consequence: string): string {
  const message = String(error);
  return SYNC_FAILURE.test(message) ? `Bağlantı yok: ${consequence}.` : message;
}
